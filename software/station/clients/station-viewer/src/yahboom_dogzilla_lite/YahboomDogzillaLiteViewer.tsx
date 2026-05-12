import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { yahboom_dogzilla_lite } from '../api/proto.js';
import { useTheme } from '@/hooks/useTheme';
import { getRendererThemeColors } from '@/utils/theme-colors';

// Servo position neutral value (0x80 = 128)
const SERVO_NEUTRAL = 128;

// Robot dimensions
const BODY_LENGTH = 0.21;
const BODY_WIDTH = 0.08;
const BODY_HEIGHT = 0.035;
const HIP_OFFSET = 0.025;
const LEG_UPPER_LENGTH = 0.055;
const LEG_LOWER_LENGTH = 0.065;
const LEG_WIDTH = 0.018;
const ARM_SEGMENT_LENGTH = 0.04;
const STANDING_HEIGHT = 0.12;
const GRIPPER_MAX_OPEN = 0.015;

// Colors
const BODY_COLOR = 0xcc3333;
const BODY_TOP_COLOR = 0xdd4444;
const LEG_COLOR = 0xcc3333;
const SERVO_COLOR = 0x6fb2ff;
const ARM_COLOR = 0xcc3333;
const GRIPPER_COLOR = 0xcc3333;

const DEFAULT_SERVO_POSITIONS = [
  128, 200, 110, 128, 200, 110, 128, 200, 110, 128, 200, 110,
  0, 255, 0
];

type CameraPreset = 'top' | 'front' | 'side' | 'iso';

interface YahboomDogzillaLiteViewerProps {
  status?: yahboom_dogzilla_lite.IYahboomDogzillaLiteStatus | null;
  servoPositions?: number[] | null;
  servoAngles?: number[] | null;
  cameraPreset?: CameraPreset;
  refreshToken?: number;
  className?: string;
}

class YahboomDogzillaLiteRobot {
  group: THREE.Group;
  body: THREE.Group;
  joints: Record<string, THREE.Group>;
  gripperJaws: { left: THREE.Group; right: THREE.Group } | null;
  servoPositions: number[];
  servoAngles: number[] | null;

  constructor() {
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.joints = {};
    this.gripperJaws = null;
    this.servoPositions = DEFAULT_SERVO_POSITIONS.slice();
    this.servoAngles = null;
    this.buildRobot();
    this.updateJoints();
  }

  buildRobot() {
    this.body = new THREE.Group();
    this.body.position.y = STANDING_HEIGHT;
    this.group.add(this.body);

    // Main chassis
    const chassisGeometry = new THREE.BoxGeometry(BODY_LENGTH, BODY_HEIGHT, BODY_WIDTH);
    const chassisMaterial = new THREE.MeshPhongMaterial({ color: BODY_COLOR });
    const chassis = new THREE.Mesh(chassisGeometry, chassisMaterial);
    chassis.castShadow = true;
    this.body.add(chassis);

    // Top plate
    const topPlateGeometry = new THREE.BoxGeometry(BODY_LENGTH * 0.9, 0.006, BODY_WIDTH * 0.85);
    const topPlateMaterial = new THREE.MeshPhongMaterial({ color: BODY_TOP_COLOR });
    const topPlate = new THREE.Mesh(topPlateGeometry, topPlateMaterial);
    topPlate.position.y = BODY_HEIGHT / 2 + 0.003;
    topPlate.castShadow = true;
    this.body.add(topPlate);

    // Head
    const headGroup = new THREE.Group();
    headGroup.position.set(BODY_LENGTH / 2 + 0.01, 0, 0);
    this.body.add(headGroup);

    const headGeometry = new THREE.BoxGeometry(0.02, 0.05, 0.08);
    const headMaterial = new THREE.MeshPhongMaterial({ color: BODY_COLOR });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.castShadow = true;
    headGroup.add(head);

    // Display on head
    const displayGeometry = new THREE.BoxGeometry(0.002, 0.038, 0.05);
    const displayMaterial = new THREE.MeshPhongMaterial({ color: 0x222222, emissive: 0x111122 });
    const display = new THREE.Mesh(displayGeometry, displayMaterial);
    display.position.x = 0.011;
    headGroup.add(display);

    // Create 4 legs
    const legPositions = [
      { x: BODY_LENGTH / 2 - 0.025, z: BODY_WIDTH / 2 + HIP_OFFSET, name: '2', flip: 1 },
      { x: BODY_LENGTH / 2 - 0.025, z: -(BODY_WIDTH / 2 + HIP_OFFSET), name: '1', flip: -1 },
      { x: -(BODY_LENGTH / 2 - 0.025), z: -(BODY_WIDTH / 2 + HIP_OFFSET), name: '4', flip: -1 },
      { x: -(BODY_LENGTH / 2 - 0.025), z: BODY_WIDTH / 2 + HIP_OFFSET, name: '3', flip: 1 }
    ];

    legPositions.forEach((pos) => {
      const leg = this.createLeg(pos.name, pos.flip);
      leg.group.position.set(pos.x, -BODY_HEIGHT / 2, pos.z);
      this.body.add(leg.group);
    });

    // Create arm
    const arm = this.createArm();
    arm.group.position.set(BODY_LENGTH / 2 - 0.01, BODY_HEIGHT / 2 + 0.015, 0);
    this.body.add(arm.group);
  }

  createLeg(legNum: string, flip: number) {
    const leg = {
      group: new THREE.Group(),
      elbowJoint: new THREE.Group(),
      armJoint: new THREE.Group(),
      shoulderJoint: new THREE.Group()
    };

    // Elbow joint
    leg.elbowJoint.position.z = -flip * 0.025;
    leg.group.add(leg.elbowJoint);

    // Leg bracket
    const legBracketGeometry = new THREE.BoxGeometry(0.02, 0.015, HIP_OFFSET * 1.7);
    const legBracketMaterial = new THREE.MeshPhongMaterial({ color: LEG_COLOR });
    const legBracket = new THREE.Mesh(legBracketGeometry, legBracketMaterial);
    legBracket.position.z = flip * (HIP_OFFSET * 1.7) / 2;
    legBracket.castShadow = true;
    leg.elbowJoint.add(legBracket);
    const elbowServo = this.createServo();
    elbowServo.rotation.x = Math.PI / 2;
    leg.elbowJoint.add(elbowServo);

    // Arm joint
    leg.armJoint.position.y = -0.001;
    leg.armJoint.position.z = flip * 0.032;
    leg.elbowJoint.add(leg.armJoint);
    const armServo = this.createServo();
    armServo.rotation.y = Math.PI / 2;
    leg.armJoint.add(armServo);

    // Upper leg segment
    const upperLeg = this.createLegSegment(LEG_UPPER_LENGTH);
    upperLeg.position.y = -LEG_UPPER_LENGTH / 2 - 0.001;
    leg.armJoint.add(upperLeg);

    // Shoulder joint
    leg.shoulderJoint.position.y = -LEG_UPPER_LENGTH - 0.001;
    leg.armJoint.add(leg.shoulderJoint);
    const shoulderServo = this.createServo();
    shoulderServo.rotation.y = Math.PI / 2;
    leg.shoulderJoint.add(shoulderServo);

    // Lower leg segment
    const lowerLeg = this.createLegSegment(LEG_LOWER_LENGTH);
    lowerLeg.position.y = -LEG_LOWER_LENGTH / 2 - 0.008;
    leg.shoulderJoint.add(lowerLeg);

    // Foot
    const footGeometry = new THREE.SphereGeometry(0.008, 8, 8);
    const footMaterial = new THREE.MeshPhongMaterial({ color: 0x444444 });
    const foot = new THREE.Mesh(footGeometry, footMaterial);
    foot.position.y = -LEG_LOWER_LENGTH - 0.008;
    foot.castShadow = true;
    leg.shoulderJoint.add(foot);

    this.joints[`${legNum}1`] = leg.shoulderJoint;
    this.joints[`${legNum}2`] = leg.armJoint;
    this.joints[`${legNum}3`] = leg.elbowJoint;

    return leg;
  }

  createLegSegment(length: number) {
    const geometry = new THREE.BoxGeometry(LEG_WIDTH, length, LEG_WIDTH);
    const material = new THREE.MeshPhongMaterial({ color: LEG_COLOR });
    const segment = new THREE.Mesh(geometry, material);
    segment.castShadow = true;
    return segment;
  }

  createServo() {
    const geometry = new THREE.CylinderGeometry(0.009, 0.009, 0.022, 16);
    const material = new THREE.MeshPhongMaterial({ color: SERVO_COLOR });
    const servo = new THREE.Mesh(geometry, material);
    servo.rotation.z = Math.PI / 2;
    servo.castShadow = true;
    return servo;
  }

  createArm() {
    const arm = {
      group: new THREE.Group(),
      baseJoint: new THREE.Group(),
      shoulderJoint: new THREE.Group(),
      gripperJoint: new THREE.Group(),
      leftJaw: new THREE.Group(),
      rightJaw: new THREE.Group()
    };

    arm.group.add(arm.baseJoint);
    const baseServo = this.createServo();
    baseServo.rotation.y = Math.PI / 2;
    arm.baseJoint.add(baseServo);

    // Vertical arm segment
    const verticalArm = this.createArmSegment(ARM_SEGMENT_LENGTH * 1.6);
    verticalArm.position.y = ARM_SEGMENT_LENGTH * 0.8;
    arm.baseJoint.add(verticalArm);

    // Shoulder joint
    arm.shoulderJoint.position.set(0, ARM_SEGMENT_LENGTH * 1.6 + 0.008, 0);
    arm.baseJoint.add(arm.shoulderJoint);
    const shoulderServo = this.createServo();
    shoulderServo.rotation.y = Math.PI / 2;
    arm.shoulderJoint.add(shoulderServo);

    // Upper arm segment
    const upperArm = this.createArmSegment(ARM_SEGMENT_LENGTH * 2);
    upperArm.position.set(ARM_SEGMENT_LENGTH, 0.007, 0);
    upperArm.rotation.z = Math.PI / 2;
    arm.shoulderJoint.add(upperArm);

    // Gripper joint
    arm.gripperJoint.position.set(ARM_SEGMENT_LENGTH * 2, 0.015, 0);
    arm.shoulderJoint.add(arm.gripperJoint);

    // Gripper base
    const gripperBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.015, 0.025),
      new THREE.MeshPhongMaterial({ color: GRIPPER_COLOR })
    );
    arm.gripperJoint.add(gripperBase);

    // Jaws
    arm.leftJaw.position.set(0.01, 0, 0.008);
    arm.gripperJoint.add(arm.leftJaw);
    const leftJawMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.025, 0.008, 0.004),
      new THREE.MeshPhongMaterial({ color: GRIPPER_COLOR })
    );
    leftJawMesh.position.x = 0.0125;
    arm.leftJaw.add(leftJawMesh);
    const leftTip = new THREE.Mesh(
      new THREE.BoxGeometry(0.008, 0.012, 0.004),
      new THREE.MeshPhongMaterial({ color: 0x444444 })
    );
    leftTip.position.set(0.025 + 0.004, -0.002, 0);
    arm.leftJaw.add(leftTip);

    arm.rightJaw.position.set(0.01, 0, -0.008);
    arm.gripperJoint.add(arm.rightJaw);
    const rightJawMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.025, 0.008, 0.004),
      new THREE.MeshPhongMaterial({ color: GRIPPER_COLOR })
    );
    rightJawMesh.position.x = 0.0125;
    arm.rightJaw.add(rightJawMesh);
    const rightTip = new THREE.Mesh(
      new THREE.BoxGeometry(0.008, 0.012, 0.004),
      new THREE.MeshPhongMaterial({ color: 0x444444 })
    );
    rightTip.position.set(0.025 + 0.004, -0.002, 0);
    arm.rightJaw.add(rightTip);

    this.joints['53'] = arm.baseJoint;
    this.joints['52'] = arm.shoulderJoint;
    this.joints['51'] = arm.gripperJoint;
    this.gripperJaws = { left: arm.leftJaw, right: arm.rightJaw };

    return arm;
  }

  createArmSegment(length: number) {
    const geometry = new THREE.BoxGeometry(0.012, length, 0.012);
    const material = new THREE.MeshPhongMaterial({ color: ARM_COLOR });
    const segment = new THREE.Mesh(geometry, material);
    segment.castShadow = true;
    return segment;
  }

  setServoPositions(positions: number[]) {
    if (positions.length >= 15) {
      this.servoPositions = positions.slice(0, 15);
      this.updateJoints();
    }
  }

  setServoAngles(angles: number[]) {
    if (angles.length >= 15) {
      this.servoAngles = angles.slice(0, 15);
      this.updateJoints();
    }
  }

  setServoPosition(index: number, position: number) {
    if (index < 0 || index >= this.servoPositions.length) {
      return;
    }
    this.servoPositions[index] = position;
    this.updateJoints();
  }

  updateJoints() {
    const servoIds = [
      '11', '12', '13', '21', '22', '23',
      '31', '32', '33', '41', '42', '43',
      '51', '52', '53'
    ];

    servoIds.forEach((id, index) => {
      const joint = this.joints[id];
      if (!joint) return;

      const jointNum = parseInt(id[1]);
      const hasAngles = this.servoAngles !== null;
      const angleDeg = hasAngles ? this.servoAngles![index] : 0;
      const angleRad = angleDeg * Math.PI / 180;

      // gripper - uses position for jaw opening
      if (id === '51') {
        const clamped = Math.min(255, Math.max(0, this.servoPositions[index]));
        const openRatio = 1 - (clamped / 255);
        const openAmount = openRatio * GRIPPER_MAX_OPEN;
        if (this.gripperJaws) {
          this.gripperJaws.left.position.z = 0.008 + Math.max(0, openAmount);
          this.gripperJaws.right.position.z = -0.008 - Math.max(0, openAmount);
        }

      // arm servos
      } else if (id === '53') {
          // Base servo: -10 degree offset
          const adjustedAngle = (angleDeg - 5) * Math.PI / 180;
          joint.rotation.z = -adjustedAngle;
      } else if (id === '52') {
          // Shoulder servo: +20 degree offset
          const adjustedAngle = (angleDeg + 20) * Math.PI / 180;
          joint.rotation.z = -adjustedAngle;

      // leg servos
      } else {

        // elbow (x3) - rotates around X axis
        if (jointNum === 3) {
          // Offset by 360° for the 3D model coordinate system
          const adjustedAngle = (angleDeg + 360) * Math.PI / 180;
          if (id === '23' || id === '33') {
            joint.rotation.x = -adjustedAngle;
          } else {
            joint.rotation.x = adjustedAngle;
          }
        }
        // shoulder (x1) - rotates around Z axis
        else if (jointNum === 1) {
          // Map angle to 3D model: offset by 300° for standing pose
          const adjustedAngle = (angleDeg + 300) * Math.PI / 210;
          joint.rotation.z = -adjustedAngle;
        }
        // arm (x2) - rotates around Z axis
        else if (jointNum === 2) {
          joint.rotation.z = -angleRad;
        }
      }
    });
  }

  setOrientation(roll: number, pitch: number, yaw: number) {
    const pitchRad = -pitch * Math.PI / 180;
    const yawRad = yaw * Math.PI / 180;
    const rollRad = roll * Math.PI / 180;
    this.body.rotation.set(rollRad, yawRad, pitchRad, 'YXZ');
  }

  reset() {
    this.servoPositions = Array(this.servoPositions.length).fill(SERVO_NEUTRAL);
    this.updateJoints();
    this.body.rotation.set(0, 0, 0);
  }

  stand() {
    this.servoPositions = DEFAULT_SERVO_POSITIONS.slice();
    this.updateJoints();
  }
}

export default function YahboomDogzillaLiteViewer({
  status,
  servoPositions,
  servoAngles,
  cameraPreset = 'iso',
  refreshToken,
  className = 'h-full min-h-[280px] w-full overflow-hidden'
}: YahboomDogzillaLiteViewerProps) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const robotRef = useRef<YahboomDogzillaLiteRobot | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animationIdRef = useRef<number>(0);
  const targetOrientationRef = useRef<{ roll: number; pitch: number; yaw: number } | null>(null);
  const currentOrientationRef = useRef<{ roll: number; pitch: number; yaw: number } | null>(null);

  const ORIENTATION_LERP = 0.12;
  const ORIENTATION_DEADBAND_DEG = 1;

  const lerpAngleDeg = (current: number, target: number, t: number) => {
    let diff = target - current;
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;
    return current + diff * t;
  };

  const disposeGrid = (grid: THREE.GridHelper | null) => {
    if (!grid) return;
    grid.geometry.dispose();
    if (Array.isArray(grid.material)) {
      grid.material.forEach((material) => material.dispose());
    } else {
      grid.material.dispose();
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x303030);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.01, 100);
    camera.position.set(0.3, 0.25, 0.3);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 5);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    // Robot
    const robot = new YahboomDogzillaLiteRobot();
    scene.add(robot.group);
    robotRef.current = robot;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.minDistance = 0.15;
    controls.maxDistance = 2;
    controls.target.set(0, STANDING_HEIGHT, 0);
    controls.update();
    controlsRef.current = controls;

    // Animation loop
    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);
      if (robotRef.current && targetOrientationRef.current) {
        const target = targetOrientationRef.current;
        const current = currentOrientationRef.current ?? {
          roll: target.roll,
          pitch: target.pitch,
          yaw: target.yaw
        };
        const next = {
          roll: THREE.MathUtils.lerp(current.roll, target.roll, ORIENTATION_LERP),
          pitch: THREE.MathUtils.lerp(current.pitch, target.pitch, ORIENTATION_LERP),
          yaw: lerpAngleDeg(current.yaw, target.yaw, ORIENTATION_LERP)
        };
        currentOrientationRef.current = next;
        robotRef.current.setOrientation(next.roll, next.pitch, next.yaw);
      }
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const resizeRenderer = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return;

      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const resizeObserver = new ResizeObserver(resizeRenderer);
    resizeObserver.observe(container);
    window.addEventListener('resize', resizeRenderer);
    resizeRenderer();

    return () => {
      window.removeEventListener('resize', resizeRenderer);
      resizeObserver.disconnect();
      cancelAnimationFrame(animationIdRef.current);
      if (gridRef.current) {
        scene.remove(gridRef.current);
        disposeGrid(gridRef.current);
        gridRef.current = null;
      }
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const colors = getRendererThemeColors(theme);
    scene.background = colors.sceneBackground;

    if (gridRef.current) {
      scene.remove(gridRef.current);
      disposeGrid(gridRef.current);
    }

    const grid = new THREE.GridHelper(2, 20, colors.gridPrimary, colors.gridSecondary);
    gridRef.current = grid;
    scene.add(grid);
  }, [theme]);

  // Update robot when status changes
  useEffect(() => {
    if (!robotRef.current || !status) return;

    if (status.orientation) {
      const next = {
        roll: status.orientation.roll || 0,
        pitch: status.orientation.pitch || 0,
        yaw: status.orientation.yaw || 0
      };
      const prevTarget = targetOrientationRef.current;
      if (
        !prevTarget ||
        Math.abs(next.roll - prevTarget.roll) >= ORIENTATION_DEADBAND_DEG ||
        Math.abs(next.pitch - prevTarget.pitch) >= ORIENTATION_DEADBAND_DEG ||
        Math.abs(next.yaw - prevTarget.yaw) >= ORIENTATION_DEADBAND_DEG
      ) {
        targetOrientationRef.current = next;
      }
    }
  }, [status]);

  useEffect(() => {
    if (!robotRef.current) return;
    const positions = servoPositions ?? status?.servoPositions;
    if (positions && positions.length >= 15) {
      robotRef.current.setServoPositions(positions as number[]);
    }
    const angles = servoAngles ?? status?.servoAngles;
    if (angles && angles.length >= 15) {
      robotRef.current.setServoAngles(angles as number[]);
    }
  }, [servoPositions, servoAngles, status?.servoPositions, status?.servoAngles]);

  useEffect(() => {
    if (!cameraRef.current || !controlsRef.current) return;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const distance = 0.4;

    switch (cameraPreset) {
      case 'top':
        camera.position.set(0, distance, 0.001);
        break;
      case 'front':
        camera.position.set(distance, 0.15, 0);
        break;
      case 'side':
        camera.position.set(0, 0.15, distance);
        break;
      case 'iso':
      default:
        camera.position.set(0.3, 0.25, 0.3);
        break;
    }
    controls.update();
  }, [cameraPreset]);

  useEffect(() => {
    if (!containerRef.current || !cameraRef.current || !controlsRef.current || !rendererRef.current) return;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const renderer = rendererRef.current;
    const distance = 0.4;

    switch (cameraPreset) {
      case 'top':
        camera.position.set(0, distance, 0.001);
        break;
      case 'front':
        camera.position.set(distance, 0.15, 0);
        break;
      case 'side':
        camera.position.set(0, 0.15, distance);
        break;
      case 'iso':
      default:
        camera.position.set(0.3, 0.25, 0.3);
        break;
    }

    controls.target.set(0, STANDING_HEIGHT, 0);
    controls.update();
    camera.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
  }, [refreshToken, cameraPreset]);

  return <div ref={containerRef} className={className} />;
}
