import React, { useState, useMemo, useEffect } from 'react';
import webSocketManager from '../api/websocket';
import { useInferenceState, useWakeLock, useBusMonitor } from '../hooks';
import { st3215 } from '../api/proto';
import { useLocation, Link } from 'react-router-dom';
import { st3215InferenceCodec } from '@/devices/st3215/codec';

enum MotorIdSetProgress {
  IDLE = 'idle',
  UNLOCKING = 'unlocking',
  SENDING_ACTION_OLD = 'sending_action_old',
  WRITING_NEW_ID = 'writing_new_id',
  WAITING_FOR_NEW_ID = 'waiting_for_new_id',
  CONFIGURING_NEW_ID = 'configuring_new_id',
  COMPLETED = 'completed',
  ERROR = 'error',
}

const St3215MotorConfigPage: React.FC = () => {
  useWakeLock();
  const location = useLocation();
  const selectedBusFromState = location.state?.bus as st3215.InferenceState.IBusState | undefined;

  const inferenceState = useInferenceState();
  const latestSt3215 = inferenceState?.devices.entryOf(st3215InferenceCodec)?.data;
  const [isMotorIdSetInProgress, setIsMotorIdSetInProgress] = useState(false);
  const [newMotorId, setNewMotorId] = useState<number>(1);
  const [motorIdSetProgress, setMotorIdSetProgress] = useState<MotorIdSetProgress>(MotorIdSetProgress.IDLE);
  const [commandLog, setCommandLog] = useState<string[]>([]);
  const [motorIdSetStartTime, setMotorIdSetStartTime] = useState<number>(0);

  // Derive selected bus from inference state, falling back to router state
  const selectedBus = useMemo(() => {
    if (!selectedBusFromState?.bus?.serialNumber) return null;

    // Try to get updated bus from inference state
    const updatedBus = latestSt3215?.buses?.find(
      (bus: st3215.InferenceState.IBusState) => bus.bus?.serialNumber === selectedBusFromState.bus?.serialNumber
    );

    return updatedBus || selectedBusFromState;
  }, [latestSt3215?.buses, selectedBusFromState]);

  // Monitor bus state for collision detection (ignore errors during motor ID change)
  const busStatus = useBusMonitor(selectedBus, isMotorIdSetInProgress);

  // Monitor for new motor ID appearance during ID change sequence
  useEffect(() => {
    if (!isMotorIdSetInProgress || !selectedBus?.bus?.serialNumber || motorIdSetProgress !== MotorIdSetProgress.WAITING_FOR_NEW_ID) {
      return;
    }

    // Check if new motor ID has appeared
    const hasNewMotorId = selectedBus.motors?.some(motor => motor.id === newMotorId);

    if (hasNewMotorId) {
      // New motor ID detected, send remaining commands
      setMotorIdSetProgress(MotorIdSetProgress.CONFIGURING_NEW_ID);
      setCommandLog(prev => [...prev, `✓ New motor ID ${newMotorId} detected in state`]);

      const busSerial = selectedBus.bus.serialNumber;

      (async () => {
        try {
          setCommandLog(prev => [...prev, `Sending ACTION to motor ID ${newMotorId}...`]);
          await sendCommand(busSerial, {
            action: {
              motorId: newMotorId
            }
          });

          setCommandLog(prev => [...prev, `Locking motor ID ${newMotorId}...`]);
          await sendCommand(busSerial, {
            write: {
              motorId: newMotorId,
              address: 0x37, // Lock register
              value: new Uint8Array([1]) // Lock
            }
          });

          setCommandLog(prev => [...prev, `Sending final ACTION to motor ID ${newMotorId}...`]);
          await sendCommand(busSerial, {
            action: {
              motorId: newMotorId
            }
          });

          setMotorIdSetProgress(MotorIdSetProgress.COMPLETED);
          setIsMotorIdSetInProgress(false);
          setCommandLog(prev => [...prev, `✓ Motor ID successfully changed to ${newMotorId}`]);
          console.log(`Motor ID successfully changed to ${newMotorId}`);
        } catch (error) {
          console.error('Failed to configure new motor ID:', error);
          setMotorIdSetProgress(MotorIdSetProgress.ERROR);
          setIsMotorIdSetInProgress(false);
          setCommandLog(prev => [...prev, `✗ Error: ${error instanceof Error ? error.message : 'Unknown error'}`]);
        }
      })();
    }
  }, [selectedBus, isMotorIdSetInProgress, newMotorId, motorIdSetProgress]);

  // Timeout mechanism for waiting for new motor ID
  useEffect(() => {
    if (motorIdSetProgress !== MotorIdSetProgress.WAITING_FOR_NEW_ID) {
      return;
    }

    const timeout = setTimeout(() => {
      setMotorIdSetProgress(MotorIdSetProgress.ERROR);
      setIsMotorIdSetInProgress(false);
      setCommandLog(prev => [...prev, `✗ Timeout: New motor ID ${newMotorId} did not appear in state within 5 seconds`]);
      console.error(`Timeout: New motor ID ${newMotorId} did not appear in state`);
    }, 5000);

    return () => clearTimeout(timeout);
  }, [motorIdSetProgress, newMotorId]);


  const getMotorIdFromState = (data: Uint8Array): number => {
    // Motor ID is typically at address 0x05 in ST3215
    if (data.length > 0x05) {
      return data[0x05];
    }
    return 0;
  };

  // Send a command without waiting for response
  const sendCommand = async (busSerial: string, command: st3215.ICommand): Promise<void> => {
    await webSocketManager.commands.sendSt3215Command({
        targetBusSerial: busSerial,
        ...command
      });
  };


  const handleSetMotorId = async () => {
    if (!selectedBus?.bus?.serialNumber) {
      console.error('No bus selected for motor ID setting');
      return;
    }

    if (isMotorIdSetInProgress) {
      console.log('Motor ID setting already in progress');
      return;
    }

    if (newMotorId < 1 || newMotorId > 10) {
      console.error('Motor ID must be between 1 and 10');
      return;
    }

    const busSerial = selectedBus.bus.serialNumber;
    const currentMotorId = selectedBus.motors?.[0]?.id || 1;

    setIsMotorIdSetInProgress(true);
    setCommandLog([]);
    setMotorIdSetProgress(MotorIdSetProgress.UNLOCKING);
    setMotorIdSetStartTime(Date.now());

    try {
      console.log(`Starting motor ID setting from ${currentMotorId} to ${newMotorId} on bus ${busSerial}`);
      setCommandLog([`Starting motor ID change: ${currentMotorId} → ${newMotorId}`]);

      // Step 1-3: Send commands to old motor ID
      setCommandLog(prev => [...prev, `Unlocking motor ID ${currentMotorId}...`]);
      await sendCommand(busSerial, {
        write: {
          motorId: currentMotorId,
          address: 0x37, // Lock register
          value: new Uint8Array([0]) // Unlock
        }
      });

      setMotorIdSetProgress(MotorIdSetProgress.SENDING_ACTION_OLD);
      setCommandLog(prev => [...prev, `Sending ACTION to motor ID ${currentMotorId}...`]);
      await sendCommand(busSerial, {
        action: {
          motorId: currentMotorId
        }
      });

      setMotorIdSetProgress(MotorIdSetProgress.WRITING_NEW_ID);
      setCommandLog(prev => [...prev, `Writing new motor ID ${newMotorId} to address 0x05...`]);
      await sendCommand(busSerial, {
        write: {
          motorId: currentMotorId,
          address: 0x05, // Motor ID register
          value: new Uint8Array([newMotorId])
        }
      });

      // Step 4: Wait for new motor ID to appear in state
      setMotorIdSetProgress(MotorIdSetProgress.WAITING_FOR_NEW_ID);
      setCommandLog(prev => [...prev, `Waiting for motor ID ${newMotorId} to appear in state...`]);
      console.log(`Waiting for new motor ID ${newMotorId} to appear in state...`);

      // The useEffect will handle the rest when new motor ID appears

    } catch (error) {
      console.error('Motor ID setting failed:', error);
      setMotorIdSetProgress(MotorIdSetProgress.ERROR);
      setIsMotorIdSetInProgress(false);
      setCommandLog(prev => [...prev, `✗ Error: ${error instanceof Error ? error.message : 'Unknown error'}`]);
    }
  };

  if (selectedBus) {
    const motor = selectedBus.motors?.[0];
    const motorState = motor?.state;
    const motorId = motorState ? getMotorIdFromState(motorState) : 0;

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
            <h1 className="text-3xl font-bold text-accent-data">
              Bus: {selectedBus.bus?.serialNumber || 'Unknown'}
            </h1>
          </div>

          {/* Priority 1: Show error dump if error detected (but not during or after recent motor ID change) */}
          {busStatus.errorDump && !isMotorIdSetInProgress && (Date.now() - motorIdSetStartTime > 1000) ? (
            <div className="space-y-6">
              <div className="bg-accent-danger/10 border border-accent-danger-deep rounded-lg p-6">
                <div className="flex items-start gap-3">
                  <div className="text-accent-danger text-2xl">⚠️</div>
                  <div className="flex-1">
                    <div className="text-2xl font-bold text-accent-danger mb-4">
                      Do you have multiple ST3215 connected to the bus?
                    </div>

                    <h2 className="text-xl font-bold text-accent-danger mb-2">ST3215 Communication Error Detected</h2>

                    <div className="mb-4">
                      <div className="text-accent-danger font-bold mb-2">Unexpected Response from Motor ID {busStatus.errorDump.motorId}</div>
                      <div className="text-accent-danger text-sm leading-relaxed mb-3">
                        We sent a command and expected a valid response, but received an error response instead.
                        This might indicate multiple motors with the same ID are connected to the bus, causing response conflicts.
                      </div>
                      {busStatus.errorDump.errorDescription && (
                        <div className="text-accent-warning text-sm mb-3">
                          <strong>Error:</strong> {busStatus.errorDump.errorDescription}
                        </div>
                      )}
                    </div>

                    {/* Command Packet Hex Dump */}
                    {busStatus.errorDump.commandPacket && busStatus.errorDump.commandPacket.length > 0 && (
                      <div className="mb-4">
                        <div className="text-accent-data font-bold mb-2 text-sm">Command Sent (Request):</div>
                        <div className="bg-surface-base rounded p-3 font-mono text-xs overflow-x-auto">
                          <div className="text-accent-success">
                            {Array.from(busStatus.errorDump.commandPacket)
                              .map(byte => byte.toString(16).padStart(2, '0').toUpperCase())
                              .join(' ')}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Response Packet Hex Dump - hide for timeout errors (SEK_TIMEOUT = 6) */}
                    {busStatus.errorDump.errorKind !== 6 && busStatus.errorDump.responsePacket && busStatus.errorDump.responsePacket.length > 0 && (
                      <div className="mb-4">
                        <div className="text-accent-data font-bold mb-2 text-sm">Response Received (Error):</div>
                        <div className="bg-surface-base rounded p-3 font-mono text-xs overflow-x-auto">
                          <div className="text-accent-danger">
                            {Array.from(busStatus.errorDump.responsePacket)
                              .map(byte => byte.toString(16).padStart(2, '0').toUpperCase())
                              .join(' ')}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="bg-accent-danger/5 border border-accent-danger-deep rounded p-4 mt-4">
                      <div className="text-accent-warning font-bold mb-2">ST3215 Bus Limitation</div>
                      <div className="text-text-secondary text-sm leading-relaxed space-y-2">
                        <p>
                          The ST3215 serial bus protocol does not support automatic motor discovery.
                          Motors must be configured individually BEFORE connecting them together:
                        </p>
                        <ol className="list-decimal list-inside space-y-1 ml-2">
                          <li>Connect a single motor to the bus</li>
                          <li>Set its unique ID according to robot manual</li>
                          <li>Disconnect the motor</li>
                          <li>Repeat for each motor with a different ID</li>
                          <li>Only after all motors have unique IDs, connect them to the same bus</li>
                        </ol>
                        <p className="mt-3 text-accent-warning">
                          <strong>Note:</strong> Only one motor should be connected to the bus at a time during ID configuration.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : /* Priority 2: Show multiple motors warning (but not during or after recent motor ID change) */
          busStatus.motorsCount > 1 && !isMotorIdSetInProgress && (Date.now() - motorIdSetStartTime > 1000) ? (
            <div className="space-y-6">
              <div className="bg-accent-danger/10 border border-accent-danger-deep rounded-lg p-6">
                <div className="flex items-start gap-3">
                  <div className="text-accent-danger text-2xl">⚠️</div>
                  <div className="flex-1">
                    <div className="text-2xl font-bold text-accent-danger mb-4">
                      Do you have multiple ST3215 connected to the bus?
                    </div>

                    <h2 className="text-xl font-bold text-accent-danger mb-2">ST3215 Bus Warning</h2>

                    <div className="mb-4">
                      <div className="text-accent-danger font-bold mb-2">Multiple Motors Detected</div>
                      <div className="text-accent-danger text-sm leading-relaxed mb-3">
                        To safely configure motor IDs, connect only one motor at a time.
                      </div>
                      {selectedBus.motors && selectedBus.motors.length > 0 && (
                        <div className="bg-surface-base rounded p-3 font-mono text-sm mb-3">
                          <div className="text-accent-data mb-1">Detected Motor IDs:</div>
                          <div className="text-accent-success">
                            {selectedBus.motors
                              .filter(m => (m.error?.kind ?? 0) === 0)
                              .map(m => m.id ?? 0)
                              .join(', ')}
                          </div>
                        </div>
                      )}
                      <div className="text-accent-warning text-sm">
                        <strong>Action:</strong> Disconnect all motors except the one you want to configure.
                      </div>
                    </div>

                    <div className="bg-accent-danger/5 border border-accent-danger-deep rounded p-4 mt-4">
                      <div className="text-accent-warning font-bold mb-2">Motor ID Setup Procedure</div>
                      <div className="text-text-secondary text-sm leading-relaxed space-y-2">
                        <p>
                          When setting up motors with unknown IDs:
                        </p>
                        <ol className="list-decimal list-inside space-y-1 ml-2">
                          <li>Connect one motor to the bus</li>
                          <li>Use this tool to set its unique ID according to robot manual</li>
                          <li>Disconnect the motor</li>
                          <li>Repeat for each motor with a different ID</li>
                          <li>After all motors have unique IDs, you can connect them together for normal operation</li>
                        </ol>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : /* Priority 3: Show motor controls if we have motor data or motor ID setting in progress */
          (motor && motorState) || isMotorIdSetInProgress ? (
            <div className="space-y-6">
              {/* Motor Info - only show if we have motor data */}
              {motor && motorState && (
                <>
                  <div className="bg-surface-primary rounded-lg p-6">
                    <h2 className="text-xl font-bold text-accent-warning mb-4">Motor Information</h2>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
                      <div>
                        <span className="text-text-muted">Current Motor ID:</span>
                        <span className="text-accent-success ml-2 font-bold">{motorId}</span>
                      </div>
                      <div>
                        <span className="text-text-muted">State Size:</span>
                        <span className="text-accent-data ml-2">{motorState.length} bytes</span>
                      </div>
                    </div>
                  </div>

                  {/* Motor State Hex Dump */}
                  <div className="bg-surface-primary rounded-lg p-6">
                    <h2 className="text-xl font-bold text-accent-warning mb-4">Motor State (Hex Dump)</h2>
                    <div className="bg-surface-base rounded-lg p-4 font-mono text-sm overflow-x-auto">
                      <div className="text-text-muted mb-2">Address  00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F</div>
                      {Array.from({ length: Math.ceil(motorState.length / 16) }, (_, rowIndex) => {
                        const startAddr = rowIndex * 16;
                        const rowData = motorState.slice(startAddr, startAddr + 16);
                        return (
                          <div key={rowIndex} className="flex gap-2">
                            <span className="text-text-muted w-16">
                              {startAddr.toString(16).padStart(8, '0').toUpperCase()}
                            </span>
                            <span className="text-accent-success">
                              {Array.from(rowData)
                                .map(byte => byte.toString(16).padStart(2, '0').toUpperCase())
                                .join(' ')
                                .padEnd(47, ' ')}
                            </span>
                            <span className="text-text-label">
                              {Array.from(rowData)
                                .map(byte => (byte >= 32 && byte <= 126) ? String.fromCharCode(byte) : '.')
                                .join('')}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {/* Control Buttons */}
              <div className="bg-surface-primary rounded-lg p-6">
                <h2 className="text-xl font-bold text-accent-warning mb-4">Motor Control</h2>

                {/* Motor ID Setting */}
                <div className="mb-6">
                  <h3 className="text-lg font-bold text-accent-data mb-3">Set Motor ID</h3>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <label htmlFor="motorId" className="text-text-label text-sm">New Motor ID:</label>
                      <input
                        id="motorId"
                        type="number"
                        min="1"
                        max="10"
                        value={newMotorId}
                        onClick={(e) => (e.target as HTMLInputElement).select()}
                        onChange={(e) => setNewMotorId(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                        disabled={isMotorIdSetInProgress}
                        className="w-20 px-3 py-2 bg-surface-secondary text-accent-success border border-border-subtle rounded focus:border-accent-data focus:outline-none disabled:opacity-50"
                      />
                      <span className="text-text-muted text-sm">(1-10)</span>
                    </div>
                    <button
                      onClick={handleSetMotorId}
                      disabled={isMotorIdSetInProgress || newMotorId < 1 || newMotorId > 10}
                      className={`px-6 py-2 rounded-lg transition-colors font-bold ${
                        isMotorIdSetInProgress || newMotorId < 1 || newMotorId > 10
                          ? 'bg-surface-elevated text-text-label cursor-not-allowed'
                          : 'bg-accent-info-bg text-text-primary hover:bg-accent-info-deep'
                      }`}
                    >
                      {isMotorIdSetInProgress ? 'Setting Motor ID...' : 'Set Motor ID'}
                    </button>
                  </div>

                  {/* Command Log */}
                  {commandLog.length > 0 && (
                    <div className="mt-4 bg-surface-base rounded-lg p-4 font-mono text-sm max-h-64 overflow-y-auto">
                      <div className="text-accent-data font-bold mb-2">Command Log:</div>
                      {commandLog.map((log, index) => (
                        <div
                          key={index}
                          className={`${
                            log.startsWith('✓') ? 'text-accent-success' :
                            log.startsWith('✗') ? 'text-accent-critical' :
                            log.includes('Waiting') ? 'text-accent-warning' :
                            'text-text-label'
                          }`}
                        >
                          {log}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            </div>
          ) : (
            <div className="bg-surface-primary rounded-lg p-6">
              <div className="text-text-label">No motor data available for this bus.</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-base text-accent-success font-mono p-6">
      <div className="container mx-auto">
        <h1 className="text-3xl font-bold text-accent-data mb-4">ST3215 Motor ID Configuration</h1>
        <p className="text-text-label mb-4">
          No bus selected for configuration. Please go back to the main page and select a bus.
        </p>
        <Link
            to="/"
            className="px-4 py-2 bg-surface-elevated text-text-primary rounded hover:bg-surface-active transition-colors"
        >
            ← Back to Home
        </Link>
      </div>
    </div>
  );
};

export default St3215MotorConfigPage;
