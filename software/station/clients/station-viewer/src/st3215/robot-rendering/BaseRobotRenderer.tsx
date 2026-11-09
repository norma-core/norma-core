import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { useTheme } from '@/hooks/useTheme';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import URDFLoader from 'urdf-loader';
import {
  mat4FromRotationTranslation,
  parseUrdf,
  rpyToMatrix
} from '../utils';
import { appendHash } from '@/utils/asset-hashes';
import { getRendererThemeColors } from '@/utils/theme-colors';
import { motorsToArmState, type MotorStatus } from './arm-state';
import type { BaseRobotRendererProps, BaseRobotRendererRef } from './types';

/**
 * A scene lives exactly as long as its URDF: changing `urdfPath` remounts
 * RobotScene, so there is never more than one robot load per scene and a
 * result arriving after unmount is simply disposed.
 */
const BaseRobotRenderer = forwardRef<BaseRobotRendererRef, BaseRobotRendererProps>((props, ref) => (
  <RobotScene key={props.urdfPath} {...props} ref={ref} />
));

const RobotScene = forwardRef<BaseRobotRendererRef, BaseRobotRendererProps>((props, ref) => {
  const {
    busSerialNumber,
    bus,
    urdfPath,
    jointNames,
    basePos = [0,0,0],
    baseRpy = [0,0,0],
    resolveMotorMaterialIndex,
    resolveJointValue,
  } = props;
  const { theme } = useTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<any>(null);

  const disposeMaterial = (material: THREE.Material) => {
    Object.values(material).forEach((value) => {
      if (value instanceof THREE.Texture) {
        value.dispose();
      }
    });
    material.dispose();
  };

  const disposeObject3D = (object: THREE.Object3D | null) => {
    if (!object) return;
    object.traverse((child: any) => {
      if (child.geometry) {
        child.geometry.dispose();
      }
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((material: THREE.Material) => disposeMaterial(material));
        } else {
          disposeMaterial(child.material);
        }
      }
    });
  };

  const createGridHelper = () => {
    const colors = getRendererThemeColors(theme);
    return new THREE.GridHelper(2, 20, colors.gridPrimary, colors.gridSecondary);
  };

  const applySceneTheme = () => {
    if (!sceneRef.current) return;

    const colors = getRendererThemeColors(theme);
    sceneRef.current.scene.background = colors.sceneBackground;

    if (sceneRef.current.gridHelper) {
      sceneRef.current.scene.remove(sceneRef.current.gridHelper);
      disposeObject3D(sceneRef.current.gridHelper);
    }

    sceneRef.current.gridHelper = createGridHelper();
    sceneRef.current.scene.add(sceneRef.current.gridHelper);
  };

  const applyMotorStates = () => {
    const arm = sceneRef.current?.arm;
    if (!arm || !bus?.motors?.length) return;
    const { positions, statuses } = motorsToArmState(bus.motors);
    arm.setMotorPositions(positions);
    arm.setMotorStatuses(statuses);
  };

  const loadRobot = () => {
    // The scene this load was started for; a result landing in another mount's scene is dropped.
    const target = sceneRef.current;
    const loader = new URDFLoader();
    loader.loadMeshCb = function(path: string, manager: THREE.LoadingManager, onComplete: (mesh: THREE.Mesh) => void) {
      const stlLoader = new STLLoader(manager);
      stlLoader.load(
        appendHash(path),
        (geometry: THREE.BufferGeometry) => {
          const material = new THREE.MeshPhongMaterial({
            color: 0x008800,
            specular: 0x111111,
            shininess: 200
          });
          const mesh = new THREE.Mesh(geometry, material);
          const fileName = path.split('/').pop() || '';
          if (fileName.includes('sts3215')) {
            material.name = fileName.replace('.stl', '_material');
          }
          onComplete(mesh);
        },
        () => {},
        (error: any) => {
          console.error('Error loading STL file:', path, error);
        }
      );
    };

    loader.load(
      appendHash(urdfPath),
      (robot: any) => {
        if (sceneRef.current !== target) {
          disposeObject3D(robot as THREE.Object3D);
          return;
        }
        sceneRef.current.scene.add(robot);
        sceneRef.current.robot = robot;

        const R_base = rpyToMatrix(baseRpy[0], baseRpy[1], baseRpy[2]);
        sceneRef.current.baseTransform = mat4FromRotationTranslation(R_base, basePos as [number, number, number]);

        robot.position.set(basePos[0], basePos[1], basePos[2]);
        robot.rotation.set(baseRpy[0], baseRpy[1], baseRpy[2]);

        fetch(appendHash(urdfPath))
          .then(response => response.text())
          .then(urdfText => {
            if (sceneRef.current !== target) return;
            sceneRef.current.model = parseUrdf(urdfText);
          })
          .catch(error => {
            console.error('Error loading URDF file:', error);
          });

        sceneRef.current.arm = new Arm(
          busSerialNumber || "default",
          robot,
          bus.motors?.length || 0,
          jointNames,
          resolveMotorMaterialIndex,
          resolveJointValue,
        );
        applyMotorStates();
      },
      () => {},
      (error: any) => {
        console.error('An error occurred loading the URDF:', error);
      }
    );
  };

  useEffect(() => {
    if (!mountRef.current) return;
    const mountNode = mountRef.current;

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(
      75,
      mountNode.clientWidth / mountNode.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0.2, 0.4, 0.5);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mountNode.clientWidth, mountNode.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    mountNode.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 10);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    const axesHelper = new THREE.AxesHelper(1);
    scene.add(axesHelper);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 0.5;
    controls.maxDistance = 5;

    sceneRef.current = {
      scene,
      camera,
      renderer,
      controls,
      robot: null,
      model: null,
      arm: null,
      animationId: 0,
      gridHelper: null,
      jointSpheres: [],
      endEffectorSphere: null,
      baseTransform: null
    };

    applySceneTheme();
    loadRobot();

    const animate = () => {
      if (!sceneRef.current) return;
      sceneRef.current.animationId = requestAnimationFrame(animate);
      sceneRef.current.controls.update();
      sceneRef.current.renderer.render(sceneRef.current.scene, sceneRef.current.camera);
    };
    animate();

    const resizeObserver = new ResizeObserver(() => {
      if (sceneRef.current) {
        const { clientWidth, clientHeight } = mountNode;
        sceneRef.current.renderer.setSize(clientWidth, clientHeight);
        sceneRef.current.camera.aspect = clientWidth / clientHeight;
        sceneRef.current.camera.updateProjectionMatrix();
      }
    });

    resizeObserver.observe(mountNode);

    return () => {
      resizeObserver.disconnect();
      const current = sceneRef.current;
      if (!current) return;
      cancelAnimationFrame(current.animationId);
      disposeObject3D(current.scene);
      current.scene.clear();
      current.controls.dispose();
      current.renderer.renderLists.dispose();
      current.renderer.dispose();
      current.renderer.forceContextLoss();
      current.renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (!sceneRef.current) return;
    applySceneTheme();
    sceneRef.current.renderer.render(sceneRef.current.scene, sceneRef.current.camera);
  }, [theme]);

  useImperativeHandle(ref, () => ({
    toggleRangeSpheres: () => {
      // TODO: Implement range sphere toggling
    },
  }));

  useEffect(applyMotorStates, [bus?.motors]);

  return (
    <div ref={mountRef} className="w-full h-full" />
  );
});

class Arm {
  id: string;
  robot: any;
  isColorChanged: boolean = true;
  motors: Array<{
    angle: number;
    position: number;
    status: MotorStatus;
    minLimit: number;
    maxLimit: number;
  }>;
  color: number;
  motorCount: number;
  jointNames?: (string | string[])[];
  resolveMotorMaterialIndex?: BaseRobotRendererProps['resolveMotorMaterialIndex'];
  resolveJointValue?: BaseRobotRendererProps['resolveJointValue'];

  static colorPalette = [0xFF7043, 0x4CAF50, 0x42A5F5, 0xFFD54F, 0xAB47BC, 0x26C6DA, 0xFFA726, 0x66BB6A, 0xD98484, 0x90A4AE];

  constructor(
    id: string,
    robot: any,
    motorCount: number,
    jointNames: (string | string[])[] | undefined,
    resolveMotorMaterialIndex: BaseRobotRendererProps['resolveMotorMaterialIndex'],
    resolveJointValue: BaseRobotRendererProps['resolveJointValue'],
  ) {
    this.id = id;
    this.robot = robot;
    this.motorCount = motorCount;
    this.jointNames = jointNames;
    this.resolveMotorMaterialIndex = resolveMotorMaterialIndex;
    this.resolveJointValue = resolveJointValue;
    this.motors = [];
    for (let i = 0; i < this.motorCount; i++) {
      const jointNameOrNames = this.jointNames ? this.jointNames[i] : (i + 1).toString();
      const jointName = Array.isArray(jointNameOrNames) ? jointNameOrNames[0] : jointNameOrNames;
      let minLimit = -Math.PI;
      let maxLimit = Math.PI;

      if (robot && robot.joints[jointName] && robot.joints[jointName].limit) {
        minLimit = robot.joints[jointName].limit.lower;
        maxLimit = robot.joints[jointName].limit.upper;
      }
      
      this.motors.push({
        angle: 0,
        position: 0.5,
        status: 'ok',
        minLimit: minLimit,
        maxLimit: maxLimit
      });
    }
    
    this.color = this.getColorFromId(id);
  }

  getColorFromId(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) - hash) + id.charCodeAt(i);
      hash = hash & hash;
    }
    const index = Math.abs(hash) % Arm.colorPalette.length;
    return Arm.colorPalette[index];
  }

  setMotorAngle(motorIndex: number, angle: number) {
    if (motorIndex >= 0 && motorIndex < this.motorCount) {
      const motor = this.motors[motorIndex];
      motor.angle = Math.max(motor.minLimit, Math.min(motor.maxLimit, angle));
      motor.position = (motor.angle - motor.minLimit) / (motor.maxLimit - motor.minLimit);
      this.updateRender();
    }
  }

  setMotorPosition(motorIndex: number, position: number) {
    if (motorIndex >= 0 && motorIndex < this.motorCount) {
      const motor = this.motors[motorIndex];
      motor.position = Math.max(0, Math.min(1, position));
      motor.angle = motor.minLimit + motor.position * (motor.maxLimit - motor.minLimit);
      this.updateRender();
    }
  }

  setMotorPositions(positions: number[]) {
    if (Array.isArray(positions) && positions.length === this.motorCount) {
      positions.forEach((position, index) => {
        this.setMotorPosition(index, position);
      });
    }
  }

  setMotorStatuses(statuses: MotorStatus[]) {
    if (Array.isArray(statuses) && statuses.length === this.motorCount) {
      statuses.forEach((status, index) => {
        if (['ok', 'error'].includes(status)) {
          this.motors[index].status = status;
        }
      });
      this.isColorChanged = true;
      this.updateRender();
    }
  }

  updateRender() {
    if (!this.robot) return;

    for (let i = 0; i < this.motorCount; i++) {
      const jointNameOrNames = this.jointNames ? this.jointNames[i] : (i + 1).toString();
      if (Array.isArray(jointNameOrNames)) {
        const motor = this.motors[i];
        jointNameOrNames.forEach(name => {
          if (this.robot.joints[name]) {
            const limit = this.robot.joints[name].limit;
            const position = this.resolveJointValue
              ? this.resolveJointValue({
                jointName: name,
                position: motor.position,
                lowerLimit: limit.lower,
                upperLimit: limit.upper,
              })
              : limit.lower + motor.position * (limit.upper - limit.lower);
            this.robot.joints[name].setJointValue(position);
          }
        });
      } else {
        if (this.robot.joints[jointNameOrNames]) {
          this.robot.joints[jointNameOrNames].setJointValue(this.motors[i].angle);
        }
      }
    }

    if (this.isColorChanged) {
      this.robot.traverse((child: THREE.Object3D) => {
        if (child instanceof THREE.Mesh) {
          const processMaterial = (material: THREE.Material) => {
            if (!('color' in material)) return;

            let color = this.color;
            const materialName = material.name;
            if (this.resolveMotorMaterialIndex) {
              const motorIndex = this.resolveMotorMaterialIndex({
                materialName,
                motorCount: this.motorCount,
              });

              if (motorIndex !== null && motorIndex >= 0 && motorIndex < this.motorCount) {
                color = this.motors[motorIndex].status === 'ok' ? 0x000000 : 0xFF0000;
              }
            }
            (material as THREE.MeshPhongMaterial).color.setHex(color);
          };

          if (Array.isArray(child.material)) {
            child.material.forEach(processMaterial);
          } else {
            processMaterial(child.material);
          }
        }
      });
      this.isColorChanged = false;
    }
  }
}

export default BaseRobotRenderer;
