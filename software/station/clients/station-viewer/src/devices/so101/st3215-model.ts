import type { st3215 } from '@/api/proto.js';
import type { St3215RobotModelModule } from '@/devices/types';
import {
  SO101_DEVICE_ID,
  SO101_MOTOR_COUNT,
  resolveSo101UrdfPath,
  so101BasePos,
  so101BaseRpy,
  so101JointNames,
} from './config';

const so101St3215Model = {
  id: SO101_DEVICE_ID,
  label: 'SO101',
  order: 10,
  motorCount: SO101_MOTOR_COUNT,
  matches: (bus: st3215.InferenceState.IBusState): boolean =>
    (bus.motors?.length ?? 0) === SO101_MOTOR_COUNT,
  kinematics: {
    id: SO101_DEVICE_ID,
    label: 'SO101',
    motorCount: SO101_MOTOR_COUNT,
    urdfPath: resolveSo101UrdfPath(false),
    basePos: so101BasePos,
    baseRpy: so101BaseRpy,
    jointNames: so101JointNames,
  },
  loadRenderer: () => import('./Renderer'),
} satisfies St3215RobotModelModule;

export default so101St3215Model;
