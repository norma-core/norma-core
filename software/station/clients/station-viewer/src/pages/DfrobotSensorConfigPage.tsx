import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import webSocketManager from '../api/websocket';
import { useInferenceState, useWakeLock } from '../hooks';
import { dfrobot_rs485 } from '../api/proto';
import {
  commandIdMatches,
  dfrobotCommsProfile,
  dfrobotModelLabel,
  planDfrobotConfigWrites,
  readDfrobotWord,
  type DfrobotConfigWrite,
} from '../devices/dfrobot-rs485/values';

const SignalType = dfrobot_rs485.DfrobotSignalType;
const ONLINE_SIGNALS = new Set<number>([
  SignalType.DFROBOT_CONNECTED,
  SignalType.DFROBOT_REGISTERS_SNAPSHOT,
]);
const ACK_SIGNALS = new Set<number>([
  SignalType.DFROBOT_COMMAND_SUCCESS,
  SignalType.DFROBOT_COMMAND_REJECTED,
  SignalType.DFROBOT_COMMAND_FAILED,
]);

// Driver defaults (station.yaml can widen them; the form notes this).
const SCAN_ID_MIN = 1;
const SCAN_ID_MAX = 10;
const BAUD_CHOICES = [4800, 9600];

// 3 silent polls at 1 s + full port/baud/ID re-scan, with margin.
const REAPPEAR_TIMEOUT_MS = 25000;

enum ConfigProgress {
  IDLE = 'idle',
  WRITING = 'writing',
  WAITING_REAPPEAR = 'waiting_reappear',
  WAITING_POWER_CYCLE = 'waiting_power_cycle',
  COMPLETED = 'completed',
  ERROR = 'error',
}

const DfrobotSensorConfigPage: React.FC = () => {
  useWakeLock();
  const frame = useInferenceState();

  const [progress, setProgress] = useState<ConfigProgress>(ConfigProgress.IDLE);
  const [commandLog, setCommandLog] = useState<string[]>([]);
  const [newId, setNewId] = useState<number>(1);
  const [newBaud, setNewBaud] = useState<number>(9600);
  const [target, setTarget] = useState<{ id: number; baud: number; powerCycle: boolean } | null>(
    null,
  );
  // Command ids sent in the current run. Acks are best-effort: they share the
  // sensor's rx queue with 1 Hz register snapshots, and only the latest queue
  // entry survives, so a snapshot landing right after an ack can evict it
  // before this page ever polls it. A missing ack is therefore not an error —
  // completion is judged solely by the sensor reappearing at the new settings
  // (or, for the light sensor, by the power-cycle wait).
  const pendingCommandIdsRef = useRef<{ id: number; label: string }[]>([]);
  const loggedAckIdsRef = useRef<Set<number>>(new Set());
  // Bumped on every new Apply/Cancel so a write's promise resolving after the
  // run it belongs to was abandoned cannot mutate state for a later run.
  const runRef = useRef(0);

  const entries = useMemo(() => frame?.dfrobotRs485 ?? [], [frame]);
  const onlineEntries = useMemo(
    () => entries.filter((entry) => ONLINE_SIGNALS.has(entry.data.signalType ?? 0)),
    [entries],
  );

  const inFlight =
    progress === ConfigProgress.WRITING ||
    progress === ConfigProgress.WAITING_REAPPEAR ||
    progress === ConfigProgress.WAITING_POWER_CYCLE;

  // The sensor under edit: the single online sensor.
  const current = useMemo(() => {
    if (onlineEntries.length !== 1) {
      return null;
    }
    const data = onlineEntries[0].data;
    return {
      model: data.device?.model ?? 0,
      modbusId: data.device?.modbusId ?? 0,
      baud: data.device?.baud ?? 0,
      portName: data.device?.portName ?? '',
      ranges: data.ranges,
    };
  }, [onlineEntries]);

  const profile = dfrobotCommsProfile(current?.model);

  // Initialize the form from the current sensor once it is known.
  useEffect(() => {
    if (current && progress === ConfigProgress.IDLE) {
      setNewId(current.modbusId);
      setNewBaud(current.baud);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.modbusId, current?.baud]);

  const appendLog = (line: string) => setCommandLog((prev) => [...prev, line]);

  // Sends every write in the plan back-to-back, fire-and-forget: the driver
  // applies them in order, and we do not wait for an ack before sending the
  // next one (acks are best-effort — see pendingCommandIdsRef above). Bails
  // out silently if the run was cancelled while a send was in flight.
  const sendAllWrites = async (
    run: number,
    plan: DfrobotConfigWrite[],
    targetId: number,
    targetBaud: number,
    powerCycle: boolean,
  ) => {
    for (const write of plan) {
      try {
        const commandId = await webSocketManager.commands.sendDfrobotRs485Command({
          writeRegister: {
            modbusId: write.modbusId,
            register: write.register,
            value: write.value,
          },
        });
        if (runRef.current !== run) {
          return;
        }
        pendingCommandIdsRef.current.push({ id: commandId, label: write.label });
        appendLog(
          `Sent ${write.label} (register 0x${write.register
            .toString(16)
            .toUpperCase()
            .padStart(4, '0')} on id ${write.modbusId})`,
        );
      } catch (error) {
        if (runRef.current !== run) {
          return;
        }
        appendLog(`✗ Failed to send command: ${error instanceof Error ? error.message : error}`);
        setProgress(ConfigProgress.ERROR);
        return;
      }
    }
    if (runRef.current !== run) {
      return;
    }
    if (powerCycle) {
      setProgress(ConfigProgress.WAITING_POWER_CYCLE);
      appendLog(
        'All writes sent. Now power-cycle the light sensor: cut power to the sensor itself (not the USB adapter), wait ~1 s, reconnect it.',
      );
    } else {
      setProgress(ConfigProgress.WAITING_REAPPEAR);
      appendLog(`Waiting for the sensor to reappear at ID ${targetId} @ ${targetBaud} baud...`);
    }
  };

  // Watch for acks of the writes sent in this run. This is best-effort only:
  // acks share the sensor's rx queue with 1 Hz register snapshots, and only
  // the latest queue entry survives, so a snapshot landing right after an ack
  // can evict it before this page polls again. A missing ack is therefore
  // never treated as an error — only an explicit REJECTED/FAILED ack is.
  useEffect(() => {
    if (
      progress !== ConfigProgress.WRITING &&
      progress !== ConfigProgress.WAITING_REAPPEAR &&
      progress !== ConfigProgress.WAITING_POWER_CYCLE
    ) {
      return;
    }
    for (const entry of entries) {
      const signalType = entry.data.signalType ?? 0;
      if (!ACK_SIGNALS.has(signalType)) {
        continue;
      }
      const matchIndex = pendingCommandIdsRef.current.findIndex((pending) =>
        commandIdMatches(entry.data.command?.commandId as Uint8Array, pending.id),
      );
      if (matchIndex === -1) {
        continue;
      }
      const { id: commandId } = pendingCommandIdsRef.current[matchIndex];
      if (loggedAckIdsRef.current.has(commandId)) {
        continue;
      }
      loggedAckIdsRef.current.add(commandId);
      const description = entry.data.command?.description || entry.data.error || 'no details';
      if (signalType !== SignalType.DFROBOT_COMMAND_SUCCESS) {
        appendLog(`✗ Write failed: ${description}`);
        if (matchIndex > 0) {
          const earlierLabels = pendingCommandIdsRef.current
            .slice(0, matchIndex)
            .map((pending) => pending.label)
            .join(', ');
          appendLog(
            `⚠ Earlier write(s) already applied: ${earlierLabels}. The sensor may now be in a mixed state.`,
          );
        } else if (pendingCommandIdsRef.current.length > 1) {
          appendLog(
            '⚠ Other writes in this run were also sent — the sensor may be in a mixed state. Re-open this page to see its current settings.',
          );
        }
        // Abandon this run so the in-flight send loop's runRef guards catch
        // this abort at its next checkpoint and cannot clobber ERROR back to
        // a WAITING_* state once the still-pending writes finish sending.
        runRef.current += 1;
        pendingCommandIdsRef.current = [];
        setProgress(ConfigProgress.ERROR);
        return;
      }
      appendLog(`✓ ${description}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, progress]);

  // Watch for the sensor coming back at the new settings.
  useEffect(() => {
    if (
      (progress !== ConfigProgress.WAITING_REAPPEAR &&
        progress !== ConfigProgress.WAITING_POWER_CYCLE) ||
      !target
    ) {
      return;
    }
    const reborn = entries.find(
      (entry) =>
        ONLINE_SIGNALS.has(entry.data.signalType ?? 0) &&
        entry.data.device?.modbusId === target.id &&
        entry.data.device?.baud === target.baud,
    );
    if (reborn) {
      appendLog(`✓ Sensor verified online at ID ${target.id} @ ${target.baud} baud`);
      setProgress(ConfigProgress.COMPLETED);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, progress, target]);

  // Reappearance timeout — radiation family only; the power-cycle wait is
  // indefinite because it depends on the user unplugging the sensor.
  useEffect(() => {
    if (progress !== ConfigProgress.WAITING_REAPPEAR || !target) {
      return;
    }
    const timer = setTimeout(() => {
      appendLog(
        `✗ Timeout: the sensor did not reappear at ID ${target.id} @ ${target.baud} baud within 25 s. ` +
          'The write may still have taken effect. Check wiring and power, and that the target ID/baud ' +
          'are inside scan-ids / bauds in station.yaml. One of the writes may also have been rejected ' +
          'without the page seeing the ack.',
      );
      setProgress(ConfigProgress.ERROR);
    }, REAPPEAR_TIMEOUT_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, target]);

  const handleApply = () => {
    if (!current || !profile || inFlight) {
      return;
    }
    const changedId = newId !== current.modbusId ? newId : null;
    const changedBaud = newBaud !== current.baud ? newBaud : null;
    if (changedId === null && changedBaud === null) {
      return;
    }
    const plan = planDfrobotConfigWrites(current.model, current.modbusId, changedId, changedBaud);
    if (!plan || plan.length === 0) {
      setCommandLog(['✗ Cannot plan writes for this sensor model']);
      setProgress(ConfigProgress.ERROR);
      return;
    }
    const targetId = changedId ?? current.modbusId;
    const targetBaud = changedBaud ?? current.baud;
    const powerCycle = profile.latchesOnPowerCycle;

    runRef.current += 1;
    const run = runRef.current;
    pendingCommandIdsRef.current = [];
    loggedAckIdsRef.current = new Set();

    setTarget({ id: targetId, baud: targetBaud, powerCycle });
    setCommandLog([
      `Starting config change on ${dfrobotModelLabel(current.model)} ` +
        `(ID ${current.modbusId} @ ${current.baud} baud)`,
    ]);
    setProgress(ConfigProgress.WRITING);
    void sendAllWrites(run, plan, targetId, targetBaud, powerCycle);
  };

  const handleCancel = () => {
    runRef.current += 1;
    pendingCommandIdsRef.current = [];
    appendLog('Cancelled by user. The sensor may already carry the new settings.');
    setProgress(ConfigProgress.IDLE);
  };

  const idValid = newId >= SCAN_ID_MIN && newId <= SCAN_ID_MAX;
  const hasChange = current !== null && (newId !== current.modbusId || newBaud !== current.baud);

  // A custom station.yaml baud outside BAUD_CHOICES must still show up as a
  // selectable (already-selected) option, or the controlled <select> renders
  // blank.
  const baudOptions =
    current && !BAUD_CHOICES.includes(current.baud) ? [current.baud, ...BAUD_CHOICES] : BAUD_CHOICES;

  const addressReadback =
    current && profile ? readDfrobotWord(current.ranges, profile.addressRegister) : null;
  const baudCodeReadback =
    current && profile ? readDfrobotWord(current.ranges, profile.baudRegister) : null;

  return (
    <div className="min-h-screen bg-surface-base text-accent-success font-mono p-6">
      <div className="container mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Link
            to="/"
            className="px-4 py-2 bg-surface-elevated text-text-primary rounded hover:bg-surface-active transition-colors"
          >
            ← Back to Home
          </Link>
          <h1 className="text-3xl font-bold text-accent-data">DFRobot Sensor Configuration</h1>
        </div>

        {/* Priority 1: multiple sensors online (suppressed while a change is in flight) */}
        {onlineEntries.length > 1 && !inFlight ? (
          <div className="bg-accent-danger/10 border border-accent-danger-deep rounded-lg p-6">
            <div className="text-2xl font-bold text-accent-danger mb-4">
              Multiple DFRobot sensors are connected to the bus
            </div>
            <div className="text-accent-danger text-sm mb-3">
              To safely change ID or baud rate, connect only one sensor at a time.
            </div>
            <div className="bg-surface-base rounded p-3 font-mono text-sm mb-3">
              <div className="text-accent-data mb-1">Detected sensors:</div>
              <div className="text-accent-success">
                {onlineEntries
                  .map(
                    (entry) =>
                      `${dfrobotModelLabel(entry.data.device?.model)} (id ${entry.data.device?.modbusId})`,
                  )
                  .join(', ')}
              </div>
            </div>
            <div className="text-accent-warning text-sm">
              <strong>Action:</strong> Disconnect all sensors except the one you want to configure,
              then return to this page.
            </div>
          </div>
        ) : /* Priority 2: no sensor online and nothing in flight */
        !current && !inFlight && progress !== ConfigProgress.COMPLETED && progress !== ConfigProgress.ERROR ? (
          <div className="bg-surface-primary rounded-lg p-6">
            <div className="text-text-label">
              No DFRobot sensor online. Connect exactly one sensor and wait a few seconds.
            </div>
          </div>
        ) : (
          /* Priority 3: the editor */
          <div className="space-y-6">
            {current && (
              <div className="bg-surface-primary rounded-lg p-6">
                <h2 className="text-xl font-bold text-accent-warning mb-4">Current Sensor</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-text-muted">Model:</span>
                    <span className="text-accent-success ml-2 font-bold">
                      {dfrobotModelLabel(current.model)}
                    </span>
                  </div>
                  <div>
                    <span className="text-text-muted">Modbus ID:</span>
                    <span className="text-accent-success ml-2 font-bold">{current.modbusId}</span>
                  </div>
                  <div>
                    <span className="text-text-muted">Baud:</span>
                    <span className="text-accent-success ml-2 font-bold">{current.baud}</span>
                  </div>
                  <div>
                    <span className="text-text-muted">Port:</span>
                    <span className="text-accent-data ml-2">{current.portName}</span>
                  </div>
                  <div>
                    <span className="text-text-muted">Address register:</span>
                    <span className="text-accent-data ml-2">{addressReadback ?? 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-text-muted">Baud code register:</span>
                    <span className="text-accent-data ml-2">{baudCodeReadback ?? 'N/A'}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-surface-primary rounded-lg p-6">
              <h2 className="text-xl font-bold text-accent-warning mb-4">Change ID / Baud Rate</h2>
              <div className="flex flex-wrap items-center gap-6 mb-3">
                <div className="flex items-center gap-2">
                  <label htmlFor="sensorId" className="text-text-label text-sm">
                    New Modbus ID:
                  </label>
                  <input
                    id="sensorId"
                    type="number"
                    min={SCAN_ID_MIN}
                    max={SCAN_ID_MAX}
                    value={newId}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    onChange={(e) =>
                      setNewId(
                        Math.max(
                          SCAN_ID_MIN,
                          Math.min(SCAN_ID_MAX, parseInt(e.target.value) || SCAN_ID_MIN),
                        ),
                      )
                    }
                    disabled={inFlight}
                    className="w-20 px-3 py-2 bg-surface-secondary text-accent-success border border-border-subtle rounded focus:border-accent-data focus:outline-none disabled:opacity-50"
                  />
                  <span className="text-text-muted text-sm">
                    ({SCAN_ID_MIN}-{SCAN_ID_MAX})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor="sensorBaud" className="text-text-label text-sm">
                    Baud rate:
                  </label>
                  <select
                    id="sensorBaud"
                    value={newBaud}
                    onChange={(e) => setNewBaud(parseInt(e.target.value))}
                    disabled={inFlight}
                    className="px-3 py-2 bg-surface-secondary text-accent-success border border-border-subtle rounded focus:border-accent-data focus:outline-none disabled:opacity-50"
                  >
                    {baudOptions.map((baud) => (
                      <option key={baud} value={baud}>
                        {baud}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={handleApply}
                  disabled={inFlight || !hasChange || !idValid || !profile}
                  className={`px-6 py-2 rounded-lg transition-colors font-bold ${
                    inFlight || !hasChange || !idValid || !profile
                      ? 'bg-surface-elevated text-text-label cursor-not-allowed'
                      : 'bg-accent-info-bg text-text-primary hover:bg-accent-info-deep'
                  }`}
                >
                  {inFlight ? 'Applying...' : 'Apply'}
                </button>
                {inFlight && (
                  <button
                    onClick={handleCancel}
                    className="px-6 py-2 rounded-lg font-bold bg-surface-elevated text-text-primary hover:bg-surface-active transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
              <div className="text-text-muted text-xs">
                The driver only rediscovers sensors at IDs {SCAN_ID_MIN}-{SCAN_ID_MAX} and bauds{' '}
                {BAUD_CHOICES.join(' / ')}. Wider values are possible by editing scan-ids / bauds in
                station.yaml first. If this sensor is pinned in station.yaml's sensors: list, update
                its modbus-id there after changing the ID here.
              </div>
            </div>

            {progress === ConfigProgress.WAITING_POWER_CYCLE && (
              <div className="bg-accent-warning/10 border border-accent-warning rounded-lg p-6">
                <div className="text-2xl font-bold text-accent-warning mb-2">
                  ⚡ Power-cycle the light sensor now
                </div>
                <div className="text-text-secondary text-sm">
                  The SEN0644 applies baud changes only after a power-cycle: cut power to the
                  sensor itself (disconnect its supply wires or switch off its power source), wait
                  about a second, and reconnect it. Replugging the USB adapter does NOT power-cycle
                  the sensor — it usually has its own power supply. This page will confirm
                  automatically when the sensor comes back at ID {target?.id} @ {target?.baud}{' '}
                  baud.
                </div>
              </div>
            )}

            {progress === ConfigProgress.COMPLETED && target && (
              <div className="bg-accent-success/10 border border-accent-success rounded-lg p-6">
                <div className="text-2xl font-bold text-accent-success">
                  ✓ Sensor configured: ID {target.id} @ {target.baud} baud
                </div>
              </div>
            )}

            {commandLog.length > 0 && (
              <div className="bg-surface-base rounded-lg p-4 font-mono text-sm max-h-64 overflow-y-auto">
                <div className="text-accent-data font-bold mb-2">Command Log:</div>
                {commandLog.map((line, index) => (
                  <div
                    key={index}
                    className={`${
                      line.startsWith('✓')
                        ? 'text-accent-success'
                        : line.startsWith('✗')
                          ? 'text-accent-critical'
                          : line.startsWith('⚠') || line.includes('power-cycle') || line.includes('Waiting')
                            ? 'text-accent-warning'
                            : 'text-text-label'
                    }`}
                  >
                    {line}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DfrobotSensorConfigPage;
