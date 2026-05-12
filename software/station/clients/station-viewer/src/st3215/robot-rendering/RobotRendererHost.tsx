import { forwardRef, lazy, memo, Suspense, useImperativeHandle, useMemo, useRef } from 'react';
import { findSt3215DeviceDefinition } from '@/devices/registry';
import type {
  BaseRobotRendererRef,
  St3215RobotRendererProps,
} from './types';

const RobotRendererHostComponent = forwardRef<BaseRobotRendererRef, St3215RobotRendererProps>(
  function RobotRendererHost(props, ref) {
    const childRef = useRef<BaseRobotRendererRef>(null);
    const motorCount = props.bus.motors?.length ?? 0;
    const definition = findSt3215DeviceDefinition(props.bus);
    // Registry entries are module-scope objects, so this identity is stable
    // while the matched device stays the same.
    const LazyRenderer = useMemo(
      () => definition ? lazy(definition.load) : null,
      [definition],
    );

    useImperativeHandle(ref, () => ({
      toggleRangeSpheres: () => {
        childRef.current?.toggleRangeSpheres();
      },
    }));

    if (!LazyRenderer) {
      // Callers normally gate unsupported devices; keep this for direct host use
      // or bus state changes between the gate and render.
      return (
        <div className="flex h-full w-full items-center justify-center bg-surface-primary/20 p-4 text-center text-accent-warning">
          No ST3215 device module registered for {motorCount} motors.
        </div>
      );
    }

    return (
      <Suspense fallback={<div className="flex h-full w-full items-center justify-center bg-surface-primary/20 text-accent-data">Loading device...</div>}>
        <LazyRenderer {...props} ref={childRef} />
      </Suspense>
    );
  },
);

const RobotRendererHost = memo(RobotRendererHostComponent);
RobotRendererHost.displayName = 'RobotRendererHost';

export default RobotRendererHost;
