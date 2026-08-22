///////////////////////
// Math utilities
///////////////////////

export function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}

export function normalize(
  v: [number, number, number],
): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len === 0 ? [0, 0, 0] : [v[0] / len, v[1] / len, v[2] / len];
}

// 4x4 matrix as flat array (column-major or row-major doesn't matter as long as we are consistent).
// Here we use row-major: m[row][col] → m[4*row+col].

export function mat4Identity(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function mat4Multiply(a: number[], b: number[]): number[] {
  const out = new Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[4 * r + c] =
        a[4 * r + 0] * b[4 * 0 + c] +
        a[4 * r + 1] * b[4 * 1 + c] +
        a[4 * r + 2] * b[4 * 2 + c] +
        a[4 * r + 3] * b[4 * 3 + c];
    }
  }
  return out;
}

export function mat4FromRotationTranslation(
  R: number[],
  t: [number, number, number],
): number[] {
  // R is 3x3 as array[9], row-major, t is [x,y,z]
  return [
    R[0],
    R[1],
    R[2],
    t[0],
    R[3],
    R[4],
    R[5],
    t[1],
    R[6],
    R[7],
    R[8],
    t[2],
    0,
    0,
    0,
    1,
  ];
}

export function extractTranslationFromMat4(
  m: number[],
): [number, number, number] {
  // last column, row-major
  return [m[3], m[7], m[11]];
}

///////////////////////
// Rotations
///////////////////////

// URDF rpy: roll (X), pitch (Y), yaw (Z), fixed axes, applied in that order.
// Rotation matrix = Rz(yaw) * Ry(pitch) * Rx(roll)
export function rpyToMatrix(
  roll: number,
  pitch: number,
  yaw: number,
): number[] {
  const cr = Math.cos(roll),
    sr = Math.sin(roll);
  const cp = Math.cos(pitch),
    sp = Math.sin(pitch);
  const cy = Math.cos(yaw),
    sy = Math.sin(yaw);

  const Rx = [1, 0, 0, 0, cr, -sr, 0, sr, cr];

  const Ry = [cp, 0, sp, 0, 1, 0, -sp, 0, cp];

  const Rz = [cy, -sy, 0, sy, cy, 0, 0, 0, 1];

  // 3x3 multiply helper
  function mat3Mul(a: number[], b: number[]): number[] {
    const o = new Array(9);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        o[3 * r + c] =
          a[3 * r + 0] * b[3 * 0 + c] +
          a[3 * r + 1] * b[3 * 1 + c] +
          a[3 * r + 2] * b[3 * 2 + c];
      }
    }
    return o;
  }

  return mat3Mul(Rz, mat3Mul(Ry, Rx));
}

// Axis-angle rotation (Rodrigues' formula)
export function axisAngleToMatrix(
  axis: [number, number, number],
  angle: number,
): number[] {
  const [x0, y0, z0] = normalize(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const C = 1 - c;

  const x = x0,
    y = y0,
    z = z0;

  return [
    c + x * x * C,
    x * y * C - z * s,
    x * z * C + y * s,
    y * x * C + z * s,
    c + y * y * C,
    y * z * C - x * s,
    z * x * C - y * s,
    z * y * C + x * s,
    c + z * z * C,
  ];
}

///////////////////////
// 1. Parse URDF
///////////////////////

export interface UrdfOrigin {
  xyz: [number, number, number];
  rpy: [number, number, number];
}

export interface UrdfJoint {
  name: string;
  type: string;
  parent: string;
  child: string;
  origin: UrdfOrigin;
  axis: [number, number, number];
}

export interface UrdfModel {
  baseLink: string;
  joints: { [jointName: string]: UrdfJoint };
  chain: string[];
}

/**
 * Parse a URDF string and build a simple kinematic model.
 * Assumes a single chain (no branches) for simplicity.
 *
 * Returns:
 * {
 *   baseLink: "base_link_name",
 *   joints: { [jointName]: {name, type, parent, child, origin, rpy, axis} },
 *   chain: [jointName0, jointName1, ...] // ordered from base to end-effector
 * }
 */
export function parseUrdf(urdfString: string): UrdfModel {
  const parser = new DOMParser();
  const xml = parser.parseFromString(urdfString, "application/xml");

  const jointNodes = Array.from(xml.getElementsByTagName("joint"));

  const joints: { [jointName: string]: UrdfJoint } = {};
  const parentLinks = new Set<string>();
  const childLinks = new Set<string>();

  jointNodes.forEach((jn) => {
    const name = jn.getAttribute("name")!;
    const type = jn.getAttribute("type")!;

    const parent = jn.getElementsByTagName("parent")[0].getAttribute("link")!;
    const child = jn.getElementsByTagName("child")[0].getAttribute("link")!;

    parentLinks.add(parent);
    childLinks.add(child);

    const originNode = jn.getElementsByTagName("origin")[0];
    const axisNode = jn.getElementsByTagName("axis")[0];

    const xyzStr = originNode
      ? originNode.getAttribute("xyz") || "0 0 0"
      : "0 0 0";
    const rpyStr = originNode
      ? originNode.getAttribute("rpy") || "0 0 0"
      : "0 0 0";
    const axisStr = axisNode
      ? axisNode.getAttribute("xyz") || "0 0 1"
      : "0 0 1";

    const xyz = xyzStr.trim().split(/\s+/).map(Number) as [
      number,
      number,
      number,
    ];
    const rpy = rpyStr.trim().split(/\s+/).map(Number) as [
      number,
      number,
      number,
    ];
    const axis = axisStr.trim().split(/\s+/).map(Number) as [
      number,
      number,
      number,
    ];

    joints[name] = {
      name,
      type,
      parent,
      child,
      origin: { xyz, rpy }, // note: rpy in radians already in URDF; if deg, convert.
      axis,
    };
  });

  // Find base link: parent but never child
  let baseLink: string | null = null;
  for (const pl of parentLinks) {
    if (!childLinks.has(pl)) {
      baseLink = pl;
      break;
    }
  }
  if (!baseLink) {
    throw new Error("Could not determine base link from URDF");
  }

  // Build chain: follow joints from base link until end (simple chain only)
  const chain: string[] = [];
  let currentParent = baseLink;

  // Up to N joints to prevent infinite loops
  for (let iter = 0; iter < jointNodes.length; iter++) {
    const nextJoint = Object.values(joints).find(
      (j) => j.parent === currentParent && j.type !== "fixed",
    );
    if (!nextJoint) break;
    chain.push(nextJoint.name);
    currentParent = nextJoint.child;
  }

  return {
    baseLink,
    joints,
    chain,
  };
}

///////////////////////
// 2. Forward kinematics
///////////////////////

export interface JointWorldTransform {
  transform: number[];
  position: [number, number, number];
}

export interface ComputeJointWorldTransformsResult {
  jointWorld: { [jointName: string]: JointWorldTransform };
  linkWorld: { [linkName: string]: JointWorldTransform };
  endEffector: {
    link: string;
    transform: number[];
    position: [number, number, number];
  };
}

/**
 * Compute world transforms and positions of all joints in the chain.
 *
 * model: result of parseUrdf(…)
 * jointAngles: object { [jointName]: angleInRadians }
 * baseTransform: optional 4x4 matrix for world->base. Default: identity.
 * gripperTipOffset: optional offset from gripper link to gripper tip. Default: from URDF gripperframe.
 *
 * Returns:
 * {
 *   jointWorld: {
 *     [jointName]: {
 *       transform: [16], // 4x4
 *       position: [x,y,z]
 *     }
 *   },
 *   linkWorld: {
 *     [linkName]: {
 *       transform: [16],
 *       position: [x,y,z]
 *     }
 *   },
 *   endEffector: {
 *     link: "last_link_name",
 *     transform: [16],
 *     position: [x,y,z]
 *   }
 * }
 */
export function computeJointWorldTransforms(
  model: UrdfModel,
  jointAngles: { [jointName: string]: number },
  baseTransform?: number[] | null,
  gripperTipOffset?: {
    xyz: [number, number, number];
    rpy: [number, number, number];
  } | null,
): ComputeJointWorldTransformsResult {
  const { baseLink, joints, chain } = model;
  const T_world_base = baseTransform || mat4Identity();

  const jointWorld: { [jointName: string]: JointWorldTransform } = {};
  const linkWorld: { [linkName: string]: JointWorldTransform } = {};

  // base link in world
  linkWorld[baseLink] = {
    transform: T_world_base,
    position: extractTranslationFromMat4(T_world_base),
  };

  let currentParentLink = baseLink;

  chain.forEach((jointName) => {
    const j = joints[jointName];
    const q = jointAngles[jointName] || 0;

    // 1) fixed origin transform (parent link -> joint frame origin)
    const [ox, oy, oz] = j.origin.xyz;
    const [rr, rp, ry] = j.origin.rpy; // assume already radians
    const R_origin = rpyToMatrix(rr, rp, ry);
    const T_parent_origin = mat4FromRotationTranslation(R_origin, [ox, oy, oz]);

    // 2) joint rotation around axis
    const R_axis = axisAngleToMatrix(j.axis, q);
    const T_origin_joint = mat4FromRotationTranslation(R_axis, [0, 0, 0]);

    // 3) parent link -> joint
    const T_parent_joint = mat4Multiply(T_parent_origin, T_origin_joint);

    // 4) world -> parent link
    const T_world_parent = linkWorld[currentParentLink].transform;

    // 5) world -> joint
    const T_world_joint = mat4Multiply(T_world_parent, T_parent_joint);

    jointWorld[jointName] = {
      transform: T_world_joint,
      position: extractTranslationFromMat4(T_world_joint),
    };

    // 6) Assume joint frame == child link frame
    linkWorld[j.child] = {
      transform: T_world_joint,
      position: extractTranslationFromMat4(T_world_joint),
    };

    currentParentLink = j.child;
  });

  const endEffectorLink = currentParentLink;
  let eeTransform = linkWorld[endEffectorLink].transform;
  let eePos = linkWorld[endEffectorLink].position;

  const defaultGripperOffset = {
    xyz: [0, 0, 0],
    rpy: [0, 0, 0],
  };

  const offset = gripperTipOffset || defaultGripperOffset;
  const [ox, oy, oz] = offset.xyz;
  const [rr, rp, ry] = offset.rpy;

  // Create transform from gripper to gripper tip
  const R_offset = rpyToMatrix(rr, rp, ry);
  const T_gripper_tip = mat4FromRotationTranslation(R_offset, [ox, oy, oz]);

  // Compute world transform of gripper tip
  eeTransform = mat4Multiply(eeTransform, T_gripper_tip);
  eePos = extractTranslationFromMat4(eeTransform);

  return {
    jointWorld,
    linkWorld,
    endEffector: {
      link: endEffectorLink,
      transform: eeTransform,
      position: eePos,
    },
  };
}
