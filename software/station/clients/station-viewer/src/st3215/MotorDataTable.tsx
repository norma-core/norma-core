import React, { useCallback, useRef, useState } from 'react';
import {st3215} from '../api/proto';
import { ADDR_GOAL_POSITION, MAX_ANGLE_STEP, getEffectiveMotorRange, getMotorPosition, getMotorCurrent, getMotorTemperature } from './motor-parser';
import { serverToLocal } from '../api/timestamp-utils';
import Long from 'long';
import { commandManager } from '../api/commands';
import { getMotorStatusColor, getLatencyTextColor, getCurrentColor, getMotorStatusTextColor, getGradientClass, getTemperatureColor } from '@/utils/color-utils';

interface LatencyReading {
  timestamp: number;
  latency: number;
}

interface LatencyStats {
  avg: number;
  min: number;
  max: number;
}

interface MotorDataTableProps {
  bus: st3215.InferenceState.IBusState;
  busIndex: number;
  isWebControlled?: boolean;
  layout?: 'overlay' | 'panel';
  gravityCompJointGains?: Record<number, number>;
  onGravityCompJointGainChange?: (motorId: number, value: number) => void;
}

interface MotorControlState {
  isDragging: boolean;
  targetPosition: number | null;
  originalPosition: number | null;
}

const MotorDataTable: React.FC<MotorDataTableProps> = ({
  bus,
  busIndex,
  isWebControlled = false,
  layout = 'overlay',
  gravityCompJointGains,
  onGravityCompJointGainChange,
}) => {
  const now = Date.now();
  const latencyHistoryRef = useRef<Map<string, LatencyReading[]>>(new Map());
  const [motorControlStates, setMotorControlStates] = useState<Map<number, MotorControlState>>(new Map());
  const [hoveredMotor, setHoveredMotor] = useState<number | null>(null);
  const buttonIntervalRef = useRef<{ [key: string]: NodeJS.Timeout | null }>({});
  const forceFullServoRange = (bus.motors?.length ?? 0) === 1;
  const showGravityColumn = !!gravityCompJointGains;
  const [editedGravityGains, setEditedGravityGains] = useState<Map<number, number>>(new Map());
  const editingGravityMotorsRef = useRef<Set<number>>(new Set());

  const getGravityGainDisplayValue = useCallback((motorId: number): number => {
    if (editingGravityMotorsRef.current.has(motorId)) {
      return editedGravityGains.get(motorId) ?? gravityCompJointGains?.[motorId] ?? 0;
    }
    return gravityCompJointGains?.[motorId] ?? 0;
  }, [editedGravityGains, gravityCompJointGains]);

  // Function to calculate moving average for latency (15 second window)
  const getMovingAverageLatency = (key: string, currentLatency: number): LatencyStats => {
    // Clamp to prevent negative values
    const validLatency = Math.max(0, currentLatency);
    
    const history = latencyHistoryRef.current.get(key) || [];
    
    // Add current reading
    history.push({ timestamp: now, latency: validLatency });
    
    // Filter to keep only last 15 seconds
    const filtered = history.filter(h => now - h.timestamp <= 15000);
    latencyHistoryRef.current.set(key, filtered);
    
    // Calculate statistics
    if (filtered.length === 0) {
      return { avg: validLatency, min: validLatency, max: validLatency };
    }
    
    const latencies = filtered.map(h => h.latency);
    const sum = latencies.reduce((acc, l) => acc + l, 0);
    
    return {
      avg: sum / filtered.length,
      min: Math.min(...latencies),
      max: Math.max(...latencies)
    };
  };

  const calculatePercentage = (position: number, min: number, max: number) => {
    if (min > max) { // Counter-arc
      const totalRange = (MAX_ANGLE_STEP - min) + max;
      if (totalRange === 0) return 0;
      if (position >= min) {
        return ((position - min) / totalRange) * 100;
      } else {
        return ((MAX_ANGLE_STEP - min + position) / totalRange) * 100;
      }
    }
    if (max === min) return 0;
    return ((position - min) / (max - min)) * 100;
  };

  const getStatusText = (latency: number, hasError: boolean) => {
    if (hasError) return "ERROR";
    if (latency > 500) return "STALE";
    return "OK";
  };

  const moveMotorToPosition = useCallback(async (motorId: number, targetPosition: number) => {
        if (!bus.bus?.serialNumber) return;

        const command = st3215.Command.create({
            targetBusSerial: bus.bus.serialNumber,
            write: {
                motorId: motorId,
                address: ADDR_GOAL_POSITION,
                value: new Uint8Array([targetPosition & 0xFF, (targetPosition >> 8) & 0xFF]),
            }
        });

        // Send command to move motor
        await commandManager.sendSt3215Command(command);
  }, [bus.bus?.serialNumber]);

  const calculateTargetPosition = (motor: st3215.InferenceState.IMotorState, percentage: number) => {
    const { min: rangeMin, max: rangeMax } = getEffectiveMotorRange(motor, {
      forceFullRange: forceFullServoRange,
    });

    if (rangeMin > rangeMax) {
      const totalRange = (MAX_ANGLE_STEP - rangeMin) + rangeMax;
      const offset = (percentage / 100) * totalRange;
      if (offset <= (MAX_ANGLE_STEP - rangeMin)) {
        return Math.round(rangeMin + offset);
      }
      return Math.round(offset - (MAX_ANGLE_STEP - rangeMin));
    }

    return Math.round(rangeMin + (percentage / 100) * (rangeMax - rangeMin));
  };

  const calculatePointerPercentage = (element: HTMLElement, clientX: number) => {
    const rect = element.getBoundingClientRect();
    const x = clientX - rect.left;
    const paddingPercent = 2;
    const effectiveWidth = rect.width * (1 - 2 * paddingPercent / 100);
    const effectiveX = x - rect.width * paddingPercent / 100;
    return Math.max(0, Math.min(100, (effectiveX / effectiveWidth) * 100));
  };

  const setMotorTargetPosition = (
    motor: st3215.InferenceState.IMotorState,
    targetPosition: number,
    isDragging: boolean,
  ) => {
    if (!motor.id) return;

    const currentPosition = motor.state ? getMotorPosition(motor.state) : 0;
    setMotorControlStates(prev => {
      const newMap = new Map(prev);
      newMap.set(motor.id!, {
        isDragging,
        targetPosition,
        originalPosition: prev.get(motor.id!)?.originalPosition ?? currentPosition,
      });
      return newMap;
    });

    moveMotorToPosition(motor.id, targetPosition);
  };

  const handlePointerDown = (motor: st3215.InferenceState.IMotorState, event: React.PointerEvent<HTMLDivElement>) => {
    if (!isWebControlled || !motor.id) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const percentage = calculatePointerPercentage(event.currentTarget, event.clientX);
    setMotorTargetPosition(motor, calculateTargetPosition(motor, percentage), true);
  };

  const handlePointerMove = (motor: st3215.InferenceState.IMotorState, event: React.PointerEvent<HTMLDivElement>) => {
    if (!isWebControlled || !motor.id) return;

    const controlState = motorControlStates.get(motor.id);
    if (!controlState?.isDragging) return;

    const percentage = calculatePointerPercentage(event.currentTarget, event.clientX);
    setMotorTargetPosition(motor, calculateTargetPosition(motor, percentage), true);
  };

  const endPointerDrag = (motor: st3215.InferenceState.IMotorState, event: React.PointerEvent<HTMLDivElement>) => {
    if (!motor.id) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    setMotorControlStates(prev => {
      const newMap = new Map(prev);
      newMap.delete(motor.id!);
      return newMap;
    });
  };

  const handlePointerLeave = (_motorId: number) => {
    setHoveredMotor(null);
  };

  const handleButtonMouseDown = (motor: st3215.InferenceState.IMotorState, increment: boolean) => {
    if (!isWebControlled || !motor.id) return;
    
    const buttonKey = `${motor.id}-${increment ? 'inc' : 'dec'}`;
    
    // Get initial position
    let currentPosition = motor.state ? getMotorPosition(motor.state) : 0;
    const { min: rangeMin, max: rangeMax } = getEffectiveMotorRange(motor, {
      forceFullRange: forceFullServoRange,
    });

    // Calculate step size (1% of range)
    let stepSize: number;
    if (rangeMin > rangeMax) { // Counter-arc
      const totalRange = (MAX_ANGLE_STEP - rangeMin) + rangeMax;
      stepSize = Math.max(1, Math.round(totalRange * 0.01));
    } else {
      stepSize = Math.max(1, Math.round((rangeMax - rangeMin) * 0.01));
    }
    
    // Helper function to calculate next position
    const getNextPosition = (pos: number) => {
      let newPosition: number;
      if (increment) {
        if (rangeMin > rangeMax) { // Counter-arc
          if (pos >= rangeMin || pos < rangeMax) {
            newPosition = pos + stepSize;
            if (pos >= rangeMin && newPosition > MAX_ANGLE_STEP) {
              newPosition = newPosition - MAX_ANGLE_STEP - 1;
            }
            if (newPosition > rangeMax && newPosition < rangeMin) {
              newPosition = rangeMax;
            }
          } else {
            newPosition = pos;
          }
        } else {
          newPosition = Math.min(rangeMax, pos + stepSize);
        }
      } else {
        if (rangeMin > rangeMax) { // Counter-arc
          if (pos >= rangeMin || pos <= rangeMax) {
            newPosition = pos - stepSize;
            if (pos <= rangeMax && newPosition < 0) {
              newPosition = MAX_ANGLE_STEP + newPosition + 1;
            }
            if (newPosition < rangeMin && newPosition > rangeMax) {
              newPosition = rangeMin;
            }
          } else {
            newPosition = pos;
          }
        } else {
          newPosition = Math.max(rangeMin, pos - stepSize);
        }
      }
      return newPosition;
    };
    
    // Send first command immediately
    currentPosition = getNextPosition(currentPosition);
    moveMotorToPosition(motor.id, currentPosition);
    
    // Set up interval for continuous sending
    buttonIntervalRef.current[buttonKey] = setInterval(() => {
      // Calculate next position based on tracked position
      currentPosition = getNextPosition(currentPosition);
      moveMotorToPosition(motor.id!, currentPosition);
    }, 100); // Send command every 100ms while button is held
  };

  const handleButtonMouseUp = (motor: st3215.InferenceState.IMotorState, increment: boolean) => {
    if (!motor.id) return;
    
    const buttonKey = `${motor.id}-${increment ? 'inc' : 'dec'}`;
    
    // Clear the interval
    if (buttonIntervalRef.current[buttonKey]) {
      clearInterval(buttonIntervalRef.current[buttonKey]!);
      buttonIntervalRef.current[buttonKey] = null;
    }
  };

  React.useEffect(() => {
    const buttonIntervals = buttonIntervalRef.current;
    return () => {
      Object.keys(buttonIntervals).forEach(key => {
        if (buttonIntervals[key]) {
          clearInterval(buttonIntervals[key]!);
          buttonIntervals[key] = null;
        }
      });
    };
  }, []);

  if (!bus.motors?.length) {
    return null;
  }

  const tableShellClassName =
    layout === 'panel'
      ? 'absolute bottom-2 left-2 max-h-[calc(100%-1rem)] max-w-[calc(100%-1rem)] overflow-hidden rounded-lg border border-border-default/50 bg-surface-base/80 backdrop-blur-sm'
      : 'absolute bottom-2 left-2 bg-surface-base/80 backdrop-blur-sm rounded-lg overflow-hidden border border-border-default/50 max-w-[calc(100%-1rem)]';

  const tableScrollClassName =
    layout === 'panel' ? 'max-h-full overflow-auto' : 'overflow-x-auto';

  return (
    <div className={tableShellClassName}>
      <div className={tableScrollClassName}>
        <table className="text-xs text-text-label min-w-full">
        <thead className="bg-surface-secondary/80 text-text-label font-bold sticky top-0">
          <tr>
            <th className="px-2 py-1 text-left">ID</th>
            <th className="px-2 py-1 text-right">POS</th>
            <th className="px-2 py-1 text-right">CURR</th>
            <th className="px-2 py-1 text-center" colSpan={3}>RANGE</th>
            <th className="px-2 py-1 text-right">%</th>
            <th className="px-2 py-1 text-right">TEMP</th>
            <th className="px-2 py-1 text-right">LAG</th>
            <th className="px-2 py-1 text-right">MAX</th>
            {showGravityColumn && <th className="px-2 py-1 text-right">GRAV</th>}
            <th className="px-2 py-1 text-left" colSpan={2}>STATUS</th>
          </tr>
        </thead>
        <tbody>
          {[...(bus.motors || [])].sort((a, b) => (a.id || 0) - (b.id || 0)).map((motor, motorIndex) => {
            const controlState = motor.id ? motorControlStates.get(motor.id) : undefined;
            const position = motor.state ? getMotorPosition(motor.state) : 0;
            const current = motor.state ? getMotorCurrent(motor.state) : 0;
            const temperature = motor.state ? getMotorTemperature(motor.state) : 0;
            const effectiveRange = getEffectiveMotorRange(motor, {
              forceFullRange: forceFullServoRange,
            });
            const percentage = calculatePercentage(position, effectiveRange.min, effectiveRange.max);
            const rangeCellTitle = effectiveRange.isFallback
              ? 'Uncalibrated — using full servo range'
              : undefined;
            const rangeCellClass = `px-2 py-1.5 text-text-muted tabular-nums${effectiveRange.isFallback ? ' italic' : ''}`;
            const adjustedMotorStamp = motor.monotonicStampNs ? serverToLocal(Long.fromValue(motor.monotonicStampNs)) : null;
            const latency = adjustedMotorStamp ? (now - (adjustedMotorStamp.toNumber() / 1e6)) : 0;
            const latencyAvg = getMovingAverageLatency(`bus-${busIndex}-motor-${motorIndex}`, latency);
            const hasError = !!motor.error;

            return (
              <tr key={motor.id} className={`hover:bg-surface-primary/50 transition-colors border-b border-border-default/50 ${hasError ? 'bg-accent-critical/10' : ''}`}>
                {/* Motor ID */}
                <td className={`px-2 py-1.5 font-bold ${getMotorStatusColor(latency, hasError)}`}>
                  M{motor.id?.toString()}
                </td>
                
                {/* Position */}
                <td className="px-2 py-1.5 text-accent-success tabular-nums text-right">{position}</td>
                
                {/* Current */}
                <td className={`px-2 py-1.5 ${getCurrentColor(current)} tabular-nums text-right`}>{current}</td>
                
                {/* Range Min */}
                <td className={`${rangeCellClass} text-right`} title={rangeCellTitle}>
                  {effectiveRange.min.toString().padStart(4, '0')}
                </td>
                
                {/* Range Progress Bar */}
                <td className="px-2 py-1.5" style={{ minWidth: '200px' }}>
                  <div className="relative flex items-center gap-1">
                    {/* Decrement button */}
                    {isWebControlled && (
                      <button
                        className="w-6 h-6 bg-surface-tertiary hover:bg-surface-elevated active:bg-surface-active rounded text-text-primary text-xs font-bold transition-colors"
                        onMouseDown={() => handleButtonMouseDown(motor, false)}
                        onMouseUp={() => handleButtonMouseUp(motor, false)}
                        onMouseLeave={() => handleButtonMouseUp(motor, false)}
                        title="Decrease by 1% (hold for continuous)"
                      >
                        -
                      </button>
                    )}
                    <div 
                      className={`bg-surface-secondary rounded-full overflow-hidden relative flex-1 ${
                        isWebControlled ? 'cursor-move hover:bg-surface-tertiary h-5' : 'h-3'
                      } ${controlState?.isDragging ? 'ring-2 ring-accent-info-deep' : ''}`}
                      style={{ touchAction: 'none' }}
                      onPointerDown={(e) => handlePointerDown(motor, e)}
                      onPointerMove={(e) => handlePointerMove(motor, e)}
                      onPointerUp={(e) => endPointerDrag(motor, e)}
                      onPointerCancel={(e) => endPointerDrag(motor, e)}
                      onMouseEnter={() => setHoveredMotor(motor.id || null)}
                      onMouseLeave={() => handlePointerLeave(motor.id || 0)}
                    >
                      {/* Current position bar */}
                      <div 
                        className={`h-full transition-all ${controlState?.isDragging ? 'duration-0' : 'duration-200'} ${getGradientClass(percentage)} ${
                          controlState?.isDragging ? 'opacity-50' : ''
                        }`}
                        style={{ width: `${percentage}%`, pointerEvents: 'none' }}
                      />
                      
                      {/* Target position preview (when dragging) */}
                      {controlState?.isDragging && controlState.targetPosition !== null && (
                        <div
                          className="absolute top-0 h-full bg-accent-info-deep opacity-70"
                          style={{
                            width: `${calculatePercentage(controlState.targetPosition, effectiveRange.min, effectiveRange.max)}%`,
                            pointerEvents: 'none'
                          }}
                        />
                      )}
                      
                      {/* Current position indicator */}
                      <div 
                        className="absolute top-0 h-full w-0.5 bg-text-primary shadow-sm"
                        style={{ left: `${percentage}%`, pointerEvents: 'none' }}
                      />
                      
                      {/* Target position indicator (when dragging) */}
                      {controlState?.isDragging && controlState.targetPosition !== null && (
                        <div
                          className="absolute top-0 h-full w-1 bg-accent-info shadow-lg"
                          style={{
                            left: `${calculatePercentage(controlState.targetPosition, effectiveRange.min, effectiveRange.max)}%`,
                            pointerEvents: 'none'
                          }}
                        />
                      )}
                    </div>
                    
                    {/* Hover tooltip */}
                    {isWebControlled && hoveredMotor === motor.id && !controlState?.isDragging && (
                      <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-surface-primary text-text-primary text-xs px-2 py-1 rounded whitespace-nowrap z-10">
                        Drag to move
                      </div>
                    )}
                    
                    {/* Dragging percentage display */}
                    {controlState?.isDragging && controlState.targetPosition !== null && (
                      <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-accent-info-bg text-text-primary text-xs px-2 py-1 rounded font-bold z-10">
                        {calculatePercentage(controlState.targetPosition, effectiveRange.min, effectiveRange.max).toFixed(1)}%
                      </div>
                    )}

                      {/* Increment button */}
                      {isWebControlled && (
                          <button
                              className="w-6 h-6 bg-surface-tertiary hover:bg-surface-elevated active:bg-surface-active rounded text-text-primary text-xs font-bold transition-colors"
                              onMouseDown={() => handleButtonMouseDown(motor, true)}
                              onMouseUp={() => handleButtonMouseUp(motor, true)}
                              onMouseLeave={() => handleButtonMouseUp(motor, true)}
                              title="Increase by 1% (hold for continuous)"
                          >
                              +
                          </button>
                      )}
                  </div>
                </td>
                
                {/* Range Max */}
                <td className={rangeCellClass} title={rangeCellTitle}>
                  {effectiveRange.max.toString().padStart(4, '0')}
                </td>
                
                {/* Percentage */}
                <td className="px-2 py-1.5 text-accent-info tabular-nums text-right">{percentage.toFixed(1)}%</td>
                
                {/* Temperature */}
                <td className={`px-2 py-1.5 ${getTemperatureColor(temperature)} tabular-nums text-right`}>
                  {temperature}°C
                </td>

                {/* Latency Average */}
                <td className={`px-2 py-1.5 ${getLatencyTextColor(latency)} tabular-nums text-right`}>
                  {latencyAvg.avg < 1000 
                    ? `${latencyAvg.avg.toFixed(0)}ms` 
                    : `${(latencyAvg.avg/1000).toFixed(1)}s`
                  }
                </td>
                
                {/* Latency Max */}
                <td className={`px-2 py-1.5 ${getLatencyTextColor(latencyAvg.max)} tabular-nums text-right`}>
                  {latencyAvg.max < 1000 
                    ? `${latencyAvg.max.toFixed(0)}ms` 
                    : `${(latencyAvg.max/1000).toFixed(1)}s`
                  }
                </td>

                {/* Gravity comp gain (per joint, motors 1-7 only) */}
                {showGravityColumn && (
                  <td className="px-2 py-1.5 text-right">
                    {motor.id && motor.id <= 7 ? (
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.01}
                        value={getGravityGainDisplayValue(motor.id)}
                        onFocus={() => {
                          editingGravityMotorsRef.current.add(motor.id!);
                        }}
                        onChange={(e) => {
                          const nextValue = Number(e.target.value);
                          setEditedGravityGains(prev => new Map(prev).set(motor.id!, nextValue));
                        }}
                        onBlur={(e) => {
                          editingGravityMotorsRef.current.delete(motor.id!);
                          onGravityCompJointGainChange?.(motor.id!, Number(e.target.value));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        className="h-6 w-14 rounded border border-border-subtle bg-surface-primary px-1 text-xs text-text-primary text-right disabled:cursor-not-allowed disabled:opacity-60"
                        title="Gravity comp gain (rad/Nm) for this joint"
                        aria-label={`Gravity compensation gain for motor ${motor.id}`}
                      />
                    ) : (
                      <span className="text-text-muted">-</span>
                    )}
                  </td>
                )}

                {/* Status and Error */}
                <td className={`px-2 py-1.5 font-bold ${getMotorStatusTextColor(latency, hasError)}`} colSpan={2}>
                  {motor.error ? (
                    <span className="text-accent-critical truncate" title={motor.error.description || 'Unknown error'}>
                      {motor.error.kind}: {motor.error.description || 'Unknown error'}
                    </span>
                  ) : (
                    getStatusText(latency, hasError)
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      {isWebControlled && (
        <div className="px-2 py-1 bg-accent-success/10 text-accent-success text-xs border-t border-border-default/50">
          <div className="flex items-center justify-between">
            <span>🎮 Web Control Active</span>
            <span className="text-text-muted">
              {forceFullServoRange
                ? 'Single motor: raw 0-4095 range'
                : 'Drag to move • Hold +/- for continuous'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default MotorDataTable;
