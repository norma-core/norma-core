import { memo, useEffect, useMemo, useState } from 'react';
import { commandManager } from '@/api/commands.js';
import { dogzilla, ov5647, usbvideo } from '@/api/proto.js';
import DogzillaDesktopActionPanel from '@/dogzilla/DogzillaDesktopActionPanel';
import DogzillaDesktopMovementPanel from '@/dogzilla/DogzillaDesktopMovementPanel';
import DogzillaViewer from '@/dogzilla/DogzillaViewer';
import Ov5647CameraViewer from '@/ov5647/CameraViewer';
import UsbCameraViewer from '@/usbvideo/CameraViewer';

const DEFAULT_SERVO_POSITIONS = [
  128, 200, 110, 128, 200, 110, 128, 200, 110, 128, 200, 110,
  0, 255, 0
];

const SERVO_IDS = [
  '11', '12', '13',
  '21', '22', '23',
  '31', '32', '33',
  '41', '42', '43',
  '51', '52', '53'
];

const LEG_CONTROLS = [
  { id: '13', name: 'Shoulder' },
  { id: '12', name: 'Arm' },
  { id: '11', name: 'Elbow' }
];

const ARM_CONTROLS = [
  { id: '53', name: 'Shoulder' },
  { id: '52', name: 'Elbow' },
  { id: '51', name: 'Gripper' }
];

interface DogzillaDesktopDashboardProps {
  deviceState: dogzilla.InferenceState.IDeviceState | null;
  refreshToken?: number;
  selectedVideoSource?:
    | { kind: 'usbvideo'; source: usbvideo.IRxEnvelope }
    | { kind: 'ov5647'; source: ov5647.IRxEnvelope };
}

const DogzillaDesktopDashboard = memo(function DogzillaDesktopDashboard({
  deviceState,
  refreshToken,
  selectedVideoSource
}: DogzillaDesktopDashboardProps) {
  const [legsSpeed, setLegsSpeed] = useState(128);
  const [armSpeed, setArmSpeed] = useState(128);

  const status = deviceState?.status ?? null;
  const device = deviceState?.device ?? null;

  const modelLabel = useMemo(() => {
    if (device?.model === null || device?.model === undefined) {
      return 'Unknown';
    }
    return dogzilla.DogzillaModel[device.model] ?? 'DOGZILLA_MODEL_UNKNOWN';
  }, [device?.model]);

  const livePositions = useMemo(() => {
    if (!status?.servoPositions || status.servoPositions.length < 15) {
      return null;
    }
    return status.servoPositions.slice(0, 15).map((value) => Number(value));
  }, [status?.servoPositions]);

  const liveAngles = useMemo(() => {
    if (!status?.servoAngles || status.servoAngles.length < 15) {
      return null;
    }
    return status.servoAngles.slice(0, 15).map((value) => Number(value));
  }, [status?.servoAngles]);

  const displayPositions = livePositions ?? DEFAULT_SERVO_POSITIONS;

  const sendServoCommand = (servoId: number, position: number) => {
    commandManager.sendDogzillaCommand({
      targetDeviceSerial: device?.serialNumber ?? '',
      servo: { servoId, position }
    });
  };

  const sendLegsSpeedCommand = (bodySpeed: number) => {
    commandManager.sendDogzillaCommand({
      targetDeviceSerial: device?.serialNumber ?? '',
      servoSpeed: { bodyServoSpeed: bodySpeed }
    });
  };

  const sendArmSpeedCommand = (armServoSpeed: number) => {
    commandManager.sendDogzillaCommand({
      targetDeviceSerial: device?.serialNumber ?? '',
      servoSpeed: { armServoSpeed }
    });
  };

  useEffect(() => {
    if (status?.legServoSpeed !== null && status?.legServoSpeed !== undefined) {
      setLegsSpeed(status.legServoSpeed);
    }
    if (status?.armServoSpeed !== null && status?.armServoSpeed !== undefined) {
      setArmSpeed(status.armServoSpeed);
    }
  }, [status?.armServoSpeed, status?.legServoSpeed]);

  const updateServo = (index: number, value: number) => {
    const servoId = Number(SERVO_IDS[index]);
    if (!Number.isNaN(servoId)) {
      sendServoCommand(servoId, value);
    }
  };

  const commitLegsSpeedChange = () => {
    sendLegsSpeedCommand(legsSpeed);
  };

  const commitArmSpeedChange = () => {
    sendArmSpeedCommand(armSpeed);
  };

  const batteryPercent = status?.batteryLevel ?? null;
  const batteryFill = batteryPercent === null ? 0 : Math.min(100, Math.max(0, batteryPercent));
  const batteryClass = batteryFill < 20 ? 'bg-red-500' : batteryFill < 50 ? 'bg-amber-400' : 'bg-green-400';

  return (
    <div className="relative h-180">
      <DogzillaViewer
        status={status}
        servoPositions={displayPositions}
        servoAngles={liveAngles}
        refreshToken={refreshToken}
      />
      <div className="pointer-events-none absolute inset-0">
        <div className="pointer-events-auto absolute left-3 top-3 w-52 rounded-lg border border-gray-700 bg-gray-900/90 p-3 backdrop-blur">
          <h3 className="border-b border-gray-700 pb-2 text-xs font-semibold uppercase tracking-wide text-cyan-400">
            Status
          </h3>
          <div className="mt-2 space-y-1 text-xs text-gray-300">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Model</span>
              <span className="text-gray-200">{modelLabel}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Firmware</span>
              <span className="text-gray-200">{device?.firmwareVersion || status?.firmwareVersion || '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Battery</span>
              <span className="text-gray-200">
                {batteryPercent === null ? '—' : `${batteryFill}%`}
              </span>
            </div>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded bg-gray-800">
            <div className={`h-full transition-all ${batteryClass}`} style={{ width: `${batteryFill}%` }} />
          </div>
        </div>

        <div className="pointer-events-auto absolute left-3 top-40 w-52 rounded-lg border border-gray-700 bg-gray-900/90 p-3 backdrop-blur">
          <h3 className="border-b border-gray-700 pb-2 text-xs font-semibold uppercase tracking-wide text-cyan-400">
            IMU Data
          </h3>
          <div className="mt-2 text-xs text-gray-300">
            <div className="text-[10px] uppercase tracking-wide text-gray-400">Orientation (deg)</div>
            <div className="mt-1 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Roll</span>
                <span className="font-mono text-cyan-200">{Math.round(status?.orientation?.roll ?? 0)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Pitch</span>
                <span className="font-mono text-cyan-200">{Math.round(status?.orientation?.pitch ?? 0)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Yaw</span>
                <span className="font-mono text-cyan-200">{Math.round(status?.orientation?.yaw ?? 0)}</span>
              </div>
            </div>
            <div className="mt-3 text-[10px] uppercase tracking-wide text-gray-400">Acceleration</div>
            <div className="mt-1 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">X</span>
                <span className="font-mono text-cyan-200">{(status?.acceleration?.x ?? 0).toFixed(1)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Y</span>
                <span className="font-mono text-cyan-200">{(status?.acceleration?.y ?? 0).toFixed(1)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Z</span>
                <span className="font-mono text-cyan-200">{(status?.acceleration?.z ?? 0).toFixed(1)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="pointer-events-auto absolute bottom-54 left-3 w-52 rounded-lg border border-gray-700 bg-gray-900/90 p-2 backdrop-blur">
          <h3 className="border-b border-gray-700 pb-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-400">
            Speed
          </h3>
          <div className="mt-2 space-y-2 text-[10px] text-gray-300">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Legs</span>
                <span className="font-mono text-cyan-200">{status?.legServoSpeed ?? '—'}</span>
              </div>
              <input
                type="range"
                min={0}
                max={255}
                value={legsSpeed}
                onChange={(event) => setLegsSpeed(Number(event.target.value))}
                onMouseUp={commitLegsSpeedChange}
                onTouchEnd={commitLegsSpeedChange}
                className="h-1 w-full accent-cyan-400"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Arm</span>
                <span className="font-mono text-cyan-200">{status?.armServoSpeed ?? '—'}</span>
              </div>
              <input
                type="range"
                min={0}
                max={255}
                value={armSpeed}
                onChange={(event) => setArmSpeed(Number(event.target.value))}
                onMouseUp={commitArmSpeedChange}
                onTouchEnd={commitArmSpeedChange}
                className="h-1 w-full accent-cyan-400"
              />
            </div>
          </div>
        </div>

        <div className="pointer-events-auto absolute bottom-90 left-[240px] w-52">
          <DogzillaDesktopMovementPanel deviceSerial={device?.serialNumber ?? ''} />
        </div>

        <div className="pointer-events-auto absolute bottom-10 left-60 w-52">
          <DogzillaDesktopActionPanel deviceSerial={device?.serialNumber ?? ''} />
        </div>

        <div className="pointer-events-auto absolute left-3 top-130 w-52 rounded-lg border border-gray-700 bg-gray-900/90 p-1.5 backdrop-blur">
          <h3 className="border-b border-gray-700 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-400">
            Robotic Arm
          </h3>
          {ARM_CONTROLS.map((control) => {
            const index = SERVO_IDS.indexOf(control.id);
            const angle = liveAngles?.[index];
            return (
              <div key={control.id} className="mt-1">
                <div className="flex items-center justify-between text-[9px] text-gray-400">
                  <span>{control.id === '51' ? control.name : `${control.name} (${control.id})`}</span>
                  <span className="font-mono text-green-300">
                    {displayPositions[index]} <span className="text-cyan-300">({angle ?? '—'}°)</span>
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={255}
                  value={displayPositions[index]}
                  onChange={(event) => updateServo(index, Number(event.target.value))}
                  className="h-1 w-full accent-cyan-400"
                />
              </div>
            );
          })}
        </div>

        <div className="pointer-events-auto absolute right-3 top-5 w-48 rounded-lg border border-gray-700 bg-gray-900/90 p-1.5 backdrop-blur">
          <h3 className="border-b border-gray-700 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-400">
            Leg 1 - Front Left
          </h3>
          {LEG_CONTROLS.map((control) => {
            const index = SERVO_IDS.indexOf(control.id);
            const angle = liveAngles?.[index];
            return (
              <div key={control.id} className="mt-1">
                <div className="flex items-center justify-between text-[9px] text-gray-400">
                  <span>{control.name} ({control.id})</span>
                  <span className="font-mono text-green-300">
                    {displayPositions[index]} <span className="text-cyan-300">({angle ?? '—'}°)</span>
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={255}
                  value={displayPositions[index]}
                  onChange={(event) => updateServo(index, Number(event.target.value))}
                  className="h-1 w-full accent-cyan-400"
                />
              </div>
            );
          })}
        </div>

        {selectedVideoSource && (
          <div className="pointer-events-auto absolute bottom-4 right-4 h-[200px] w-2/5 max-w-[360px] lg:right-56">
            {selectedVideoSource.kind === 'usbvideo' ? (
              <UsbCameraViewer inferenceState={selectedVideoSource.source} />
            ) : (
              <Ov5647CameraViewer inferenceState={selectedVideoSource.source} />
            )}
          </div>
        )}

        <div className="pointer-events-auto absolute right-3 top-48 w-48 rounded-lg border border-gray-700 bg-gray-900/90 p-1.5 backdrop-blur">
          <h3 className="border-b border-gray-700 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-400">
            Leg 2 - Front Right
          </h3>
          {LEG_CONTROLS.map((control) => {
            const index = SERVO_IDS.indexOf(control.id.replace('1', '2'));
            const angle = liveAngles?.[index];
            return (
              <div key={control.id} className="mt-1">
                <div className="flex items-center justify-between text-[9px] text-gray-400">
                  <span>{control.name} ({control.id.replace('1', '2')})</span>
                  <span className="font-mono text-green-300">
                    {displayPositions[index]} <span className="text-cyan-300">({angle ?? '—'}°)</span>
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={255}
                  value={displayPositions[index]}
                  onChange={(event) => updateServo(index, Number(event.target.value))}
                  className="h-1 w-full accent-cyan-400"
                />
              </div>
            );
          })}
        </div>

        <div className="pointer-events-auto absolute right-3 top-92 w-48 rounded-lg border border-gray-700 bg-gray-900/90 p-1.5 backdrop-blur">
          <h3 className="border-b border-gray-700 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-400">
            Leg 3 - Rear Right
          </h3>
          {LEG_CONTROLS.map((control) => {
            const index = SERVO_IDS.indexOf(control.id.replace('1', '3'));
            const angle = liveAngles?.[index];
            return (
              <div key={control.id} className="mt-1">
                <div className="flex items-center justify-between text-[9px] text-gray-400">
                  <span>{control.name} ({control.id.replace('1', '3')})</span>
                  <span className="font-mono text-green-300">
                    {displayPositions[index]} <span className="text-cyan-300">({angle ?? '—'}°)</span>
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={255}
                  value={displayPositions[index]}
                  onChange={(event) => updateServo(index, Number(event.target.value))}
                  className="h-1 w-full accent-cyan-400"
                />
              </div>
            );
          })}
        </div>

        <div className="pointer-events-auto absolute right-3 top-135 w-48 rounded-lg border border-gray-700 bg-gray-900/90 p-1.5 backdrop-blur">
          <h3 className="border-b border-gray-700 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-400">
            Leg 4 - Rear Left
          </h3>
          {LEG_CONTROLS.map((control) => {
            const index = SERVO_IDS.indexOf(control.id.replace('1', '4'));
            const angle = liveAngles?.[index];
            return (
              <div key={control.id} className="mt-1">
                <div className="flex items-center justify-between text-[9px] text-gray-400">
                  <span>{control.name} ({control.id.replace('1', '4')})</span>
                  <span className="font-mono text-green-300">
                    {displayPositions[index]} <span className="text-cyan-300">({angle ?? '—'}°)</span>
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={255}
                  value={displayPositions[index]}
                  onChange={(event) => updateServo(index, Number(event.target.value))}
                  className="h-1 w-full accent-cyan-400"
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

export default DogzillaDesktopDashboard;
