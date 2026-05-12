import { useEffect, useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import URDFLoader from 'urdf-loader';
import { normvla } from '@/api/proto';
import {
  defaultSt3215DeviceKinematicConfig,
  findSt3215DeviceKinematicConfig,
} from '@/devices/registry';
import { appendHash } from '@/utils/asset-hashes';
import { useTheme } from '@/hooks/useTheme';
import { getRendererThemeColors } from '@/utils/theme-colors';
import type { JointValueResolver, RobotJointNames } from './robot-rendering/types';

interface NormvlaRobotRendererProps {
  joints: normvla.IJoint[];
}

function disposeObject3D(object: THREE.Object3D | null): void {
  if (!object) return;

  object.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }

    if (mesh.material) {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((material) => material.dispose());
      } else {
        mesh.material.dispose();
      }
    }
  });
}

class NormvlaArm {
  robot: any;
  motors: Array<{
    angle: number;
    position: number;
    minLimit: number;
    maxLimit: number;
  }>;
  motorCount: number;
  jointNames: RobotJointNames;
  resolveJointValue?: JointValueResolver;

  constructor(
    robot: any,
    motorCount: number,
    jointNames: RobotJointNames,
    resolveJointValue?: JointValueResolver,
  ) {
    this.robot = robot;
    this.motorCount = motorCount;
    this.jointNames = jointNames;
    this.resolveJointValue = resolveJointValue;
    this.motors = [];
    for (let i = 0; i < this.motorCount; i++) {
      const jointNameOrNames = jointNames[i];
      const jointName = Array.isArray(jointNameOrNames) ? jointNameOrNames[0] : jointNameOrNames;
      let minLimit = -Math.PI;
      let maxLimit = Math.PI;

      if (robot && robot.joints && robot.joints[jointName] && robot.joints[jointName].limit) {
        minLimit = robot.joints[jointName].limit.lower;
        maxLimit = robot.joints[jointName].limit.upper;
      }

      this.motors.push({
        angle: 0,
        position: 0.5,
        minLimit: minLimit,
        maxLimit: maxLimit
      });
    }
  }

  setMotorPositions(positions: number[]) {
    if (!Array.isArray(positions)) return;
    const count = Math.min(positions.length, this.motorCount);
    for (let i = 0; i < count; i++) {
      const motor = this.motors[i];
      motor.position = Math.max(0, Math.min(1, positions[i]));
      motor.angle = motor.minLimit + motor.position * (motor.maxLimit - motor.minLimit);
    }
    this.updateRender();
  }

  updateRender() {
    if (!this.robot) return;
    for (let i = 0; i < this.motorCount; i++) {
      const jointNameOrNames = this.jointNames[i];
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
        if (this.robot.joints && this.robot.joints[jointNameOrNames]) {
          this.robot.joints[jointNameOrNames].setJointValue(this.motors[i].angle);
        }
      }
    }
  }
}

const NormvlaRobotRenderer = ({ joints }: NormvlaRobotRendererProps) => {
  const { theme } = useTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    gridHelper: THREE.GridHelper | null;
    arm: NormvlaArm | null;
    robot: THREE.Object3D | null;
    animationId: number;
  } | null>(null);
  const jointsRef = useRef<normvla.IJoint[]>(joints);
  const isInitializedRef = useRef(false);

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

  useEffect(() => {
    jointsRef.current = joints;
    if (sceneRef.current?.arm && joints) {
      const positions = joints.map((joint) => {
        if (joint.positionNorm !== undefined && joint.positionNorm !== null) {
          return joint.positionNorm;
        }
        const position = joint.position ?? 0;
        const rangeMin = joint.rangeMin ?? 0;
        const rangeMax = joint.rangeMax ?? 0;
        const range = rangeMax - rangeMin;
        if (range !== 0) {
          return (position - rangeMin) / range;
        }
        return 0;
      });
      sceneRef.current.arm.setMotorPositions(positions);
    }
  }, [joints]);

  useEffect(() => {
    if (!mountRef.current || isInitializedRef.current) return;
    isInitializedRef.current = true;

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(
      75,
      mountRef.current.clientWidth / mountRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0.2, 0.4, 0.5);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    mountRef.current.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 10);
    scene.add(directionalLight);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    sceneRef.current = {
      scene,
      camera,
      renderer,
      controls,
      gridHelper: null,
      arm: null,
      robot: null,
      animationId: 0
    };

    applySceneTheme();

    const jointCount = jointsRef.current?.length ?? defaultSt3215DeviceKinematicConfig.motorCount;
    const deviceConfig =
      findSt3215DeviceKinematicConfig(jointCount) ?? defaultSt3215DeviceKinematicConfig;
    const urdfPath = deviceConfig.urdfPath;
    const basePos = deviceConfig.basePos;
    const baseRpy = deviceConfig.baseRpy;
    const jointNames = deviceConfig.jointNames.slice(0, jointCount);

    const loader = new URDFLoader();
    loader.loadMeshCb = function (path: string, manager: THREE.LoadingManager, onComplete: (mesh: THREE.Mesh) => void) {
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
          onComplete(mesh);
        },
        () => { },
        (error: unknown) => {
          console.error('Error loading STL file:', path, error);
        }
      );
    };

    loader.load(
      appendHash(urdfPath),
      (result: unknown) => {
        const robot = result as THREE.Object3D;
        if (!sceneRef.current) {
          disposeObject3D(robot);
          return;
        }
        scene.add(robot);
        sceneRef.current.robot = robot;

        robot.position.x = basePos[0];
        robot.position.y = basePos[1];
        robot.position.z = basePos[2];
        robot.rotation.x = baseRpy[0];
        robot.rotation.y = baseRpy[1];
        robot.rotation.z = baseRpy[2];

        const motorCount = Math.min(
          jointsRef.current?.length ?? deviceConfig.motorCount,
          jointNames.length,
        );
        sceneRef.current!.arm = new NormvlaArm(
          robot,
          motorCount,
          jointNames,
          deviceConfig.resolveJointValue,
        );

        if (jointsRef.current && jointsRef.current.length > 0) {
          const positions = jointsRef.current.map((joint) => {
            if (joint.positionNorm !== undefined && joint.positionNorm !== null) {
              return joint.positionNorm;
            }
            const position = joint.position ?? 0;
            const rangeMin = joint.rangeMin ?? 0;
            const rangeMax = joint.rangeMax ?? 0;
            const range = rangeMax - rangeMin;
            if (range !== 0) {
              return (position - rangeMin) / range;
            }
            return 0;
          });
          sceneRef.current!.arm.setMotorPositions(positions);
        }
      },
      () => { },
      (error: unknown) => {
        console.error('Error loading URDF:', error);
      }
    );

    const animate = () => {
      if (!sceneRef.current) return;
      sceneRef.current.controls.update();
      sceneRef.current.renderer.render(sceneRef.current.scene, sceneRef.current.camera);
      sceneRef.current.animationId = requestAnimationFrame(animate);
    };
    animate();

    const resizeObserver = new ResizeObserver(() => {
      if (!sceneRef.current || !mountRef.current) return;
      const clientWidth = mountRef.current.clientWidth;
      const clientHeight = mountRef.current.clientHeight;
      sceneRef.current.camera.aspect = clientWidth / clientHeight;
      sceneRef.current.camera.updateProjectionMatrix();
      sceneRef.current.renderer.setSize(clientWidth, clientHeight);
    });

    if (mountRef.current) {
      resizeObserver.observe(mountRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      if (sceneRef.current) {
        cancelAnimationFrame(sceneRef.current.animationId);
        sceneRef.current.controls.dispose();
        if (sceneRef.current.robot) {
          sceneRef.current.scene.remove(sceneRef.current.robot);
          disposeObject3D(sceneRef.current.robot);
          sceneRef.current.robot = null;
        }
        sceneRef.current.renderer.dispose();
        if (mountRef.current && sceneRef.current.renderer.domElement.parentNode) {
          sceneRef.current.renderer.domElement.remove();
        }
        sceneRef.current = null;
        isInitializedRef.current = false;
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (!sceneRef.current || !isInitializedRef.current) return;
    applySceneTheme();
    sceneRef.current.renderer.render(sceneRef.current.scene, sceneRef.current.camera);
  }, [theme]);

  return <div ref={mountRef} className="w-full h-full" />;
};

export default NormvlaRobotRenderer;
