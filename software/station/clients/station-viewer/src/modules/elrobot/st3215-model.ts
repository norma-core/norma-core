import { st3215Model } from '@/modules/st3215/define-model';
import {
  ELROBOT_DEVICE_ID,
  ELROBOT_MOTOR_COUNT,
  elrobotBasePos,
  elrobotBaseRpy,
  elrobotJointNames,
  elrobotUrdfPath,
  resolveElrobotJointValue,
} from './config';

export default st3215Model({
  id: ELROBOT_DEVICE_ID,
  label: 'ElRobot',
  motorCount: ELROBOT_MOTOR_COUNT,
  kinematics: {
    urdfPath: elrobotUrdfPath,
    basePos: elrobotBasePos,
    baseRpy: elrobotBaseRpy,
    jointNames: elrobotJointNames,
    resolveJointValue: resolveElrobotJointValue,
  },
  loadRenderer: () => import('./Renderer'),
});
