import { forwardRef } from 'react';
import BaseRobotRenderer from '@/st3215/robot-rendering/BaseRobotRenderer';
import type {
  BaseRobotRendererRef,
  St3215RobotRendererProps,
} from '@/st3215/robot-rendering/types';
import {
  elrobotBasePos,
  elrobotBaseRpy,
  resolveElrobotJointNames,
  resolveElrobotJointValue,
  resolveElrobotMotorMaterialIndex,
  resolveElrobotUrdfPath,
} from './config';

const ElRobotDeviceRenderer = forwardRef<BaseRobotRendererRef, St3215RobotRendererProps>(
  function ElRobotDeviceRenderer({ busSerialNumber, bus, isLeader }, ref) {
    const jointNames = resolveElrobotJointNames(isLeader);
    const motorCount = bus.motors?.length ?? jointNames.length;

    return (
      <BaseRobotRenderer
        ref={ref}
        busSerialNumber={busSerialNumber}
        bus={bus}
        isLeader={isLeader}
        urdfPath={resolveElrobotUrdfPath(isLeader)}
        jointNames={jointNames.slice(0, motorCount)}
        basePos={elrobotBasePos}
        baseRpy={elrobotBaseRpy}
        resolveMotorMaterialIndex={resolveElrobotMotorMaterialIndex}
        resolveJointValue={resolveElrobotJointValue}
      />
    );
  },
);

export default ElRobotDeviceRenderer;
