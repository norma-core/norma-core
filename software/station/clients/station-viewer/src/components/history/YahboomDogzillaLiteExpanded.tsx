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
    return <div className="text-xs text-gray-500">No servo data.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full table-fixed text-xs text-gray-300">
        <colgroup>
          <col className="w-1/3" />
          <col className="w-1/3" />
          <col className="w-1/3" />
        </colgroup>
        <thead>
          <tr className="text-gray-400 border-b-2 border-gray-700">
            <th className="px-2 py-1 text-left font-semibold">Servo</th>
            <th className="px-2 py-1 text-center font-semibold">Position</th>
            <th className="px-2 py-1 text-center font-semibold">Angle</th>
          </tr>
        </thead>
        <tbody>
          {SERVO_LABELS.map((servo, idx) => (
            <tr key={servo.id} className={`border-t border-gray-800 ${idx % 2 === 1 ? 'bg-gray-900/30' : ''}`}>
              <td className="break-words px-2 py-0.5 text-left text-cyan-400">
                <span className="font-mono text-cyan-300">{servo.id}</span> ({servo.label})
              </td>
              <td className="px-2 py-0.5 text-center font-mono text-purple-400">
                {positions[idx] !== undefined ? positions[idx] : '--'}
              </td>
              <td className="px-2 py-0.5 text-center font-mono text-blue-400">
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
        <div className="text-xs text-gray-400 mb-1">YahboomDogzillaLite Inference State:</div>
        <div className="bg-gray-900 p-2 rounded text-xs space-y-1">
          <div className="text-orange-400">Type: YahboomDogzillaLite Inference State</div>
          <div className="text-cyan-400">Devices: {deviceCount}</div>
          <div className="text-green-400">Connected: {connectedCount}</div>
        </div>
      </div>

      {deviceCount === 0 && (
        <div className="bg-gray-900 p-2 rounded text-xs text-gray-400">
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
          <div key={deviceKey} className="bg-gray-900/60 border border-gray-800 rounded p-2 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="text-cyan-400 font-mono">
                  {device?.portName ?? `Device ${idx + 1}`}
                </span>
                <span className="text-gray-400">{modelName}</span>
                {device?.firmwareVersion && (
                  <span className="text-gray-500">v{device.firmwareVersion}</span>
                )}
              </div>
              <span className={deviceState.isConnected ? 'text-green-400' : 'text-red-400'}>
                {deviceState.isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>

            {status && (
              <div className="flex items-center gap-4 text-xs">
                {status.batteryLevel !== undefined && status.batteryLevel !== null && (
                  <span className="text-yellow-400">Battery: {status.batteryLevel}%</span>
                )}
                {status.orientation && (
                  <span className="text-blue-400">
                    IMU: R{status.orientation.roll?.toFixed(1)} P{status.orientation.pitch?.toFixed(1)} Y{status.orientation.yaw?.toFixed(1)}
                  </span>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-2">
              <div className="min-h-[280px] overflow-hidden rounded bg-gray-950 lg:order-1">
                <YahboomDogzillaLiteViewer status={status} />
              </div>
              <div className="lg:order-2">
                {status ? <ServoTable status={status} /> : (
                  <div className="text-xs text-gray-500">No status data.</div>
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
