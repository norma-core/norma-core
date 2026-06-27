import type { st3215 } from '@/api/proto.js';
import type { St3215RobotModelModule } from '@/devices/types';
import {
  ELROBOT_DEVICE_ID,
  ELROBOT_MOTOR_COUNT,
  elrobotBasePos,
  elrobotBaseRpy,
  elrobotJointNames,
  elrobotUrdfPath,
  resolveElrobotJointValue,
} from './config';

const elrobotSt3215Model = {
  id: ELROBOT_DEVICE_ID,
  label: 'ElRobot',
  order: 20,
  motorCount: ELROBOT_MOTOR_COUNT,
  matches: (bus: st3215.InferenceState.IBusState): boolean =>
    (bus.motors?.length ?? 0) === ELROBOT_MOTOR_COUNT,
  kinematics: {
    id: ELROBOT_DEVICE_ID,
    label: 'ElRobot',
    motorCount: ELROBOT_MOTOR_COUNT,
    urdfPath: elrobotUrdfPath,
    basePos: elrobotBasePos,
    baseRpy: elrobotBaseRpy,
    jointNames: elrobotJointNames,
    resolveJointValue: resolveElrobotJointValue,
  },
  loadRenderer: () => import('./Renderer'),
} satisfies St3215RobotModelModule;

export default elrobotSt3215Model;
