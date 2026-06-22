import { memo } from 'react';
import { yahboom_dogzilla_lite } from '@/api/proto.js';
import YahboomDogzillaLiteViewer from '@/yahboom_dogzilla_lite/YahboomDogzillaLiteViewer';

interface YahboomDogzillaLiteExpandedProps {
  data: yahboom_dogzilla_lite.InferenceState;
}

const SERVO_LABELS = [
  { id: 11, label: 'front left leg elbow' },
  { id: 12, label: 'front left leg arm' },
  { id: 13, label: 'front left leg shoulder' },
  { id: 21, label: 'front right leg elbow' },
  { id: 22, label: 'front right leg arm' },
  { id: 23, label: 'front right leg shoulder' },
  { id: 31, label: 'rear right leg elbow' },
  { id: 32, label: 'rear right leg arm' },
  { id: 33, label: 'rear right leg shoulder' },
  { id: 41, label: 'rear left leg elbow' },
  { id: 42, label: 'rear left leg arm' },
  { id: 43, label: 'rear left leg shoulder' },
  { id: 51, label: 'arm gripper' },
  { id: 52, label: 'arm elbow' },
  { id: 53, label: 'arm shoulder' },
];

function ServoTable({ status }: { status: yahboom_dogzilla_lite.IYahboomDogzillaLiteStatus }) {
  const positions = status.servoPositions ?? [];
  const angles = status.servoAngles ?? [];

  if (positions.length === 0 && angles.length === 0) {
    return <div className="text-xs text-text-muted">No servo data.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full table-fixed text-xs text-text-secondary">
        <colgroup>
          <col className="w-1/3" />
          <col className="w-1/3" />
          <col className="w-1/3" />
        </colgroup>
        <thead>
          <tr className="border-b-2 border-border-default text-text-label">
            <th className="px-2 py-1 text-left font-semibold">Servo</th>
            <th className="px-2 py-1 text-center font-semibold">Position</th>
            <th className="px-2 py-1 text-center font-semibold">Angle</th>
          </tr>
        </thead>
        <tbody>
          {SERVO_LABELS.map((servo, idx) => (
            <tr key={servo.id} className={`border-t border-border-default ${idx % 2 === 1 ? 'bg-surface-primary/30' : ''}`}>
              <td className="break-words px-2 py-0.5 text-left text-accent-data">
                <span className="font-mono text-accent-data">{servo.id}</span> ({servo.label})
              </td>
              <td className="px-2 py-0.5 text-center font-mono text-accent-secondary">
                {positions[idx] !== undefined ? positions[idx] : '--'}
              </td>
              <td className="px-2 py-0.5 text-center font-mono text-accent-info">
                {angles[idx] !== undefined ? `${angles[idx].toFixed(1)}` : '--'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const YahboomDogzillaLiteExpanded = memo(function YahboomDogzillaLiteExpanded({ data }: YahboomDogzillaLiteExpandedProps) {
  const deviceCount = data.devices?.length ?? 0;
  const connectedCount = data.devices?.filter(d => d.isConnected).length ?? 0;

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-xs text-text-label">YahboomDogzillaLite Inference State:</div>
        <div className="space-y-1 rounded bg-surface-primary p-2 text-xs">
          <div className="text-accent-orange">Type: YahboomDogzillaLite Inference State</div>
          <div className="text-accent-data">Devices: {deviceCount}</div>
          <div className="text-accent-success">Connected: {connectedCount}</div>
        </div>
      </div>

      {deviceCount === 0 && (
        <div className="rounded bg-surface-primary p-2 text-xs text-text-label">
          No device data available.
        </div>
      )}

      {data.devices?.map((deviceState, idx) => {
        const device = deviceState.device;
        const status = deviceState.status;
        const modelName = device?.model !== undefined && device.model !== null
          ? yahboom_dogzilla_lite.YahboomDogzillaLiteModel[device.model] ?? 'Unknown'
          : 'Unknown';
        const deviceKey = device?.serialNumber
          || device?.portName
          || [device?.vid, device?.pid, device?.manufacturer, device?.product, device?.model]
            .filter(value => value !== undefined && value !== null && value !== '')
            .join(':')
          || deviceState.monotonicStampNs?.toString()
          || deviceState.systemStampNs?.toString()
          || 'unknown-yahboom_dogzilla_lite-device';

        return (
          <div key={deviceKey} className="space-y-2 rounded border border-border-default bg-surface-primary/60 p-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="font-mono text-accent-data">
                  {device?.portName ?? `Device ${idx + 1}`}
                </span>
                <span className="text-text-label">{modelName}</span>
                {device?.firmwareVersion && (
                  <span className="text-text-muted">v{device.firmwareVersion}</span>
                )}
              </div>
              <span className={deviceState.isConnected ? 'text-accent-success' : 'text-accent-critical'}>
                {deviceState.isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>

            {status && (
              <div className="flex items-center gap-4 text-xs">
                {status.batteryLevel !== undefined && status.batteryLevel !== null && (
                  <span className="text-accent-warning">Battery: {status.batteryLevel}%</span>
                )}
                {status.orientation && (
                  <span className="text-accent-info">
                    IMU: R{status.orientation.roll?.toFixed(1)} P{status.orientation.pitch?.toFixed(1)} Y{status.orientation.yaw?.toFixed(1)}
                  </span>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-2">
              <div className="min-h-[280px] overflow-hidden rounded bg-surface-base lg:order-1">
                <YahboomDogzillaLiteViewer status={status} />
              </div>
              <div className="lg:order-2">
                {status ? <ServoTable status={status} /> : (
                  <div className="text-xs text-text-muted">No status data.</div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
});

export default YahboomDogzillaLiteExpanded;
