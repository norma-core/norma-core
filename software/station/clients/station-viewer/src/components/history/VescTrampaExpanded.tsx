import { vesc_trampa } from '@/api/proto.js';
import { parseVescTrampaValuesPayload } from '@/devices/vesc-trampa/values-parser';
import { formatVescTrampaUuid } from '@/devices/vesc-trampa/utils';

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded bg-surface-primary p-2">
    <dt className="text-[10px] uppercase text-text-label">{label}</dt>
    <dd className="mt-1 break-words font-mono text-xs text-accent-data">{value}</dd>
  </div>;
}

function measured(value: number | undefined, digits = 1, unit = '') {
  return value === undefined ? '—' : `${value.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
}
function integer(value: number | undefined) { return value === undefined ? '—' : value.toLocaleString(); }
function flag(value: boolean | undefined) { return value === undefined ? '—' : value ? 'Active' : 'Inactive'; }

function Values({ payload }: { payload?: Uint8Array | null }) {
  const { values: v, error } = parseVescTrampaValuesPayload(payload);
  if (error) return <div role="alert" className="text-sm text-accent-critical">{error}</div>;
  if (!v) return <div className="text-sm text-text-muted">No recorded telemetry for this board.</div>;
  return <dl className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
    <Metric label="RPM" value={integer(v.rpm)} />
    <Metric label="FET temperature" value={measured(v.tempFetC, 1, '°C')} />
    <Metric label="Motor temperature" value={measured(v.tempMotorC, 1, '°C')} />
    <Metric label="MOSFET temperatures" value={v.mosfetTempsC ? `${v.mosfetTempsC.map(t => t.toFixed(1)).join(' / ')} °C` : '—'} />
    <Metric label="Motor current" value={measured(v.avgMotorCurrentA, 2, 'A')} />
    <Metric label="Input current" value={measured(v.avgInputCurrentA, 2, 'A')} />
    <Metric label="Voltage" value={measured(v.inputVoltageV, 1, 'V')} />
    <Metric label="Duty cycle" value={measured(v.dutyCycle === undefined ? undefined : v.dutyCycle * 100, 1, '%')} />
    <Metric label="Id" value={measured(v.avgId, 2, 'A')} />
    <Metric label="Iq" value={measured(v.avgIq, 2, 'A')} />
    <Metric label="Vd" value={measured(v.vd, 3, 'V')} />
    <Metric label="Vq" value={measured(v.vq, 3, 'V')} />
    <Metric label="Ah consumed" value={measured(v.ampHours, 4, 'Ah')} />
    <Metric label="Ah charged" value={measured(v.ampHoursCharged, 4, 'Ah')} />
    <Metric label="Wh consumed" value={measured(v.wattHours, 4, 'Wh')} />
    <Metric label="Wh charged" value={measured(v.wattHoursCharged, 4, 'Wh')} />
    <Metric label="Tachometer" value={integer(v.tachometer)} />
    <Metric label="Absolute tachometer" value={integer(v.tachometerAbs)} />
    <Metric label="PID position" value={measured(v.pidPosition, 6, '°')} />
    <Metric label="Controller ID" value={integer(v.controllerId)} />
    <Metric label="Fault code" value={integer(v.faultCode)} />
    <Metric label="Status" value={v.status === undefined ? '—' : `0x${v.status.toString(16).padStart(2, '0')}`} />
    <Metric label="Timeout" value={flag(v.timeoutActive)} />
    <Metric label="Kill switch" value={flag(v.killSwitchActive)} />
    <Metric label="Values command" value={String(v.commandId)} />
    <Metric label="Values mask" value={`0x${v.mask.toString(16).padStart(8, '0')}`} />
    <Metric label="Payload size" value={`${v.rawPayloadLen} bytes`} />
    <Metric label="Extra bytes" value={v.extraBytes.length ? Array.from(v.extraBytes, b => b.toString(16).padStart(2, '0')).join(' ') : 'None'} />
  </dl>;
}

function Board({ board }: { board?: vesc_trampa.IVescTrampaBoard | null }) {
  return <div className="flex flex-wrap gap-x-4 gap-y-1 break-all text-xs text-text-muted">
    <span>UUID {formatVescTrampaUuid(board?.uuid)}</span>
    <span>Port {board?.portName || '—'}</span>
    <span>Hardware {board?.hardwareName || '—'}</span>
    <span>Firmware {board ? `${board.firmwareMajor ?? 0}.${board.firmwareMinor ?? 0}` : '—'}</span>
    <span>Serial {board?.serialNumber || '—'}</span>
  </div>;
}

export default function VescTrampaExpanded({ data }: { data: vesc_trampa.InferenceState | vesc_trampa.RxEnvelope }) {
  if (data instanceof vesc_trampa.InferenceState) {
    if (!data.boards.length) return <div className="text-sm text-text-muted">No recorded VESC boards.</div>;
    return <div className="space-y-4">{data.boards.map((state, index) => <section key={formatVescTrampaUuid(state.board?.uuid)} className="space-y-2" aria-label={`Recorded VESC board ${index + 1}`}>
      <Board board={state.board} />
      <div className="flex flex-wrap gap-3 text-xs text-text-muted">
        <span>Mode: {state.motorMode === vesc_trampa.VescTrampaMotorMode.VESC_TRAMPA_MOTOR_MODE_HOLD ? 'Hold' : 'Active'}</span>
        <span>Values timestamp: {state.valuesLocalStampNs?.toString() ?? '—'} ns</span>
        <span>App: {state.valuesAppStartId?.toString() ?? '—'}</span>
      </div>
      <Values payload={state.valuesPayload} />
    </section>)}</div>;
  }
  const packet = data.boardPacket;
  const commandId = packet?.payload?.[0] ?? packet?.commandId;
  return <div className="space-y-2">
    <Board board={data.board} />
    <div className="text-xs text-text-muted">{vesc_trampa.VescTrampaSignalType[data.signalType] ?? data.signalType}</div>
    {data.error && <div role="alert" className="text-sm text-accent-critical">{data.error}</div>}
    {packet && <div className="text-xs text-text-muted">Packet {commandId} · {packet.payload?.length ?? 0} bytes · CRC {packet.crc ?? '—'}</div>}
    {commandId === 4 || commandId === 50 ? <Values payload={packet?.payload} />
      : <div className="text-sm text-text-muted">This event has no motor telemetry. Full event data is available in JSON and Hex.</div>}
  </div>;
}
