import { forwardRef } from 'react';
import BaseRobotRenderer from '@/st3215/robot-rendering/BaseRobotRenderer';
import type {
  BaseRobotRendererRef,
  St3215RobotRendererProps,
} from '@/st3215/robot-rendering/types';
import {
  resolveSo101MotorMaterialIndex,
  resolveSo101UrdfPath,
  so101BasePos,
  so101BaseRpy,
} from './config';

const SO101DeviceRenderer = forwardRef<BaseRobotRendererRef, St3215RobotRendererProps>(
  function SO101DeviceRenderer({ busSerialNumber, bus, isLeader }, ref) {
    return (
      <BaseRobotRenderer
        ref={ref}
        busSerialNumber={busSerialNumber}
        bus={bus}
        isLeader={isLeader}
        urdfPath={resolveSo101UrdfPath(isLeader)}
        basePos={so101BasePos}
        baseRpy={so101BaseRpy}
        resolveMotorMaterialIndex={resolveSo101MotorMaterialIndex}
      />
    );
  },
);

export default SO101DeviceRenderer;
