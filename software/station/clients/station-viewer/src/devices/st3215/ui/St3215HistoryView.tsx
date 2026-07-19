import { memo, useMemo } from 'react';
import { st3215 } from '@/api/proto.js';
import type { HistoryExpandedProps } from '@/devices/history';
import { getMotorCurrent, getMotorPosition, getMotorTemperature, getMotorVelocity, isTorqueEnabled } from '@/st3215/motor-parser';
import BusWebGLRenderer from '@/st3215/BusWebGLRenderer';

interface MotorSummaryTableProps {
  motors?: st3215.InferenceState.IMotorState[] | null;
}

const MotorSummaryTable = memo(function MotorSummaryTable({ motors }: MotorSummaryTableProps) {
  const sortedMotors = useMemo(() => {
    if (!motors || motors.length === 0) return [];
    return [...motors].sort((a: st3215.InferenceState.IMotorState, b: st3215.InferenceState.IMotorState) => {
      const aId = a.id ?? Number.POSITIVE_INFINITY;
      const bId = b.id ?? Number.POSITIVE_INFINITY;
      if (aId === bId) {
        return 0;
      }
      return aId < bId ? -1 : 1;
    });
  }, [motors]);

  if (sortedMotors.length === 0) {
    return <div className="text-xs text-text-muted">No motors reported.</div>;
  }



  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs text-text-secondary">
        <thead>
          <tr className="text-text-label border-b-2 border-border-default">
            <th className="text-center font-semibold py-1 pr-3 whitespace-nowrap w-auto">Motor</th>
            <th className="text-center font-semibold py-1 pr-3">Position</th>
            <th className="text-center font-semibold py-1 pr-3">Min</th>
            <th className="text-center font-semibold py-1 pr-3">Max</th>
            <th className="text-center font-semibold py-1 pr-3">Current</th>
            <th className="text-center font-semibold py-1 pr-3">Speed</th>
            <th className="text-center font-semibold py-1 pr-3">Temp</th>
            <th className="text-center font-semibold py-1">Torque</th>
          </tr>
        </thead>
        <tbody>
          {sortedMotors.map((motor, idx) => {
            const state = motor.state ?? null;
            const position = state ? getMotorPosition(state) : null;
            const current = state ? getMotorCurrent(state) : null;
            const velocity = state ? getMotorVelocity(state) : null;
            const temperature = state ? getMotorTemperature(state) : null;
            const driveEnabled = state ? isTorqueEnabled(state) : null;
            const rangeMin = motor.rangeMin;
            const rangeMax = motor.rangeMax;
            const key = motor.id ?? idx;

            return (
              <tr key={key} className={`border-t border-border-default ${idx % 2 === 1 ? 'bg-surface-primary/30' : ''}`}>
                <td className="py-1 pr-3 text-center text-accent-data font-mono whitespace-nowrap">{motor.id ?? '--'}</td>
                <td className="py-1 pr-3 text-center text-accent-secondary">
                  {position === null ? '--' : position}
                </td>
                <td className="py-1 pr-3 text-center text-accent-pink">
                  {rangeMin === null || rangeMin === undefined ? '--' : rangeMin}
                </td>
                <td className="py-1 pr-3 text-center text-accent-pink">
                  {rangeMax === null || rangeMax === undefined ? '--' : rangeMax}
                </td>
                <td className="py-1 pr-3 text-center text-accent-success">
                  {current === null ? '--' : `${current} mA`}
                </td>
                <td className="py-1 pr-3 text-center text-accent-info">
                  {velocity === null ? '--' : velocity}
                </td>
                <td className="py-1 pr-3 text-center text-accent-danger">
                  {temperature === null ? '--' : `${temperature}C`}
                </td>
                <td className="py-1 text-center">
                  {driveEnabled === null ? (
                    <span className="text-text-muted">--</span>
                  ) : driveEnabled ? (
                    <span className="text-accent-success">On</span>
                  ) : (
                    <span className="text-text-muted">Off</span>
                  )}
                </td>
              </tr>
            );
          })}

        </tbody>
      </table>
    </div>
  );
});

const St3215HistoryView = memo(function St3215HistoryView({ entry }: HistoryExpandedProps<st3215.IInferenceState>) {
  const { data } = entry;
  const busCount = data.buses?.length ?? 0;
  const totalMotors = data.buses?.reduce((total, bus) => total + (bus.motors?.length || 0), 0) ?? 0;
  const canRenderWebGL = BusWebGLRenderer.canRender();

  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs text-text-label mb-1">ST3215 Inference State:</div>
        <div className="bg-surface-primary p-2 rounded text-xs space-y-1">
          <div className="text-accent-danger">Type: ST3215 Inference State</div>
          <div className="text-accent-data">Buses: {busCount}</div>
          <div className="text-accent-success">Total Motors: {totalMotors}</div>
        </div>
      </div>

      {busCount === 0 && (
        <div className="bg-surface-primary p-2 rounded text-xs text-text-label">
          No bus data available.
        </div>
      )}

      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3">
        {data.buses?.map((bus, busIndex) => {
          const busLabel = bus.bus?.serialNumber ? `#${bus.bus.serialNumber}` : `Bus ${busIndex + 1}`;
          const motorCount = bus.motors?.length ?? 0;

          return (
            <div key={bus.bus?.serialNumber ?? busIndex} className="bg-surface-primary/60 border border-border-default rounded p-2 space-y-2" data-bus-container={bus.bus?.serialNumber ?? busIndex}>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-accent-data font-mono">{busLabel}</span>
                <span className="text-text-label">Motors: {motorCount}</span>
              </div>
              <div className="flex flex-col lg:flex-row gap-3 max-w-4xl">
                <div className="bg-surface-base rounded w-56 h-56 flex-shrink-0 overflow-hidden">
                  {canRenderWebGL ? (
                    <BusWebGLRenderer
                      busSerialNumber={bus.bus?.serialNumber}
                      bus={bus}
                      busIndex={busIndex}
                    />
                  ) : (
                    <div className="text-xs text-text-muted flex items-center justify-center h-full">
                      WebGL preview unavailable
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <MotorSummaryTable motors={bus.motors} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default St3215HistoryView;
