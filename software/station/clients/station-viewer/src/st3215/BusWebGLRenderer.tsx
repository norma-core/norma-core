import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Link } from 'react-router-dom';
import { st3215 } from '../api/proto';
import RobotRendererHost from './robot-rendering/RobotRendererHost';
import type { BaseRobotRendererRef } from './robot-rendering/types';
import MotorDataTable from './MotorDataTable';
import CameraViewer from '../usbvideo/CameraViewer';

interface BusWebGLRendererProps {
  busSerialNumber: string | null | undefined;
  bus: st3215.InferenceState.IBusState;
  busIndex: number;
  showMotorData?: boolean;
  showCalibrateButton?: boolean;
  needsCalibration?: boolean;
  selectedVideoSourceId?: string | null;
  isLeader?: boolean;
  inCalibrationView?: boolean;
  isWebControlled?: boolean;
  gravityCompJointGains?: Record<number, number>;
  onGravityCompJointGainChange?: (motorId: number, value: number) => void;
}

export interface BusWebGLRendererRef {
  toggleRangeSpheres: () => void;
}

const BusWebGLRendererComponent = forwardRef<BusWebGLRendererRef, BusWebGLRendererProps>((props, ref) => {
  const childRef = useRef<BaseRobotRendererRef>(null);

  useImperativeHandle(ref, () => ({
    toggleRangeSpheres: () => {
      childRef.current?.toggleRangeSpheres();
    },
  }));

  const { bus, showMotorData, busIndex, isWebControlled, selectedVideoSourceId, showCalibrateButton, needsCalibration, inCalibrationView, gravityCompJointGains, onGravityCompJointGainChange } = props;

  return (
    <div className="relative w-full h-full">
      <RobotRendererHost {...props} ref={childRef} />
      <div className="absolute inset-0 w-full h-full z-20 pointer-events-none">
        {showMotorData &&
          <div className="pointer-events-auto">
            <MotorDataTable
              bus={bus}
              busIndex={busIndex}
              isWebControlled={isWebControlled}
              gravityCompJointGains={gravityCompJointGains}
              onGravityCompJointGainChange={onGravityCompJointGainChange}
            />
          </div>
        }
        {selectedVideoSourceId && (
          <div className="absolute top-4 right-4 h-[200px] w-2/5 max-w-[520px] overflow-hidden rounded-lg border border-border-default bg-black shadow-lg pointer-events-auto">
            <CameraViewer sourceId={selectedVideoSourceId} className="h-full w-full" />
          </div>
        )}
        {showCalibrateButton && !inCalibrationView && needsCalibration && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
            <Link
              to="/st3215-bus-calibration"
              state={{ bus }}
              className="pointer-events-auto px-6 py-3 rounded text-lg font-bold transition-colors bg-accent-success-bg text-text-primary hover:bg-accent-success-deep ring-4 ring-accent-success-deep/50"
            >
              Calibrate
            </Link>
          </div>
        )}
        {showCalibrateButton && !inCalibrationView && !needsCalibration && (
          <div className="absolute top-4 left-4 pointer-events-auto">
            <Link
              to="/st3215-bus-calibration"
              state={{ bus }}
              className="px-4 py-2 rounded text-base font-bold transition-colors bg-accent-success-bg text-text-primary hover:bg-accent-success-deep"
            >
              Calibrate
            </Link>
          </div>
        )}
      </div>
    </div>
  );
});

const BusWebGLRenderer = Object.assign(BusWebGLRendererComponent, {
  canRender: () => {
    try {
      const canvas = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
    } catch {
      return false;
    }
  }
});

export default BusWebGLRenderer;
