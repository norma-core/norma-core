import { st3215Model } from '@/modules/st3215/define-model';
import {
  SO101_DEVICE_ID,
  SO101_MOTOR_COUNT,
  resolveSo101UrdfPath,
  so101BasePos,
  so101BaseRpy,
  so101JointNames,
} from './config';

export default st3215Model({
  id: SO101_DEVICE_ID,
  label: 'SO101',
  motorCount: SO101_MOTOR_COUNT,
  kinematics: {
    urdfPath: resolveSo101UrdfPath(false),
    basePos: so101BasePos,
    baseRpy: so101BaseRpy,
    jointNames: so101JointNames,
  },
  loadRenderer: () => import('./Renderer'),
});
