import { useEffect, useMemo, useRef, useState } from 'react';
import Long from 'long';
import { Octagon } from 'lucide-react';
import { serverToLocal } from '@/api/timestamp-utils';
import { vesc_trampa } from '@/api/proto.js';
import { getLatencyTextColor, getTemperatureColor } from '@/utils/color-utils';
import {
  VESC_TRAMPA_CURRENT_MAX_A,
  VESC_TRAMPA_CURRENT_MIN_A,
  VESC_TRAMPA_CURRENT_STEP_A,
  clampVescTrampaCurrent,
  holdVescTrampaMotor,
  setVescTrampaCurrent,
} from '../commands';
import {
  VescTrampaValues,
  formatVescInteger,
  formatVescNumber,
  parseVescTrampaValuesPayload,
} from '../values-parser';
import { formatVescTrampaUuid, longToNumber, shortVescTrampaUuid } from '../utils';

const CURRENT_HOLD_SEND_INTERVAL_MS = 50;

interface MetricCellProps {
  label: string;
  value: string;
  className?: string;
  title?: string;
}

function MetricCell({ label, value, className = 'text-text-primary', title }: MetricCellProps) {
  return (
    <div className="min-w-0 rounded border border-border-subtle bg-surface-secondary/60 px-3 py-2" title={title}>
      <div className="text-[10px] font-bold uppercase text-text-muted">{label}</div>
      <div className={`mt-1 truncate text-sm font-bold tabular-nums ${className}`}>{value}</div>
    </div>
  );
}

function currentColor(currentA: number | undefined): string {
  if (currentA === undefined) return 'text-text-muted';
  const absolute = Math.abs(currentA);
  if (absolute < 2) return 'text-accent-success';
  if (absolute < 5) return 'text-accent-warning';
  if (absolute < 8) return 'text-accent-danger';
  return 'text-accent-critical';
}

function formatDuty(values: VescTrampaValues | null): string {
  if (values?.dutyCycle === undefined) {
    return '--';
  }
  return `${(values.dutyCycle * 100).toFixed(1)}%`;
}

function formatLatency(stampNs: Long | number | null | undefined): { label: string; valueMs: number | null } {
  if (!stampNs) {
    return { label: '--', valueMs: null };
  }

  const localStamp = serverToLocal(Long.fromValue(stampNs));
  const valueMs = Date.now() - localStamp.toNumber() / 1e6;
  const label = valueMs < 1000 ? `${valueMs.toFixed(0)}ms` : `${(valueMs / 1000).toFixed(1)}s`;
  return { label, valueMs };
}

function formatMode(mode: vesc_trampa.VescTrampaMotorMode | null | undefined): string {
  return mode === vesc_trampa.VescTrampaMotorMode.VESC_TRAMPA_MOTOR_MODE_HOLD ? 'HOLD' : 'ACTIVE';
}

interface VescTrampaCardProps {
  boardState: vesc_trampa.InferenceState.IBoardState;
  boardIndex: number;
}

const VescTrampaCard = ({ boardState, boardIndex }: VescTrampaCardProps) => {
  const board = boardState.board;
  const boardUuid = board?.uuid ?? new Uint8Array();
  const valuesResult = useMemo(
    () => parseVescTrampaValuesPayload(boardState.valuesPayload),
    [boardState.valuesPayload],
  );
  const values = valuesResult.values;
  const [targetCurrentA, setTargetCurrentA] = useState(0);
  const [isCurrentControlActive, setIsCurrentControlActive] = useState(false);
  const [isHolding, setIsHolding] = useState(false);
  const currentControlActiveRef = useRef(false);
  const currentSendIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const targetCurrentRef = useRef(0);
  const mode = boardState.motorMode ?? vesc_trampa.VescTrampaMotorMode.VESC_TRAMPA_MOTOR_MODE_UNSPECIFIED;
  const isHoldMode = mode === vesc_trampa.VescTrampaMotorMode.VESC_TRAMPA_MOTOR_MODE_HOLD;
  const valuesLatency = formatLatency(boardState.valuesMonotonicStampNs);
  const stateLatency = formatLatency(boardState.monotonicStampNs);
  const firmware = board ? `${board.firmwareMajor ?? 0}.${board.firmwareMinor ?? 0}` : '--';
  const canSendCommand = boardUuid.length > 0;

  const setTargetCurrent = (value: number) => {
    const clampedValue = Number(clampVescTrampaCurrent(value).toFixed(1));
    targetCurrentRef.current = clampedValue;
    setTargetCurrentA(clampedValue);
    return clampedValue;
  };

  const sendCurrent = async (currentA: number) => {
    if (!canSendCommand) return;
    try {
      await setVescTrampaCurrent(boardUuid, currentA);
    } catch (error) {
      console.error('Failed to set VESC Trampa current:', error);
    }
  };

  const stopCurrentSendLoop = () => {
    if (currentSendIntervalRef.current) {
      clearInterval(currentSendIntervalRef.current);
      currentSendIntervalRef.current = null;
    }
  };

  const startCurrentSendLoop = () => {
    stopCurrentSendLoop();
    currentSendIntervalRef.current = setInterval(() => {
      void sendCurrent(targetCurrentRef.current);
    }, CURRENT_HOLD_SEND_INTERVAL_MS);
  };

  useEffect(() => {
    return () => stopCurrentSendLoop();
  }, []);

  const beginCurrentControl = (event: React.PointerEvent<HTMLInputElement>) => {
    if (!canSendCommand) return;
    currentControlActiveRef.current = true;
    setIsCurrentControlActive(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    void sendCurrent(targetCurrentRef.current);
    startCurrentSendLoop();
  };

  const handleCurrentChange = (value: number) => {
    const nextCurrentA = setTargetCurrent(value);
    if (currentControlActiveRef.current) {
      void sendCurrent(nextCurrentA);
    }
  };

  const releaseCurrentControl = () => {
    if (!currentControlActiveRef.current && targetCurrentRef.current === 0) {
      return;
    }

    currentControlActiveRef.current = false;
    stopCurrentSendLoop();
    setIsCurrentControlActive(false);
    setTargetCurrent(0);
    void sendCurrent(0);
  };

  const holdMotor = async () => {
    if (!canSendCommand) return;
    setIsHolding(true);
    try {
      releaseCurrentControl();
      await holdVescTrampaMotor(boardUuid);
    } finally {
      setIsHolding(false);
    }
  };

  return (
    <div className="min-w-0 rounded-lg border border-border-default bg-surface-primary/50">
      <div className="rounded-t-lg border-b border-border-default bg-surface-secondary/50 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-bold text-accent-data">VESC #{boardIndex + 1}</span>
          <span
            className={`rounded border px-2 py-1 text-xs font-bold ${
              isHoldMode
                ? 'border-accent-warning bg-accent-warning/10 text-accent-warning'
                : 'border-accent-success bg-accent-success/10 text-accent-success'
            }`}
          >
            {formatMode(mode)}
          </span>
          <span className="min-w-0 truncate text-sm text-text-muted" title={formatVescTrampaUuid(boardUuid)}>
            UUID {shortVescTrampaUuid(boardUuid)}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
          <span>Port <span className="text-accent-data">{board?.portName || '--'}</span></span>
          <span>Serial <span className="text-accent-data">{board?.serialNumber || '--'}</span></span>
          <span>HW <span className="text-accent-data">{board?.hardwareName || '--'}</span></span>
          <span>FW <span className="text-accent-data">{firmware}</span></span>
          <span className={valuesLatency.valueMs === null ? 'text-text-muted' : getLatencyTextColor(valuesLatency.valueMs)}>
            Values {valuesLatency.label}
          </span>
          <span className={stateLatency.valueMs === null ? 'text-text-muted' : getLatencyTextColor(stateLatency.valueMs)}>
            State {stateLatency.label}
          </span>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {valuesResult.error && (
          <div className="rounded border border-accent-critical bg-accent-critical/10 px-3 py-2 text-sm text-accent-critical">
            {valuesResult.error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <MetricCell label="RPM" value={formatVescInteger(values?.rpm)} className="text-accent-data" />
          <MetricCell
            label="Motor Current"
            value={formatVescNumber(values?.avgMotorCurrentA, 2, 'A')}
            className={currentColor(values?.avgMotorCurrentA)}
          />
          <MetricCell
            label="Input Current"
            value={formatVescNumber(values?.avgInputCurrentA, 2, 'A')}
            className={currentColor(values?.avgInputCurrentA)}
          />
          <MetricCell label="Duty" value={formatDuty(values)} className="text-accent-info" />
          <MetricCell
            label="FET Temp"
            value={formatVescNumber(values?.tempFetC, 1, 'C')}
            className={getTemperatureColor(values?.tempFetC ?? 0)}
          />
          <MetricCell
            label="Motor Temp"
            value={formatVescNumber(values?.tempMotorC, 1, 'C')}
            className={getTemperatureColor(values?.tempMotorC ?? 0)}
          />
          <MetricCell label="Voltage" value={formatVescNumber(values?.inputVoltageV, 1, 'V')} className="text-accent-success" />
          <MetricCell
            label="Fault"
            value={values?.faultCode === undefined ? '--' : String(values.faultCode)}
            className={values?.faultCode ? 'text-accent-critical' : 'text-accent-success'}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
          <MetricCell label="Tachometer" value={formatVescInteger(values?.tachometer)} />
          <MetricCell label="Tach Abs" value={formatVescInteger(values?.tachometerAbs)} />
          <MetricCell label="Ah" value={formatVescNumber(values?.ampHours, 4)} />
          <MetricCell label="Wh" value={formatVescNumber(values?.wattHours, 4)} />
          <MetricCell label="ID / IQ" value={`${formatVescNumber(values?.avgId, 2)} / ${formatVescNumber(values?.avgIq, 2)}`} />
          <MetricCell label="Vd / Vq" value={`${formatVescNumber(values?.vd, 3)} / ${formatVescNumber(values?.vq, 3)}`} />
          <MetricCell
            label="Status"
            value={values?.status === undefined ? '--' : `0x${values.status.toString(16).padStart(2, '0')}`}
            className={(values?.timeoutActive || values?.killSwitchActive) ? 'text-accent-critical' : 'text-text-primary'}
            title={`timeout=${values?.timeoutActive ?? false}, kill_switch=${values?.killSwitchActive ?? false}`}
          />
          <MetricCell
            label="MOSFETs"
            value={values?.mosfetTempsC?.map((temp) => temp.toFixed(1)).join(' / ') ?? '--'}
            className="text-accent-warning"
          />
        </div>

        <div className="rounded border border-border-default bg-surface-secondary/50 p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-xs font-bold uppercase text-text-muted">Momentary Current</span>
                <span className={`text-sm font-bold tabular-nums ${isCurrentControlActive ? 'text-accent-warning' : 'text-accent-data'}`}>
                  {targetCurrentA.toFixed(1)}A
                </span>
              </div>
              <input
                type="range"
                min={VESC_TRAMPA_CURRENT_MIN_A}
                max={VESC_TRAMPA_CURRENT_MAX_A}
                step={VESC_TRAMPA_CURRENT_STEP_A}
                value={targetCurrentA}
                onPointerDown={beginCurrentControl}
                onPointerUp={releaseCurrentControl}
                onPointerCancel={releaseCurrentControl}
                onLostPointerCapture={releaseCurrentControl}
                onChange={(event) => handleCurrentChange(Number(event.target.value))}
                className="w-full"
                disabled={!canSendCommand}
              />
              <div className="mt-1 flex justify-between text-[10px] font-bold text-text-muted">
                <span>{VESC_TRAMPA_CURRENT_MIN_A}A</span>
                <span>{isCurrentControlActive ? 'LIVE' : 'release returns to 0A'}</span>
                <span>{VESC_TRAMPA_CURRENT_MAX_A}A</span>
              </div>
            </div>
            <button
              type="button"
              onClick={holdMotor}
              disabled={!canSendCommand || isHolding || isHoldMode}
              className="inline-flex h-10 items-center justify-center gap-2 rounded border border-accent-critical bg-accent-critical/15 px-4 text-sm font-bold text-accent-critical transition-colors hover:bg-accent-critical hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Octagon className="h-4 w-4" aria-hidden="true" />
              {isHolding ? 'Holding' : 'Hold'}
            </button>
          </div>
        </div>

        <div className="text-xs text-text-muted">
          Payload {values?.rawPayloadLen ?? 0} bytes, extra {values?.extraBytes.length ?? 0} bytes,
          app {longToNumber(boardState.valuesAppStartId)?.toLocaleString() ?? '--'}
        </div>
      </div>
    </div>
  );
};

export default VescTrampaCard;
