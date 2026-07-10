import { useCallback, useEffect, useMemo, useState } from 'react';
import { airgradient_open_air_o_1pst, arduino_nicla_sense_env, ina226, usbvideo, st3215, motors_mirroring, sysinfo, yahboom_dogzilla_lite, normvla, vesc_trampa } from '@/api/proto.js';
import ArduinoNiclaSenseEnvExpanded from '@/components/history/ArduinoNiclaSenseEnvExpanded';
import Ina226Expanded from '@/components/history/Ina226Expanded';
import { airGradientDeviceLabel, airGradientLineText, readAirGradientValues } from '@/devices/airgradient-open-air-o-1pst/values';
import { createCroppedJson } from '@/components/history/history-utils';
import RawBytesExpanded from '@/components/history/RawBytesExpanded';
import MirroringExpanded from '@/components/history/MirroringExpanded';
import St3215Expanded from '@/components/history/St3215Expanded';
import St3215JsonView from '@/components/history/St3215JsonView';
import SysinfoGrid from '@/components/history/SysinfoGrid';
import UsbVideoExpanded from '@/components/history/UsbVideoExpanded';
import YahboomDogzillaLiteExpanded from '@/components/history/YahboomDogzillaLiteExpanded';
import NormvlaRobotRenderer from '@/st3215/NormvlaRobotRenderer';
import FullscreenImageViewer from '@/components/FullscreenImageViewer';

type DataTab = 'visual' | 'json' | 'raw';

interface ExpandedViewProps {
  data: usbvideo.IRxEnvelope | st3215.IInferenceState | st3215.ITxEnvelope | motors_mirroring.IRxEnvelope | sysinfo.IEnvelope | arduino_nicla_sense_env.IRxEnvelope | ina226.IRxEnvelope | airgradient_open_air_o_1pst.IRxEnvelope | yahboom_dogzilla_lite.IInferenceState | vesc_trampa.IInferenceState | vesc_trampa.IRxEnvelope | vesc_trampa.ITxEnvelope | normvla.IFrame | Uint8Array;
  type: string | undefined;
  rawData?: Uint8Array | null;
}

const TAB_OPTIONS: { id: DataTab; label: string }[] = [
  { id: 'visual', label: 'Visual' },
  { id: 'json', label: 'JSON' },
  { id: 'raw', label: 'Hex' }
];

function tryDecodeProtobuf(rawData: Uint8Array): { decoded: unknown; typeName: string } | null {
  const decoders = [
    { name: 'vesc_trampa.InferenceState', decode: () => vesc_trampa.InferenceState.decode(rawData) },
    { name: 'vesc_trampa.RxEnvelope', decode: () => vesc_trampa.RxEnvelope.decode(rawData) },
    { name: 'st3215.RxEnvelope', decode: () => st3215.RxEnvelope.decode(rawData) },
    { name: 'st3215.TxEnvelope', decode: () => st3215.TxEnvelope.decode(rawData) },
    { name: 'usbvideo.RxEnvelope', decode: () => usbvideo.RxEnvelope.decode(rawData) },
    { name: 'motors_mirroring.RxEnvelope', decode: () => motors_mirroring.RxEnvelope.decode(rawData) },
    { name: 'sysinfo.Envelope', decode: () => sysinfo.Envelope.decode(rawData) },
    { name: 'arduino_nicla_sense_env.RxEnvelope', decode: () => arduino_nicla_sense_env.RxEnvelope.decode(rawData) },
    { name: 'ina226.RxEnvelope', decode: () => ina226.RxEnvelope.decode(rawData) },
    { name: 'airgradient_open_air_o_1pst.RxEnvelope', decode: () => airgradient_open_air_o_1pst.RxEnvelope.decode(rawData) },
    { name: 'yahboom_dogzilla_lite.InferenceState', decode: () => yahboom_dogzilla_lite.InferenceState.decode(rawData) },
    { name: 'st3215.InferenceState', decode: () => st3215.InferenceState.decode(rawData) },
    { name: 'normvla.Frame', decode: () => normvla.Frame.decode(rawData) },
  ];

  for (const { name, decode } of decoders) {
    try {
      const decoded = decode();
      if (decoded && typeof decoded === 'object') {
        return { decoded, typeName: name };
      }
    } catch {
      // Continue to next decoder
    }
  }
  return null;
}

function getDefaultTab(tabs: DataTab[]): DataTab {
  return tabs[0] ?? 'visual';
}

function getAvailableTabs(
  data: ExpandedViewProps['data'],
  type: ExpandedViewProps['type']
): DataTab[] {
  if (data instanceof Uint8Array) {
    return ['json', 'raw'];
  }

  const isUsbVideo = type === 'usbvideo' && data instanceof usbvideo.RxEnvelope;
  const isSt3215 = type === 'st3215' && data instanceof st3215.InferenceState;
  const isSt3215Tx = type === 'st3215tx' && data instanceof st3215.TxEnvelope;
  const isVescTrampaTx = type === 'vesc-trampa-tx' && data instanceof vesc_trampa.TxEnvelope;
  const isMirroring = type === 'mirroring' && data instanceof motors_mirroring.RxEnvelope;
  const isSysinfo = type === 'sysinfo' && data instanceof sysinfo.Envelope;
  const isArduinoNiclaSenseEnv = type === 'arduino-nicla-sense-env' && data instanceof arduino_nicla_sense_env.RxEnvelope;
  const isIna226 = type === 'ina226' && data instanceof ina226.RxEnvelope;
  const isAirGradient = type === 'airgradient-open-air-o-1pst' && data instanceof airgradient_open_air_o_1pst.RxEnvelope;
  const isYahboomDogzillaLite = type === 'yahboom_dogzilla_lite' && data instanceof yahboom_dogzilla_lite.InferenceState;
  const isNormvla = type === 'normvla' && data instanceof normvla.Frame;
  const isVescTrampa = type === 'vesc-trampa-rx' && data instanceof vesc_trampa.RxEnvelope;

  if (isUsbVideo || isSt3215 || isSt3215Tx || isMirroring || isVescTrampaTx || isSysinfo || isArduinoNiclaSenseEnv || isIna226 || isAirGradient || isYahboomDogzillaLite || isNormvla) {
    return ['visual', 'json', 'raw'];
  }

  if (isVescTrampa) {
    return ['json', 'raw'];
  }

  return ['json', 'raw'];
}

export default function ExpandedView({ data, type, rawData }: ExpandedViewProps) {
  const availableTabs = getAvailableTabs(data, type);
  const [userSelectedTab, setUserSelectedTab] = useState<DataTab | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<{ src: string; alt: string } | null>(null);

  const closeFullscreen = useCallback(() => setFullscreenImage(null), []);

  const normvlaImages = useMemo(() => {
    if (!(type === 'normvla' && data instanceof normvla.Frame) || !data.images || data.images.length === 0) {
      return [] as Array<{ idx: number; url: string }>;
    }

    return data.images
      .map((img: normvla.IImage, idx: number) => {
        const jpegData = img.jpeg;
        if (!jpegData || jpegData.length === 0) {
          return null;
        }

        try {
          const url = URL.createObjectURL(new Blob([new Uint8Array(jpegData)], { type: 'image/jpeg' }));
          return { idx, url };
        } catch {
          return null;
        }
      })
      .filter((image): image is { idx: number; url: string } => image !== null);
  }, [data, type]);

  useEffect(() => {
    return () => {
      normvlaImages.forEach((image) => {
        URL.revokeObjectURL(image.url);
      });
    };
  }, [normvlaImages]);
  
  const activeTab = useMemo(() => {
    if (userSelectedTab && availableTabs.includes(userSelectedTab)) {
      return userSelectedTab;
    }
    return getDefaultTab(availableTabs);
  }, [userSelectedTab, availableTabs]);

  const rawPayload = rawData ?? (data instanceof Uint8Array ? data : null);

  const renderVisual = () => {
    if (type === 'usbvideo' && data instanceof usbvideo.RxEnvelope) {
      return <UsbVideoExpanded data={data} onImageClick={(src, alt) => setFullscreenImage({ src, alt })} />;
    }
    if (type === 'yahboom_dogzilla_lite' && data instanceof yahboom_dogzilla_lite.InferenceState) {
      return <YahboomDogzillaLiteExpanded data={data} />;
    }
    if (type === 'st3215' && data instanceof st3215.InferenceState) {
      return <St3215Expanded data={data} />;
    }
    if (type === 'mirroring' && data instanceof motors_mirroring.RxEnvelope) {
      return <MirroringExpanded data={data} />;
    }
    if (type === 'sysinfo' && data instanceof sysinfo.Envelope) {
      return <SysinfoGrid data={data} />;
    }
    if (type === 'arduino-nicla-sense-env' && data instanceof arduino_nicla_sense_env.RxEnvelope) {
      return <ArduinoNiclaSenseEnvExpanded data={data} />;
    }
    if (type === 'ina226' && data instanceof ina226.RxEnvelope) {
      return <Ina226Expanded data={data} />;
    }
    if (type === 'airgradient-open-air-o-1pst' && data instanceof airgradient_open_air_o_1pst.RxEnvelope) {
      const values = readAirGradientValues(data.data);
      const cells: { label: string; value: number | null; unit: string }[] = [
        { label: 'PM1', value: values.pm1, unit: 'ug/m3' },
        { label: 'PM2.5', value: values.pm25, unit: 'ug/m3' },
        { label: 'PM10', value: values.pm10, unit: 'ug/m3' },
        { label: 'Temp', value: values.temperatureC, unit: 'C' },
        { label: 'Humidity', value: values.humidityPercent, unit: '%' },
        { label: 'CO2', value: values.co2Ppm, unit: 'ppm' },
        { label: 'VOC', value: values.vocIndex, unit: '' },
        { label: 'NOx', value: values.noxIndex, unit: '' },
      ];
      return (
        <div className="space-y-2">
          <div className="text-xs text-text-label">{airGradientDeviceLabel(data.device)}</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {cells.map((cell) => (
              <div key={cell.label} className="bg-surface-primary p-2 rounded">
                <div className="text-[10px] uppercase text-text-label">{cell.label}</div>
                <div className="font-mono text-sm text-accent-data">
                  {cell.value === null || !Number.isFinite(cell.value)
                    ? 'N/A'
                    : `${cell.value}${cell.unit ? ` ${cell.unit}` : ''}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }
    if (type === 'normvla' && data instanceof normvla.Frame) {
      return (
        <div className="space-y-2">
          <div className="flex gap-2 max-h-56">
            {data.joints && data.joints.length > 0 && (
              <div className="bg-surface-base rounded w-56 h-56 flex-shrink-0 overflow-hidden">
                <NormvlaRobotRenderer joints={data.joints} />
              </div>
            )}
            {data.images && data.images.length > 0 && (
              <div className="flex gap-2 overflow-x-auto">
                {normvlaImages.map((image) => (
                  <img
                    key={image.idx}
                    src={image.url}
                    alt={`Frame ${image.idx}`}
                    className="h-56 rounded border border-border-subtle flex-shrink-0 cursor-pointer hover:border-accent-info transition-colors"
                    onClick={() => setFullscreenImage({ src: image.url, alt: `Frame ${image.idx}` })}
                  />
                ))}
              </div>
            )}
          </div>
          {data.joints && data.joints.length > 0 && (
            <div className="text-xs text-text-label">
              Joints: {data.joints.length}
            </div>
          )}
        </div>
      );
    }
    if (type === 'st3215tx' && data instanceof st3215.TxEnvelope) {
      return (
        <div className="space-y-2">
          <div className="text-xs text-text-label">
            Bus: {data.targetBusSerial ?? 'N/A'}
          </div>
          {data.write && (
            <div className="bg-surface-primary p-2 rounded text-xs">
              <div className="text-accent-data mb-1">Write Command:</div>
              <div className="text-text-secondary">
                Motor: {data.write.motorId}, Addr: {data.write.address}, Value: {data.write.value?.length ?? 0} bytes
              </div>
            </div>
          )}
          {data.regWrite && (
            <div className="bg-surface-primary p-2 rounded text-xs">
              <div className="text-accent-secondary mb-1">RegWrite Command:</div>
              <div className="text-text-secondary">
                Motor: {data.regWrite.motorId}, Addr: {data.regWrite.address}, Value: {data.regWrite.value?.length ?? 0} bytes
              </div>
            </div>
          )}
          {data.action && (
            <div className="bg-surface-primary p-2 rounded text-xs text-accent-success">
              Action: Motor {data.action.motorId}
            </div>
          )}
        </div>
      );
    }
    if (type === 'vesc-trampa-tx' && data instanceof vesc_trampa.TxEnvelope) {
      return (
        <div className="space-y-2">
          <div className="text-xs text-text-label">
            UUID: {data.targetBoardUuid ? Array.from(data.targetBoardUuid).map((byte) => byte.toString(16).padStart(2, '0')).join('') : 'N/A'}
          </div>
          {data.boardCommand && (
            <div className="bg-surface-primary p-2 rounded text-xs">
              <div className="text-accent-data mb-1">Board Command:</div>
              <div className="text-text-secondary">
                Payload: {data.boardCommand.payload?.length ?? 0} bytes, Response: {data.boardCommand.responseExpected ? 'yes' : 'no'}
              </div>
            </div>
          )}
        </div>
      );
    }
    if (data instanceof Uint8Array) {
      return <RawBytesExpanded data={data} />;
    }
    return (
      <div className="bg-surface-primary p-2 rounded text-xs text-text-label">
        Unknown parsed data type
      </div>
    );
  };

  const renderJson = () => {
    if (type === 'usbvideo' && data instanceof usbvideo.RxEnvelope) {
      return (
        <div>
          <div className="text-xs text-text-label mb-1">USB Video RxEnvelope JSON (cropped data):</div>
          <div className="bg-surface-primary p-2 rounded text-xs font-mono text-accent-warning overflow-x-auto max-h-64 overflow-y-auto">
            <pre>{createCroppedJson(data)}</pre>
          </div>
        </div>
      );
    }
    if (type === 'yahboom_dogzilla_lite' && data instanceof yahboom_dogzilla_lite.InferenceState) {
      return (
        <div>
          <div className="text-xs text-text-label mb-1">YahboomDogzillaLite InferenceState JSON:</div>
          <div className="bg-surface-primary p-2 rounded text-xs font-mono text-accent-data overflow-x-auto max-h-64 overflow-y-auto">
            <pre>{JSON.stringify(yahboom_dogzilla_lite.InferenceState.toObject(data, {
              longs: String,
              enums: String,
              bytes: String,
              defaults: true
            }), null, 2)}</pre>
          </div>
        </div>
      );
    }
    if (type === 'st3215' && data instanceof st3215.InferenceState) {
      return <St3215JsonView data={data} />;
    }
    if (type === 'mirroring' && data instanceof motors_mirroring.RxEnvelope) {
      return (
        <div>
          <div className="text-xs text-text-label mb-1">Mirroring RxEnvelope JSON:</div>
          <div className="bg-surface-primary p-2 rounded text-xs font-mono text-accent-secondary overflow-x-auto max-h-64 overflow-y-auto">
            <pre>{JSON.stringify(data, null, 2)}</pre>
          </div>
        </div>
      );
    }
    if (type === 'sysinfo' && data instanceof sysinfo.Envelope) {
      return (
        <div>
          <div className="text-xs text-text-label mb-1">Sysinfo JSON:</div>
          <div className="bg-surface-primary p-2 rounded text-xs font-mono text-accent-data overflow-x-auto max-h-64 overflow-y-auto">
            <pre>{JSON.stringify(data, null, 2)}</pre>
          </div>
        </div>
      );
    }
    if (type === 'arduino-nicla-sense-env' && data instanceof arduino_nicla_sense_env.RxEnvelope) {
      const niclaData = arduino_nicla_sense_env.RxEnvelope.toObject(data, {
        longs: String,
        enums: String,
        bytes: String,
        defaults: true
      });

      return (
        <div>
          <div className="text-xs text-text-label mb-1">Arduino Nicla Sense Env RxEnvelope JSON:</div>
          <div className="bg-surface-primary p-2 rounded text-xs font-mono text-accent-data overflow-x-auto max-h-64 overflow-y-auto">
            <pre>{JSON.stringify(niclaData, null, 2)}</pre>
          </div>
        </div>
      );
    }
    if (type === 'ina226' && data instanceof ina226.RxEnvelope) {
      const ina226Data = ina226.RxEnvelope.toObject(data, {
        longs: String,
        enums: String,
        bytes: String,
        defaults: true
      });

      return (
        <div>
          <div className="text-xs text-text-label mb-1">INA226 RxEnvelope JSON:</div>
          <div className="bg-surface-primary p-2 rounded text-xs font-mono text-accent-data overflow-x-auto max-h-64 overflow-y-auto">
            <pre>{JSON.stringify(ina226Data, null, 2)}</pre>
          </div>
        </div>
      );
    }
    if (type === 'airgradient-open-air-o-1pst' && data instanceof airgradient_open_air_o_1pst.RxEnvelope) {
      const airgradientData = airgradient_open_air_o_1pst.RxEnvelope.toObject(data, {
        longs: String,
        enums: String,
        bytes: String,
        defaults: true
      });
      const view = { ...airgradientData, data: airGradientLineText(data.data) };

      return (
        <div>
          <div className="text-xs text-text-label mb-1">AirGradient Open Air O-1PST RxEnvelope JSON:</div>
          <div className="bg-surface-primary p-2 rounded text-xs font-mono text-accent-data overflow-x-auto max-h-64 overflow-y-auto">
            <pre>{JSON.stringify(view, null, 2)}</pre>
          </div>
        </div>
      );
    }
    if (type === 'normvla' && data instanceof normvla.Frame) {
      const croppedData = normvla.Frame.toObject(data, {
        longs: String,
        enums: String,
        bytes: String,
        defaults: true
      });
      if (croppedData.images && Array.isArray(croppedData.images)) {
        croppedData.images = croppedData.images.map((img: { jpeg?: string }) => {
          if (img.jpeg && typeof img.jpeg === 'string' && img.jpeg.length > 100) {
            return { ...img, jpeg: `[${img.jpeg.length} bytes] ${img.jpeg.substring(0, 50)}...` };
          }
          return img;
        });
      }
      return (
        <div>
          <div className="text-xs text-text-label mb-1">NormVLA Frame JSON:</div>
          <div className="bg-surface-primary p-2 rounded text-xs font-mono text-accent-danger overflow-x-auto max-h-64 overflow-y-auto">
            <pre>{JSON.stringify(croppedData, null, 2)}</pre>
          </div>
        </div>
      );
    }
    if (type === 'st3215tx' && data instanceof st3215.TxEnvelope) {
      return (
        <div>
          <div className="text-xs text-text-label mb-1">ST3215 TxEnvelope JSON:</div>
          <div className="bg-surface-primary p-2 rounded text-xs font-mono text-accent-data overflow-x-auto max-h-64 overflow-y-auto">
            <pre>{JSON.stringify(data, null, 2)}</pre>
          </div>
        </div>
      );
    }
    if (type === 'vesc-trampa-tx' && data instanceof vesc_trampa.TxEnvelope) {
      const txData = vesc_trampa.TxEnvelope.toObject(data, {
        longs: String,
        enums: String,
        bytes: String,
        defaults: true
      });

      return (
        <div>
          <div className="text-xs text-text-label mb-1">VESC Trampa TxEnvelope JSON:</div>
          <div className="bg-surface-primary p-2 rounded text-xs font-mono text-accent-data overflow-x-auto max-h-64 overflow-y-auto">
            <pre>{JSON.stringify(txData, null, 2)}</pre>
          </div>
        </div>
      );
    }
    if (type === 'vesc-trampa-rx' && data instanceof vesc_trampa.RxEnvelope) {
      const vescData = vesc_trampa.RxEnvelope.toObject(data, {
        longs: String,
        enums: String,
        bytes: String,
        defaults: true
      });

      return (
        <div>
          <div className="text-xs text-text-label mb-1">VESC Trampa RxEnvelope JSON:</div>
          <div className="bg-surface-primary p-2 rounded text-xs font-mono text-accent-data overflow-x-auto max-h-64 overflow-y-auto">
            <pre>{JSON.stringify(vescData, null, 2)}</pre>
          </div>
        </div>
      );
    }
    if (!(data instanceof Uint8Array)) {
      return (
        <div>
          <div className="text-xs text-text-label mb-1">JSON:</div>
          <div className="bg-surface-primary p-2 rounded text-xs font-mono text-text-secondary overflow-x-auto max-h-64 overflow-y-auto">
            <pre>{JSON.stringify(data, null, 2)}</pre>
          </div>
        </div>
      );
    }
    if (data instanceof Uint8Array) {
      const protoResult = tryDecodeProtobuf(data);
      if (protoResult) {
        return (
          <div>
            <div className="text-xs text-text-label mb-1">Decoded as {protoResult.typeName}:</div>
            <div className="bg-surface-primary p-2 rounded text-xs font-mono text-accent-warning overflow-x-auto max-h-64 overflow-y-auto">
              <pre>{JSON.stringify(protoResult.decoded, null, 2)}</pre>
            </div>
          </div>
        );
      }
      return (
        <div>
          <div className="text-xs text-text-label mb-1">Raw bytes JSON:</div>
          <div className="bg-surface-primary p-2 rounded text-xs font-mono text-accent-warning overflow-x-auto max-h-64 overflow-y-auto">
            <pre>{JSON.stringify({ bytes: Array.from(data), length: data.length }, null, 2)}</pre>
          </div>
        </div>
      );
    }
    return null;
  };

  const renderRaw = () => {
    if (rawPayload) {
      return <RawBytesExpanded data={rawPayload} />;
    }
    return (
      <div className="bg-surface-primary p-2 rounded text-xs text-text-label">
        Raw data not available for this entry.
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 border-b border-border-default">
        {TAB_OPTIONS.filter((tab) => availableTabs.includes(tab.id)).map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setUserSelectedTab(tab.id)}
              className={`text-xs px-2 py-1 rounded-t transition-all duration-150 border cursor-pointer select-none ${
                isActive
                  ? 'bg-surface-secondary text-text-primary border-border-default border-b-surface-secondary'
                  : 'text-text-label border-transparent hover:text-text-secondary hover:bg-surface-secondary/50 active:bg-surface-tertiary active:scale-95'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'visual' && renderVisual()}
      {activeTab === 'json' && renderJson()}
      {activeTab === 'raw' && renderRaw()}

      {fullscreenImage && (
        <FullscreenImageViewer
          src={fullscreenImage.src}
          alt={fullscreenImage.alt}
          onClose={closeFullscreen}
        />
      )}
    </div>
  );
}
