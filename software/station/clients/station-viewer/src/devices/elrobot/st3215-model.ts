import { st3215Model } from '@/devices/st3215-model';
import {
  ELROBOT_DEVICE_ID,
  ELROBOT_MOTOR_COUNT,
  elrobotBasePos,
  elrobotBaseRpy,
  elrobotFollowerJointNames,
  resolveElrobotJointValue,
  resolveElrobotUrdfPath,
} from './config';

export default st3215Model({
  id: ELROBOT_DEVICE_ID,
  label: 'ElRobot',
  motorCount: ELROBOT_MOTOR_COUNT,
  // Joint-count lookups (NormVLA) carry no role; a policy acts on the follower.
  kinematics: {
    urdfPath: resolveElrobotUrdfPath('follower'),
    basePos: elrobotBasePos,
    baseRpy: elrobotBaseRpy,
    jointNames: elrobotFollowerJointNames,
    resolveJointValue: resolveElrobotJointValue,
  },
  loadRenderer: () => import('./Renderer'),
});
