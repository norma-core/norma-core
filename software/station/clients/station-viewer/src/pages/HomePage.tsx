import { useState, useEffect, useCallback, type ReactNode } from 'react';
import Long from 'long';
import { Tag as TagIcon } from 'lucide-react';
import { useInferenceState, useConnectionStatsWithUptime, useLatestEntryId, useWakeLock, invalidateTagsCache } from "@/hooks";
import BusViewer from "@/st3215/BusViewer";
import VescTrampaViewer from "@/vesc-trampa/VescTrampaViewer";
import YahboomDogzillaLiteDeviceViewer from "@/yahboom_dogzilla_lite/YahboomDogzillaLiteDeviceViewer";
import AsciiRobot from "@/components/AsciiRobot";
import TagDialog from "@/components/TagDialog";
import { copyToClipboard } from "@/api/clipboard-utils";
import { commandManager } from "@/api/commands";
import { airgradient_open_air_o_1pst, arduino_nicla_sense_env, ina226, inference_tags } from "@/api/proto.js";
import { readArduinoNiclaSenseEnvMainValues } from "@/utils/arduino-nicla-sense-env";
import { airGradientDeviceLabel, readAirGradientValues } from "@/utils/airgradient-open-air-o-1pst";
import { defaultTag } from "@/utils/tag-phrases";
import { getFPSColor } from '@/utils/color-utils';
import {
  formatIna226Current,
  readIna226CurrentAmps,
  readIna226ShuntMillivolts,
} from '@/utils/ina226';

interface TagDialogState {
  entryId: number | null;
  defaultValue: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function formatUptime(connectedAt: number | null): string {
  if (!connectedAt) return 'N/A';
  const seconds = Math.floor((Date.now() - connectedAt) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatMeasured(value: number | null, unit: string, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return 'N/A';
  }
  return `${value.toFixed(decimals)} ${unit}`;
}

function formatDecimal(value: number | null, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return 'N/A';
  }
  return value.toFixed(decimals);
}

function formatSignedDecimal(value: number | null, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return 'N/A';
  }
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}`;
}

function formatSignedMeasured(value: number | null, unit: string, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return 'N/A';
  }
  return `${formatSignedDecimal(value, decimals)} ${unit}`;
}

function formatInteger(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'N/A' : value.toLocaleString();
}

function hexByte(value: number | null | undefined): string {
  if (value === undefined || value === null) {
    return 'N/A';
  }
  return `0x${value.toString(16).toUpperCase().padStart(2, '0')}`;
}

function i2cDeviceLabel(device: { id?: string | null; i2cBus?: number | null; i2cAddress?: number | null } | null | undefined): string {
  if (!device) {
    return 'N/A';
  }
  if (device.id) {
    return device.id;
  }
  return `bus ${device.i2cBus ?? 'N/A'} / ${hexByte(device.i2cAddress)}`;
}

function WidgetShell({
  title,
  subtitle,
  error,
  children,
}: {
  title: string;
  subtitle: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 w-full max-w-[24rem] justify-self-start rounded-md border border-border-default bg-surface-secondary px-3 py-2 shadow-sm">
      <div className="mb-2 flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-text-primary" title={title}>{title}</div>
          <div className="truncate font-mono text-[11px] text-text-muted" title={subtitle}>{subtitle}</div>
        </div>
        {error && (
          <span className="rounded border border-accent-critical px-1.5 py-0.5 text-[10px] font-semibold uppercase text-accent-critical">
            Error
          </span>
        )}
      </div>
      {children}
      {error && (
        <div className="mt-2 truncate rounded bg-surface-primary px-2 py-1 text-xs text-accent-critical" title={error}>
          {error}
        </div>
      )}
    </section>
  );
}

function WidgetPill({
  label,
  value,
  tone = 'text-accent-data',
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0 rounded bg-surface-primary/70 px-2 py-1">
      <span className="mr-1 text-[10px] uppercase text-text-label">{label}</span>
      <span className={`font-mono text-xs font-semibold ${tone}`} title={value}>
        {value}
      </span>
    </div>
  );
}

function ArduinoNiclaSenseEnvHomePanel({ data }: { data: arduino_nicla_sense_env.IRxEnvelope }) {
  const values = readArduinoNiclaSenseEnvMainValues(data.data);
  return (
    <WidgetShell
      title={i2cDeviceLabel(data.device)}
      subtitle="Arduino Sense Env"
      error={data.error}
    >
      <div className="flex items-end gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase text-text-label">Temperature</div>
          <div className="font-mono text-2xl font-semibold leading-none text-accent-danger">
            {formatDecimal(values.temperatureC, 1)}
            <span className="ml-1 text-sm text-text-muted">C</span>
          </div>
        </div>
        <div className="ml-auto min-w-0 text-right">
          <div className="text-[10px] uppercase text-text-label">Humidity</div>
          <div className="font-mono text-lg font-semibold leading-none text-accent-info">
            {formatDecimal(values.humidityPercent, 0)}
            <span className="ml-1 text-xs text-text-muted">%</span>
          </div>
        </div>
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
        <WidgetPill label="AQI" value={formatInteger(values.epaAqi)} tone="text-accent-warning" />
        <WidgetPill label="eCO2" value={formatMeasured(values.eco2Ppm, 'ppm', 0)} tone="text-accent-success" />
      </div>
    </WidgetShell>
  );
}

function Ina226HomePanel({ data }: { data: ina226.IRxEnvelope }) {
  const shuntResistanceOhms = data.device?.info?.shuntResistanceOhms || null;
  const currentAmps = readIna226CurrentAmps(data.data, shuntResistanceOhms);
  const shuntMv = readIna226ShuntMillivolts(data.data);
  const currentDisplay = formatIna226Current(currentAmps);
  const primaryValue = currentAmps === null
    ? formatSignedDecimal(shuntMv, 4)
    : currentDisplay.value;
  const primaryUnit = currentAmps === null ? 'mV' : currentDisplay.unit;
  const primaryLabel = currentAmps === null ? 'Shunt' : 'Current';
  const primaryToneValue = currentAmps ?? shuntMv;

  return (
    <WidgetShell
      title={i2cDeviceLabel(data.device)}
      subtitle="INA226 Shunt Voltages"
      error={data.error}
    >
      <div className="flex items-end gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase text-text-label">{primaryLabel}</div>
          <div className={`font-mono text-2xl font-semibold leading-none ${
            primaryToneValue === null
              ? 'text-text-muted'
              : primaryToneValue < 0
                ? 'text-accent-warning'
                : primaryToneValue > 0
                  ? 'text-accent-success'
                  : 'text-text-secondary'
          }`}>
            {primaryValue}
            <span className="ml-1 text-sm text-text-muted">{primaryUnit}</span>
          </div>
        </div>
      </div>
      {currentAmps !== null && (
        <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
          <WidgetPill label="Shunt" value={formatSignedMeasured(shuntMv, 'mV', 4)} tone="text-accent-data" />
          <WidgetPill label="R" value={formatMeasured(shuntResistanceOhms, 'ohm', 4)} tone="text-accent-secondary" />
        </div>
      )}
    </WidgetShell>
  );
}

function AirGradientHomePanel({ data }: { data: airgradient_open_air_o_1pst.IRxEnvelope }) {
  const values = readAirGradientValues(data.data);
  return (
    <WidgetShell
      title={airGradientDeviceLabel(data.device)}
      subtitle="AirGradient Open Air O-1PST"
      error={data.error}
    >
      <div className="flex items-end gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase text-text-label">PM2.5</div>
          <div className="font-mono text-2xl font-semibold leading-none text-accent-warning">
            {formatInteger(values.pm25)}
            <span className="ml-1 text-sm text-text-muted">ug/m3</span>
          </div>
        </div>
        <div className="ml-auto min-w-0 text-right">
          <div className="text-[10px] uppercase text-text-label">CO2</div>
          <div className="font-mono text-lg font-semibold leading-none text-accent-success">
            {formatInteger(values.co2Ppm)}
            <span className="ml-1 text-xs text-text-muted">ppm</span>
          </div>
        </div>
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
        <WidgetPill label="Temp" value={formatMeasured(values.temperatureC, 'C', 1)} tone="text-accent-danger" />
        <WidgetPill label="Humidity" value={formatMeasured(values.humidityPercent, '%', 0)} tone="text-accent-info" />
        <WidgetPill label="PM10" value={formatMeasured(values.pm10, 'ug/m3', 0)} tone="text-accent-data" />
        <WidgetPill label="VOC" value={formatInteger(values.vocIndex)} tone="text-accent-secondary" />
        <WidgetPill label="NOx" value={formatInteger(values.noxIndex)} tone="text-accent-secondary" />
      </div>
    </WidgetShell>
  );
}

function HomePage() {
  useWakeLock();
  const inferenceState = useInferenceState();
  const latestEntryId = useLatestEntryId();
  const connectionStats = useConnectionStatsWithUptime();
  const [copied, setCopied] = useState(false);
  const [tagDialog, setTagDialog] = useState<TagDialogState | null>(null);
  const [isTagSubmitting, setIsTagSubmitting] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);
  const hasSt3215Data = Boolean(inferenceState?.st3215?.data?.buses?.length);
  const hasVescTrampaData = Boolean(inferenceState?.vescTrampa?.data?.boards?.length);
  const hasRobotData = hasSt3215Data || hasVescTrampaData;
  const isDesktopApp = window.stationDesktop?.isDesktop === true;
  const hasYahboomDogzillaLiteData = Boolean(inferenceState?.yahboom_dogzilla_lite?.data?.devices?.length);
  const hasArduinoNiclaSenseEnvData = Boolean(inferenceState?.arduinoNiclaSenseEnv?.data);
  const hasIna226Data = Boolean(inferenceState?.ina226?.length);
  const hasAirGradientData = Boolean(inferenceState?.airgradientOpenAir?.data);
  const hasSensorData = hasArduinoNiclaSenseEnvData || hasIna226Data || hasAirGradientData;

  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 1000);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  const handleCopyEntryId = () => {
    if (latestEntryId !== null) {
      copyToClipboard(latestEntryId.toString())
        .then(() => setCopied(true))
        .catch(err => console.error('Failed to copy entry ID:', err));
    }
  };

  const handleAddTag = useCallback(() => {
    setTagDialog({
      entryId: latestEntryId,
      defaultValue: defaultTag(),
    });
    setTagError(null);
  }, [latestEntryId]);

  const handleCloseTagDialog = useCallback(() => {
    if (isTagSubmitting) return;
    setTagDialog(null);
    setTagError(null);
  }, [isTagSubmitting]);

  const handleSubmitTag = useCallback(async (tag: string) => {
    if (tagDialog === null || isTagSubmitting) return;
    if (tagDialog.entryId === null) {
      setTagError('No inference pointer available');
      return;
    }

    const ptrBytes = new Uint8Array(Long.fromNumber(tagDialog.entryId).toBytesLE());
    setIsTagSubmitting(true);
    setTagError(null);

    try {
      await commandManager.sendInferenceTagCommand({
        type: inference_tags.CommandType.CT_ADD_TAG,
        tag,
        inferenceQueuePtr: ptrBytes,
      });
      invalidateTagsCache();
      setTagDialog(null);
    } catch (err) {
      console.error('Failed to send tag command:', err);
      setTagError('Failed to save tag');
    } finally {
      setIsTagSubmitting(false);
    }
  }, [isTagSubmitting, tagDialog]);

  return (
    <div className="flex-1 flex flex-col">
      <div className="relative z-20 bg-surface-primary border-b-2 border-border-default">
        <div className="px-4 py-2 flex flex-wrap gap-x-4 gap-y-2 items-center">
          {connectionStats && (
            <>
              <div className="flex items-center gap-2">
                {!isDesktopApp && (
                  <div className="flex items-center gap-2 px-2 py-1 bg-surface-secondary rounded border border-border-default">
                    <span className="hidden sm:inline text-text-label text-xs uppercase tracking-wide">Status</span>
                    <span className="hidden sm:inline font-semibold uppercase text-xs text-text-label">
                      {connectionStats.status}
                    </span>
                    <span className={`sm:hidden inline-flex items-center justify-center w-4 h-4 rounded-full ${
                      connectionStats.status === 'connected' ? 'bg-accent-success' :
                      connectionStats.status === 'connecting' ? 'bg-accent-warning' :
                      'bg-accent-critical'
                    }`} aria-label={connectionStats.status}></span>
                  </div>
                )}
                {connectionStats.status === 'connected' && hasRobotData && (
                  <div className="hidden sm:flex items-center gap-2 px-2 py-1 bg-surface-secondary rounded border border-border-default">
                    <span className="text-text-label text-xs uppercase tracking-wide">FPS</span>
                    <span className={`font-bold text-xs font-mono ${connectionStats.isFpsReady ? getFPSColor(connectionStats.fps) : 'text-text-label'}`}>
                      {connectionStats.isFpsReady ? `${connectionStats.fps.toFixed(1)} Hz` : '--'}
                    </span>
                  </div>
                )}
                <div className="group relative flex items-center gap-2 px-2 py-1 bg-surface-secondary rounded border border-border-default cursor-pointer" onClick={handleCopyEntryId}>
                  <span className="text-text-label text-xs uppercase tracking-wide">Entry ID</span>
                  <span className={`font-bold text-xs font-mono ${copied ? 'text-accent-success' : 'text-accent-warning'}`}>
                    {latestEntryId?.toLocaleString() ?? 'N/A'}
                  </span>
                  <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 px-2 py-1 bg-surface-base text-text-primary text-xs rounded whitespace-nowrap z-50 invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity duration-200">
                    Click to copy
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleAddTag}
                  className="inline-flex h-7 cursor-pointer items-center gap-1.5 px-3 py-1 bg-accent-secondary-bg hover:bg-accent-secondary-deep disabled:bg-surface-elevated disabled:text-text-muted disabled:cursor-not-allowed text-text-primary text-xs font-bold uppercase tracking-wide rounded border border-accent-secondary"
                  title="Tag the current inference queue pointer"
                  aria-label="Tag the current inference queue pointer"
                >
                  <TagIcon size={13} aria-hidden />
                  <span>TAG</span>
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono">
                <div className="flex items-center gap-1.5">
                  <span className="text-text-muted">Endpoint:</span>
                  <span className="text-accent-data">{connectionStats.endpoint}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-text-muted">Packets:</span>
                  <span className="text-accent-info font-semibold">{connectionStats.packetsReceived.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-text-muted">Data:</span>
                  <span className="text-accent-secondary font-semibold">{formatBytes(connectionStats.bytesReceived)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-text-muted">Uptime:</span>
                  <span className="text-accent-success font-semibold">{formatUptime(connectionStats.connectedAt)}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      {tagDialog && (
        <TagDialog
          entryId={tagDialog.entryId}
          defaultValue={tagDialog.defaultValue}
          error={tagError}
          isSubmitting={isTagSubmitting}
          onClose={handleCloseTagDialog}
          onSubmit={handleSubmitTag}
        />
      )}
      <div className="flex-1 min-h-0 overflow-auto p-4">
        <div className="flex min-h-full w-full flex-col gap-4">
          {hasSensorData && (
            <div className="grid grid-cols-1 gap-2 xl:grid-cols-2 2xl:grid-cols-4">
              {inferenceState?.arduinoNiclaSenseEnv?.data && (
                <ArduinoNiclaSenseEnvHomePanel data={inferenceState.arduinoNiclaSenseEnv.data} />
              )}
              {inferenceState?.ina226?.map((entry) => (
                <Ina226HomePanel key={entry.queueId} data={entry.data} />
              ))}
              {inferenceState?.airgradientOpenAir?.data && (
                <AirGradientHomePanel data={inferenceState.airgradientOpenAir.data} />
              )}
            </div>
          )}
          {hasYahboomDogzillaLiteData && inferenceState?.yahboom_dogzilla_lite?.data && (
            <YahboomDogzillaLiteDeviceViewer
              inferenceState={inferenceState.yahboom_dogzilla_lite.data}
              videoSources={inferenceState.videoQueues}
            />
          )}
          {hasRobotData && inferenceState?.st3215?.data && (
            <BusViewer
              inferenceState={inferenceState.st3215.data}
              videoSources={inferenceState.videoQueues}
              mirroringState={inferenceState.mirroring?.data.state || undefined}
            />
          )}
          {!hasYahboomDogzillaLiteData && !hasRobotData && !hasVescTrampaData && !hasSensorData && (
          <div className="flex flex-1 min-h-full w-full items-center justify-center rounded-lg border border-dashed border-border-default bg-surface-primary/40 px-6">
            <AsciiRobot />
          </div>
          )}
          {hasVescTrampaData && (
              <VescTrampaViewer inferenceState={inferenceState!.vescTrampa!.data} />
          )}
        </div>
      </div>
    </div>
  );
}

export default HomePage;
