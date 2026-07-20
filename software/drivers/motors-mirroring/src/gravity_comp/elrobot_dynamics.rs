//! Static gravity-dynamics model for the ElRobot 7-DOF arm, extracted from
//! `hardware/elrobot/simulation/elrobot_follower.urdf`.
//!
//! Only mass and center-of-mass (CoM) data is needed for a *static* gravity
//! torque (no inertia tensors, no velocity/acceleration terms) - this models
//! how hard gravity pulls on each joint while the arm is held still or moved
//! slowly, which is what "gravity compensation" needs.
//!
//! KNOWN APPROXIMATIONS (documented, not bugs):
//! - The URDF models the follower arm's servos (12V/30kg). The leader uses
//!   physically lighter, different-gear-ratio servos (per the hardware BOM),
//!   so link masses are a first-pass approximation. The empirically-tuned
//!   `gain_rad_per_nm` (see `config::GravityCompConfig`) is the intended lever
//!   for correcting residual error on real hardware, not this mass table.
//! - The gripper subassembly (ST3215_8_v1_1 housing + gear + both jaws) is
//!   lumped into a single fixed point mass attached rigidly at the
//!   Gripper_Base output frame (motor 8's own position), rather than modeled
//!   per-gripper-angle. The URDF's inertial `<origin>` data for the jaw links
//!   contains clearly implausible values (offsets larger than the arm's own
//!   430mm reach - a known artifact of this URDF's CAD export for
//!   prismatic/mimic joints), so those numbers are not usable directly; a
//!   fixed lumped mass at the gripper attachment point is the defensible
//!   approximation given the gripper is compact relative to the rest of the
//!   arm. Motor 8 itself is never enabled/commanded by gravity compensation
//!   in either direction.
//! - Gravity is assumed to act along -Z in this URDF's own base_link frame,
//!   consistent with joint 1's axis being ~(0,0,1) (a base "yaw" joint on an
//!   arm bolted to a table with its output shaft vertical).

use super::kinematics::{Mat3, Vec3};

pub const GRAVITY_MPS2: f64 = 9.81;

/// Number of actuated (compensated) joints: rev_motor_01..rev_motor_07.
pub const JOINT_COUNT: usize = 7;

/// Number of gravity-relevant mass points (link brackets/housings + the
/// lumped gripper tip). Excludes `base_link` and `ST3215_1_v1_1`, which are
/// inboard of joint 1 and so never contribute torque to any actuated joint.
const LINK_COUNT: usize = 14;

/// Translation (parent frame -> child frame) for each `fixed` joint in the
/// chain, in URDF order: Rigid1, Rigid3, Rigid7, Rigid9, Rigid11, Rigid13,
/// Rigid15, Rigid17. All have `rpy="0 0 0"` so no rotation is needed.
const FIXED_OFFSETS: [Vec3; 8] = [
    Vec3::new(0.0, 0.007585, 0.0315),         // Rigid 1: base_link -> ST3215_1_v1_1
    Vec3::new(0.000625, -0.000058, 0.0067),   // Rigid 3: Joint_01_1 -> ST3215_2_v1_1
    Vec3::new(0.019863, -0.000487, 0.055827), // Rigid 7: Joint_02_1 -> ST3215_3_v1_1
    Vec3::new(0.021263, 0.001933, 0.036403),  // Rigid 9: Joint_03_v1_1 -> ST3215_4_v1_1
    Vec3::new(0.020391, 0.065663, -0.010035), // Rigid 11: Joint_04_v1_1 -> ST3215_5_v1_1
    Vec3::new(0.000065, 0.0075, -0.000001),   // Rigid 13: Joint_05_v1_1 -> ST3215_6_v1_1
    Vec3::new(0.020478, 0.038023, -0.010611), // Rigid 15: Joint_06_v1_1 -> ST3215_7_v1_1
    Vec3::new(0.000776, 0.045242, -0.000409), // Rigid 17: Gripper_Base_v1_1 -> ST3215_8_v1_1 (lumped tip attach point)
];

/// Joint pivot origin (relative to the preceding housing frame), in URDF
/// order rev_motor_01..rev_motor_07.
const JOINT_ORIGIN_LOCAL: [Vec3; JOINT_COUNT] = [
    Vec3::new(0.0, 0.034904, 0.017505),
    Vec3::new(-0.020293, -0.000308, 0.035233),
    Vec3::new(-0.019985, -0.000309, 0.035408),
    Vec3::new(-0.02029, 0.035229, 0.000662),
    Vec3::new(0.000323, 0.0172, 0.010051),
    Vec3::new(-0.019988, 0.035407, 0.000351),
    Vec3::new(0.000473, 0.017284, 0.009899),
];

/// Joint rotation axis, expressed in the joint's own (parent-aligned, since
/// all joint `rpy` are zero) frame, as given directly in the URDF `<axis>`.
const JOINT_AXIS_LOCAL: [Vec3; JOINT_COUNT] = [
    Vec3::new(0.0, -0.008727, 0.999962),
    Vec3::new(-0.999962, -0.000076, 0.008726),
    Vec3::new(-0.999848, -0.000152, 0.017452),
    Vec3::new(-0.99981, 0.008574, 0.017527),
    Vec3::new(-0.008573, -0.999963, 0.000151),
    Vec3::new(-0.999697, 0.0173, 0.017525),
    Vec3::new(-0.017144, -0.999812, 0.009029),
];

/// (lower, upper) joint angle limits in radians, matching the URDF `<limit>`
/// and the same convention `resolveElrobotJointValue` uses on the frontend
/// (`devices/elrobot/config.ts`).
pub const JOINT_LIMITS_RAD: [(f64, f64); JOINT_COUNT] = [
    (-1.5509, 1.5509),
    (-1.6122, 1.6122),
    (-1.7610, 1.7610),
    (-1.7533, 1.7533),
    (-2.62, 3.252),
    (-1.3775, 1.7641),
    (-3.2014, 2.7336),
];

/// CoM offset within each link's own frame (URDF `<inertial><origin>`, all
/// `rpy="0 0 0"`), in chain order:
/// L1=Joint_01_1, L2=ST3215_2_v1_1, L3=Joint_02_1, L4=ST3215_3_v1_1,
/// L5=Joint_03_v1_1, L6=ST3215_4_v1_1, L7=Joint_04_v1_1, L8=ST3215_5_v1_1,
/// L9=Joint_05_v1_1, L10=ST3215_6_v1_1, L11=Joint_06_v1_1, L12=ST3215_7_v1_1,
/// L13=Gripper_Base_v1_1, L14=lumped gripper tip (placed exactly at the
/// ST3215_8_v1_1 frame origin, so no further local offset).
const LINK_COM_LOCAL: [Vec3; LINK_COUNT] = [
    Vec3::new(0.00019293358229791917, 0.01053544085767251, -0.002903406181002266),
    Vec3::new(-0.0014235768458915805, -0.00019407288276004214, 0.02268943356342234),
    Vec3::new(0.020187292657891796, -0.0003607149418271213, 0.04048886553547183),
    Vec3::new(-0.0012258665484379326, -0.00019383890721715036, 0.02270059947453923),
    Vec3::new(0.021383489206350224, 0.0025973738142313213, 0.028573272567347596),
    Vec3::new(-0.0014236012890871546, 0.022688801414757966, 0.00021876985314867037),
    Vec3::new(0.02041469568271767, 0.04634775018812741, 0.0004733773672222219),
    Vec3::new(0.00038301708111886123, -0.001621005306100043, 0.022431224025462493),
    Vec3::new(-0.0014511731912585726, 0.014886171505002432, 0.00023918947669937518),
    Vec3::new(-0.0012292541520895308, 0.02270120751988408, 0.000017775252667578956),
    Vec3::new(0.02043403340818753, 0.03197650673728944, 0.0003564813588719795),
    Vec3::new(0.00037315403427122225, -0.0014257132266914385, 0.022445026183495337),
    Vec3::new(0.0005605249651253262, 0.03191999437655846, -0.0005946931738743111),
    Vec3::ZERO,
];

/// Mass (kg) for each link in `LINK_COM_LOCAL` order. L14 is the lumped
/// gripper tip: ST3215_8_v1_1 housing + Gripper_Gear + both jaws
/// (0.03190666159632515 + 0.0024790841259162795 + 0.012492175356778453 * 2).
const LINK_MASS_KG: [f64; LINK_COUNT] = [
    0.036024842090469696,
    0.03190666159632515,
    0.04313419527395414,
    0.03190666159632515,
    0.03705485612134295,
    0.03190666159632515,
    0.04910540016805011,
    0.03190666159632515,
    0.015030395597527186,
    0.03190666159632515,
    0.03727709058376948,
    0.03190666159632515,
    0.046895455343164964,
    0.05937009643579831,
];

/// 0-based index of the last (most distal) actuated joint each link's
/// position depends on. E.g. L2 (ST3215_2_v1_1) is the stator housing for
/// joint 2 but is itself only moved by joint 1's rotation, so it depends on
/// joint 1 only (index 0) and must be excluded from joint 2's torque sum.
const LINK_LAST_JOINT_INDEX: [usize; LINK_COUNT] = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6];

pub struct ChainPose {
    pub joint_pos: [Vec3; JOINT_COUNT],
    pub joint_axis: [Vec3; JOINT_COUNT],
    pub link_com: [Vec3; LINK_COUNT],
}

/// Walks the serial chain at the given joint angles (radians) and returns
/// each joint's pivot position/axis and each link's CoM, all in the
/// `base_link` frame.
pub fn forward_kinematics(theta: &[f64; JOINT_COUNT]) -> ChainPose {
    let mut pos = Vec3::ZERO;
    let mut rot = Mat3::IDENTITY;

    let mut joint_pos = [Vec3::ZERO; JOINT_COUNT];
    let mut joint_axis = [Vec3::ZERO; JOINT_COUNT];
    let mut link_com = [Vec3::ZERO; LINK_COUNT];
    let mut link_idx = 0usize;

    // Rigid 1: base_link -> ST3215_1_v1_1 (fixed, no rotation).
    pos = pos.add(rot.mul_vec3(FIXED_OFFSETS[0]));

    for i in 0..JOINT_COUNT {
        // Joint i pivot, still in the pre-rotation (housing) frame.
        let jp = pos.add(rot.mul_vec3(JOINT_ORIGIN_LOCAL[i]));
        let ja = rot.mul_vec3(JOINT_AXIS_LOCAL[i]).normalize();
        joint_pos[i] = jp;
        joint_axis[i] = ja;

        // Advance to the child (bracket) frame: same origin as the joint
        // pivot, rotated by the joint's own angle about its local axis.
        pos = jp;
        rot = rot.mul_mat3(&Mat3::from_axis_angle(JOINT_AXIS_LOCAL[i], theta[i]));

        // Link: the "Joint_0N" bracket attached directly at this frame.
        link_com[link_idx] = pos.add(rot.mul_vec3(LINK_COM_LOCAL[link_idx]));
        link_idx += 1;

        // Fixed joint to the next housing (or, after joint 7, to the
        // lumped gripper tip attachment point).
        pos = pos.add(rot.mul_vec3(FIXED_OFFSETS[i + 1]));

        if i < JOINT_COUNT - 1 {
            // Link: the next "ST3215_(N+1)" housing, attached here.
            link_com[link_idx] = pos.add(rot.mul_vec3(LINK_COM_LOCAL[link_idx]));
            link_idx += 1;
        } else {
            // Lumped gripper tip mass, placed exactly at this frame's origin.
            link_com[link_idx] = pos;
            link_idx += 1;
        }
    }

    ChainPose { joint_pos, joint_axis, link_com }
}

/// Static gravity torque (Nm) at each of the 7 actuated joints, via the
/// virtual-work / Jacobian-transpose method: for each link, its weight
/// contributes a moment about every joint it is outboard of; the component
/// of that moment along the joint's own axis is the torque gravity exerts
/// through that joint.
pub fn gravity_torques(theta: &[f64; JOINT_COUNT]) -> [f64; JOINT_COUNT] {
    let pose = forward_kinematics(theta);
    let mut tau = [0.0f64; JOINT_COUNT];

    for link in 0..LINK_COUNT {
        let weight = Vec3::new(0.0, 0.0, -LINK_MASS_KG[link] * GRAVITY_MPS2);
        let last_joint = LINK_LAST_JOINT_INDEX[link];

        for joint in 0..=last_joint {
            let arm = pose.link_com[link].sub(pose.joint_pos[joint]);
            let moment = arm.cross(weight);
            tau[joint] += moment.dot(pose.joint_axis[joint]);
        }
    }

    tau
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_pose_produces_finite_torques() {
        let torques = gravity_torques(&[0.0; JOINT_COUNT]);
        for t in torques {
            assert!(t.is_finite());
        }
    }

    #[test]
    fn joint_1_torque_is_negligible_since_its_axis_is_vertical() {
        // Joint 1 rotates about a near-vertical axis, so gravity (acting
        // along -Z) should produce almost no torque about it regardless of
        // pose - a useful sanity check on the sign/axis conventions above.
        let torques = gravity_torques(&[0.3, 0.4, -0.2, 0.5, -0.3, 0.2, 0.1]);
        assert!(torques[0].abs() < 0.05, "joint 1 torque was {}", torques[0]);
    }

    #[test]
    fn shoulder_torque_grows_with_horizontal_reach() {
        // Joint 2 (shoulder) should see more gravity torque when the arm is
        // extended horizontally than when folded straight up.
        let folded = gravity_torques(&[0.0; JOINT_COUNT]);
        let extended = gravity_torques(&[0.0, 1.5, 0.0, 0.0, 0.0, 0.0, 0.0]);
        assert!(
            extended[1].abs() > folded[1].abs(),
            "extended={} folded={}",
            extended[1],
            folded[1]
        );
    }
}
