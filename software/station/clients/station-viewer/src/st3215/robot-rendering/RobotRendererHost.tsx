import { forwardRef, lazy, memo, Suspense, useImperativeHandle, useMemo, useRef } from 'react';
import { resolveSt3215Model } from '@/devices/st3215-models';
import { useBusRole } from '@/hooks';
import type { BaseRobotRendererRef, St3215BusProps } from './types';

const RobotRendererHostComponent = forwardRef<BaseRobotRendererRef, St3215BusProps>(
  function RobotRendererHost(props, ref) {
    const childRef = useRef<BaseRobotRendererRef>(null);
    const motorCount = props.bus.motors?.length ?? 0;
    const model = resolveSt3215Model(props.bus);
    // Decided here so every caller (live card, calibration, history) gets it.
    const role = useBusRole(props.bus.motors);
    // Registry entries are module-scope objects, so this identity is stable
    // while the matched device stays the same.
    const LazyRenderer = useMemo(
      () => model ? lazy(model.loadRenderer) : null,
      [model],
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

    if (!role) {
      // The URDF depends on the role, so nothing is fetched until a motor reports its voltage.
      return <Placeholder>Detecting arm role...</Placeholder>;
    }

    return (
      <Suspense fallback={<Placeholder>Loading device...</Placeholder>}>
        <LazyRenderer {...props} role={role} ref={childRef} />
      </Suspense>
    );
  },
);

function Placeholder({ children }: { children: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-surface-primary/20 text-accent-data">
      {children}
    </div>
  );
}

const RobotRendererHost = memo(RobotRendererHostComponent);
RobotRendererHost.displayName = 'RobotRendererHost';

export default RobotRendererHost;
