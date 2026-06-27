import { useState, useEffect, useCallback, useMemo } from 'react';
import Long from 'long';
import { Tag as TagIcon } from 'lucide-react';
import { useInferenceState, useConnectionStatsWithUptime, useLatestEntryId, useWakeLock, invalidateTagsCache } from "@/hooks";
import AsciiRobot from "@/components/AsciiRobot";
import TagDialog from "@/components/TagDialog";
import { copyToClipboard } from "@/api/clipboard-utils";
import { commandManager } from "@/api/commands";
import { inference_tags } from "@/api/proto.js";
import { defaultTag } from "@/utils/tag-phrases";
import { getFPSColor } from '@/utils/color-utils';
import DeviceLiveHost from '@/devices/DeviceLiveHost';
import { selectLiveDeviceViews } from '@/devices/registry';

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

function HomePage() {
  useWakeLock();
  const inferenceState = useInferenceState();
  const latestEntryId = useLatestEntryId();
  const connectionStats = useConnectionStatsWithUptime();
  const [copied, setCopied] = useState(false);
  const [tagDialog, setTagDialog] = useState<TagDialogState | null>(null);
  const [isTagSubmitting, setIsTagSubmitting] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);
  const liveDeviceViews = useMemo(
    () => selectLiveDeviceViews(inferenceState),
    [inferenceState],
  );
  const hasLiveDeviceViews = liveDeviceViews.length > 0;
  const hasFrameRateDevice = liveDeviceViews.some(({ view }) => view.tracksFrameRate);
  const isDesktopApp = window.stationDesktop?.isDesktop === true;

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
                {connectionStats.status === 'connected' && hasFrameRateDevice && (
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
          {hasLiveDeviceViews ? (
            <DeviceLiveHost views={liveDeviceViews} />
          ) : (
            <div className="flex flex-1 min-h-full w-full items-center justify-center rounded-lg border border-dashed border-border-default bg-surface-primary/40 px-6">
              <AsciiRobot />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default HomePage;
