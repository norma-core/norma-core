import { forwardRef, useImperativeHandle, useRef } from 'react';
import { st3215, usbvideo, ov5647 } from '../api/proto';
import SO101Renderer from './SO101Renderer';
import ElRobotRenderer from './ElRobotRenderer';
import { BaseRobotRendererRef } from './BaseRobotRenderer';
import MotorDataTable from './MotorDataTable';
import { Link } from 'react-router-dom';
import CameraViewer from '../usbvideo/CameraViewer';
import Ov5647CameraViewer from '../ov5647/CameraViewer';

interface BusWebGLRendererProps {
  busSerialNumber: string | null | undefined;
  bus: st3215.InferenceState.IBusState;
  busIndex: number;
  showMotorData?: boolean;
  showCalibrateButton?: boolean;
  needsCalibration?: boolean;
  selectedVideoSource?:
    | { kind: 'usbvideo'; data: usbvideo.IRxEnvelope }
    | { kind: 'ov5647'; data: ov5647.IRxEnvelope };
  isLeader?: boolean;
  inCalibrationView?: boolean;
  isWebControlled?: boolean;
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

  const { bus, showMotorData, busIndex, isWebControlled, selectedVideoSource, showCalibrateButton, needsCalibration, inCalibrationView } = props;

  return (
    <div className="relative w-full h-full">
        {
            (bus.motors?.length || 0) >= 8 ? 
            <ElRobotRenderer {...props} ref={childRef} /> : 
            <SO101Renderer {...props} ref={childRef} />
        }
      <div className="absolute inset-0 w-full h-full z-20 pointer-events-none">
        {showMotorData &&
          <div className="pointer-events-auto">
            <MotorDataTable bus={bus} busIndex={busIndex} isWebControlled={isWebControlled} />
          </div>
        }
        {selectedVideoSource && (
          <div className="absolute top-4 lg:top-auto lg:bottom-4 right-4 w-2/5 h-[200px] pointer-events-auto">
            {selectedVideoSource.kind === 'usbvideo' ? (
              <CameraViewer inferenceState={selectedVideoSource.data} />
            ) : (
              <Ov5647CameraViewer inferenceState={selectedVideoSource.data} />
            )}
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
