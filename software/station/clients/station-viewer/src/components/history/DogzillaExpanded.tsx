import { memo } from 'react';
import { dogzilla } from '@/api/proto.js';
import DogzillaViewer from '@/dogzilla/DogzillaViewer';

interface DogzillaExpandedProps {
  data: dogzilla.InferenceState;
}

function ServoTable({ status }: { status: dogzilla.IDogzillaStatus }) {
  const positions = status.servoPositions ?? [];
  const angles = status.servoAngles ?? [];
  const servoLabels = [
    '1.1', '1.2', '1.3', '2.1', '2.2', '2.3',
    '3.1', '3.2', '3.3', '4.1', '4.2', '4.3',
    'Grip', 'Arm1', 'Arm2'
  ];

  if (positions.length === 0 && angles.length === 0) {
    return <div className="text-xs text-gray-500">No servo data.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs text-gray-300">
        <thead>
          <tr className="text-gray-400 border-b-2 border-gray-700">
            <th className="text-center font-semibold py-1 pr-2">Servo</th>
            <th className="text-center font-semibold py-1 pr-2">Position</th>
            <th className="text-center font-semibold py-1">Angle</th>
          </tr>
        </thead>
        <tbody>
          {servoLabels.map((label, idx) => (
            <tr key={label} className={`border-t border-gray-800 ${idx % 2 === 1 ? 'bg-gray-900/30' : ''}`}>
              <td className="py-0.5 pr-2 text-center text-cyan-400 font-mono">{label}</td>
              <td className="py-0.5 pr-2 text-center text-purple-400 font-mono">
                {positions[idx] !== undefined ? positions[idx] : '--'}
              </td>
              <td className="py-0.5 text-center text-blue-400 font-mono">
                {angles[idx] !== undefined ? `${angles[idx].toFixed(1)}` : '--'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const DogzillaExpanded = memo(function DogzillaExpanded({ data }: DogzillaExpandedProps) {
  const deviceCount = data.devices?.length ?? 0;
  const connectedCount = data.devices?.filter(d => d.isConnected).length ?? 0;

  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs text-gray-400 mb-1">Dogzilla Inference State:</div>
        <div className="bg-gray-900 p-2 rounded text-xs space-y-1">
          <div className="text-orange-400">Type: Dogzilla Inference State</div>
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
          ? dogzilla.DogzillaModel[device.model] ?? 'Unknown'
          : 'Unknown';
        const deviceKey = device?.serialNumber
          || device?.portName
          || [device?.vid, device?.pid, device?.manufacturer, device?.product, device?.model]
            .filter(value => value !== undefined && value !== null && value !== '')
            .join(':')
          || deviceState.monotonicStampNs?.toString()
          || deviceState.systemStampNs?.toString()
          || 'unknown-dogzilla-device';

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

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="bg-gray-950 rounded h-48 overflow-hidden lg:order-1">
                <DogzillaViewer status={status} />
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

export default DogzillaExpanded;
