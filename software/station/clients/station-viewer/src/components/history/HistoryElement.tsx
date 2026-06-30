import { useState } from 'react';
import { arduino_nicla_sense_env, usbvideo, st3215, motors_mirroring, sysinfo, yahboom_dogzilla_lite, normvla, vesc_trampa } from '@/api/proto.js';
import { formatBytes, parseUsbVideoData, parseMirroringData, parseSysinfoData, parseArduinoNiclaSenseEnvData, parseYahboomDogzillaLiteData, parseNormvlaData } from '@/components/history/history-utils';
import ExpandedView from '@/components/history/ExpandedView';

export interface HistoryElementData {
  queueId: string;
  entryId: Uint8Array;
  data: Uint8Array | usbvideo.IRxEnvelope | st3215.IInferenceState | st3215.ITxEnvelope | motors_mirroring.IRxEnvelope | sysinfo.IEnvelope | arduino_nicla_sense_env.IRxEnvelope | yahboom_dogzilla_lite.IInferenceState | vesc_trampa.IInferenceState | vesc_trampa.IRxEnvelope | vesc_trampa.ITxEnvelope | normvla.IFrame | null;
  rawData?: Uint8Array | null;
  error?: string;
  type?: string;
  queueType?: number;
}

interface HistoryElementProps {
  element: HistoryElementData;
  index: number;
  dataQueueType?: string;
  dataQueueId?: string;
}

const LONG_QUEUE_ID_PREFIX = /^[a-f0-9]{32,}$/i;

function formatQueueIdForDisplay(queueId: string): string {
  if (!queueId) {
    return queueId;
  }

  const hasLeadingSlash = queueId.startsWith('/');
  const segments = queueId.split('/').filter(Boolean);

  if (segments.length < 2 || !LONG_QUEUE_ID_PREFIX.test(segments[0])) {
    return queueId;
  }

  const withoutPrefix = segments.slice(1).join('/');
  return hasLeadingSlash ? `/${withoutPrefix}` : withoutPrefix;
}

function readFloat32LE(bytes: Uint8Array | null | undefined, offset: number): number | null {
  if (!bytes || offset < 0 || offset + 4 > bytes.length) {
    return null;
  }
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat32(offset, true);
}

function readUint16LE(bytes: Uint8Array | null | undefined, offset: number): number | null {
  if (!bytes || offset < 0 || offset + 2 > bytes.length) {
    return null;
  }
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

function formatSensorValue(value: number | null, unit = ''): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return `${value.toFixed(2)}${unit}`;
}

function HistoryElement({ element, index, dataQueueType, dataQueueId }: HistoryElementProps) {
  const [isExpanded, setIsExpanded] = useState(element.type === 'usbvideo' || element.type === 'st3215' || element.type === 'yahboom_dogzilla_lite' || element.type === 'arduino-nicla-sense-env' || element.type === 'normvla' || element.type === 'st3215tx' || element.type === 'vesc-trampa' || element.type === 'vesc-trampa-rx' || element.type === 'vesc-trampa-tx');
  const displayQueueId = formatQueueIdForDisplay(element.queueId);

  const usbVideoData = element.type === 'usbvideo' && element.data ? parseUsbVideoData(element.data) : null;
  const mirroringData = element.type === 'mirroring' && element.data ? parseMirroringData(element.data) : null;
  const sysinfoData = element.type === 'sysinfo' && element.data ? parseSysinfoData(element.data) : null;
  const arduinoNiclaSenseEnvData = element.type === 'arduino-nicla-sense-env' && element.data ? parseArduinoNiclaSenseEnvData(element.data) : null;
  const arduinoNiclaSenseEnvBytes = arduinoNiclaSenseEnvData?.data ?? null;
  const arduinoNiclaSenseEnvTemperature = formatSensorValue(readFloat32LE(arduinoNiclaSenseEnvBytes, 0x18), 'C');
  const arduinoNiclaSenseEnvHumidity = formatSensorValue(readFloat32LE(arduinoNiclaSenseEnvBytes, 0x1c), '%');
  const arduinoNiclaSenseEnvEpaAqi = readUint16LE(arduinoNiclaSenseEnvBytes, 0x28);
  const arduinoNiclaSenseEnvIaq = formatSensorValue(readFloat32LE(arduinoNiclaSenseEnvBytes, 0x70));
  const arduinoNiclaSenseEnvTvoc = formatSensorValue(readFloat32LE(arduinoNiclaSenseEnvBytes, 0x74), 'mg/m^3');
  const arduinoNiclaSenseEnvEco2 = formatSensorValue(readFloat32LE(arduinoNiclaSenseEnvBytes, 0x78), 'ppm');
  const yahboom_dogzilla_liteData = element.type === 'yahboom_dogzilla_lite' && element.data ? parseYahboomDogzillaLiteData(element.data) : null;
  const normvlaData = element.type === 'normvla' && element.data ? parseNormvlaData(element.data as Uint8Array | normvla.IFrame) : null;
  const st3215TxData = element.type === 'st3215tx' && element.data && !(element.data instanceof Uint8Array) ? element.data as st3215.ITxEnvelope : null;
  const vescTrampaTxData = element.type === 'vesc-trampa-tx' && element.data && !(element.data instanceof Uint8Array) ? element.data as vesc_trampa.ITxEnvelope : null;

  const canExpand = !!element.data;

  return (
    <div 
      className="bg-surface-secondary rounded mb-2 overflow-hidden"
      data-queue-type={dataQueueType}
      data-queue-id={dataQueueId}
    >
      <div
        onClick={canExpand ? () => setIsExpanded(!isExpanded) : undefined}
        className={`
          flex items-center justify-between p-2 group
          ${canExpand ? 'cursor-pointer hover:bg-surface-tertiary' : ''}
          transition-all duration-150
          ${canExpand && !isExpanded ? 'hover:pl-3' : ''}
        `}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-xs font-mono text-accent-info">#{index + 1}</span>
          {canExpand && (
            <span className={`
              text-xs transition-all duration-200
              ${isExpanded ? 'text-text-label rotate-90' : 'text-text-muted group-hover:text-text-secondary'}
            `}>
              ▶
            </span>
          )}
          <span className="text-accent-warning font-mono text-sm truncate">{displayQueueId}</span>
          <span className="text-text-label text-xs">→</span>
          <span className="text-accent-success font-mono text-xs">{formatBytes(element.entryId)}</span>
          {element.type && (
            <>
              <span className="text-text-label text-xs">|</span>
              <span className="text-accent-secondary text-xs font-mono">{element.type}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {element.data ? (
            <>
              <span className="text-xs text-text-secondary">
                {element.data instanceof Uint8Array
                  ? `${element.data.length.toLocaleString()}b`
                  : 'Parsed'}
              </span>
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className={`
                  text-xs px-1.5 py-0.5 rounded transition-all duration-150
                  ${isExpanded
                    ? 'bg-surface-elevated text-text-primary'
                    : 'bg-surface-tertiary text-text-secondary hover:bg-surface-elevated'
                  }
                `}
              >
                {isExpanded ? '−' : '+'}
              </button>
            </>
          ) : (
            <span className="text-xs text-accent-critical">
              {element.error || 'No data'}
            </span>
          )}
        </div>
      </div>

      {!isExpanded && (
        <div className="px-2 pb-2 space-y-1">
          {element.data && element.data instanceof Uint8Array && !usbVideoData && !normvlaData && (
            <div className="bg-surface-primary p-1.5 rounded font-mono text-xs text-accent-success overflow-x-auto">
              {formatBytes(element.data, 32)}
              {element.data.length > 32 && '...'}
            </div>
          )}

          {usbVideoData && (
            <div className="space-y-1">
              {usbVideoData.frames && usbVideoData.frames.stamps && usbVideoData.frames.stamps.length > 0 && (
                <div className="text-xs text-accent-data">
                  Frames: {usbVideoData.frames.stamps.length}
                </div>
              )}
            </div>
          )}

          {mirroringData && (
            <div className="space-y-1">
              {mirroringData.state?.mirroring && mirroringData.state.mirroring.length > 0 && (
                <div className="text-xs text-accent-secondary">
                  Mirroring: {mirroringData.state.mirroring.length} configs
                </div>
              )}
            </div>
          )}

          {sysinfoData && (
            <div className="flex items-center gap-3 text-xs">
              {sysinfoData.data?.cpu && sysinfoData.data.cpu.length > 0 && (
                <span className="text-accent-data">
                  CPU: {(sysinfoData.data.cpu.reduce((sum, cpu) => sum + (cpu.usage || 0), 0) / sysinfoData.data.cpu.length).toFixed(2)}%
                </span>
              )}
              {sysinfoData.data?.memory && (
                <span className="text-accent-success">
                  Mem: {(Number(sysinfoData.data.memory.usedBytes || 0) / (1024 * 1024 * 1024)).toFixed(2)}/{(Number(sysinfoData.data.memory.totalBytes || 0) / (1024 * 1024 * 1024)).toFixed(2)}GB
                </span>
              )}
              {sysinfoData.data?.hostname && (
                <span className="text-text-label">
                  {sysinfoData.data.hostname}
                </span>
              )}
            </div>
          )}

          {arduinoNiclaSenseEnvData && (
            <div className="flex items-center gap-3 text-xs">
              <span className="text-accent-success">
                {arduino_nicla_sense_env.ArduinoNiclaSenseEnvSignalType[arduinoNiclaSenseEnvData.signalType]
                  ?.replace(/^ARDUINO_NICLA_SENSE_ENV_/, '')
                  .replace(/_/g, ' ') ?? arduinoNiclaSenseEnvData.signalType}
              </span>
              {arduinoNiclaSenseEnvData.device && (
                <span className="text-accent-info">
                  {arduinoNiclaSenseEnvData.device.id || `i2c-${arduinoNiclaSenseEnvData.device.i2cBus}`}
                </span>
              )}
              {arduinoNiclaSenseEnvTemperature && (
                <span className="text-accent-danger">Temp: {arduinoNiclaSenseEnvTemperature}</span>
              )}
              {arduinoNiclaSenseEnvHumidity && (
                <span className="text-accent-info">RH: {arduinoNiclaSenseEnvHumidity}</span>
              )}
              {arduinoNiclaSenseEnvEpaAqi !== null && (
                <span className="text-accent-warning">AQI: {arduinoNiclaSenseEnvEpaAqi}</span>
              )}
              {arduinoNiclaSenseEnvIaq && (
                <span className="text-accent-secondary">IAQ: {arduinoNiclaSenseEnvIaq}</span>
              )}
              {arduinoNiclaSenseEnvTvoc && (
                <span className="text-accent-data">TVOC: {arduinoNiclaSenseEnvTvoc}</span>
              )}
              {arduinoNiclaSenseEnvEco2 && (
                <span className="text-accent-success">eCO2: {arduinoNiclaSenseEnvEco2}</span>
              )}
            </div>
          )}

          {yahboom_dogzilla_liteData && (
            <div className="space-y-1">
              {yahboom_dogzilla_liteData.devices && yahboom_dogzilla_liteData.devices.length > 0 && (
                <div className="text-xs text-accent-data">
                  Devices: {yahboom_dogzilla_liteData.devices.length}
                  {yahboom_dogzilla_liteData.devices.filter(d => d.isConnected).length > 0 && (
                    <span className="text-accent-success ml-2">
                      ({yahboom_dogzilla_liteData.devices.filter(d => d.isConnected).length} connected)
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {normvlaData && (
            <div className="flex items-center gap-3 text-xs">
              {normvlaData.joints && normvlaData.joints.length > 0 && (
                <span className="text-accent-danger">
                  Joints: {normvlaData.joints.length}
                </span>
              )}
              {normvlaData.images && normvlaData.images.length > 0 && (
                <span className="text-accent-data">
                  Images: {normvlaData.images.length}
                </span>
              )}
            </div>
          )}

          {st3215TxData && (
            <div className="flex items-center gap-3 text-xs">
              {st3215TxData.targetBusSerial !== undefined && (
                <span className="text-accent-danger">
                  Bus: {st3215TxData.targetBusSerial}
                </span>
              )}
              {st3215TxData.write && (
                <span className="text-accent-data">
                  Write
                </span>
              )}
              {st3215TxData.regWrite && (
                <span className="text-accent-secondary">
                  RegWrite
                </span>
              )}
              {st3215TxData.action && (
                <span className="text-accent-success">
                  Action
                </span>
              )}
            </div>
          )}

          {vescTrampaTxData && (
            <div className="flex items-center gap-3 text-xs">
              {vescTrampaTxData.targetBoardUuid && (
                <span className="text-accent-danger">
                  UUID: {formatBytes(vescTrampaTxData.targetBoardUuid, 12)}
                </span>
              )}
              {vescTrampaTxData.boardCommand && (
                <span className="text-accent-data">
                  Payload: {vescTrampaTxData.boardCommand.payload?.length ?? 0}b
                </span>
              )}
              {vescTrampaTxData.boardCommand?.responseExpected && (
                <span className="text-accent-success">
                  Response
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {element.data && isExpanded && (
        <div className="px-2 pb-2 space-y-2">
          <ExpandedView data={element.data} type={element.type} rawData={element.rawData} />
        </div>
      )}

      {!element.data && (
        <div className="px-2 pb-2 text-center">
          <div className="text-accent-critical text-xs">
            {element.error || 'Entry not found'}
          </div>
        </div>
      )}
    </div>
  );
}

export default HistoryElement;
