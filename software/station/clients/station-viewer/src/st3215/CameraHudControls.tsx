import { ArrowLeftRight, Maximize2, Minimize2, SlidersHorizontal } from 'lucide-react';

type CameraLayoutMode = 'pip' | 'side-by-side' | 'stacked';

interface CameraHudControlsProps {
  cameraLayout: CameraLayoutMode;
  showMultiCameraControls?: boolean;
  hasMotors: boolean;
  showMotorData: boolean;
  isFullscreen: boolean;
  canSwapCameras: boolean;
  onSetPipLayout: () => void;
  onToggleSplitLayout: () => void;
  onSwapCameras: () => void;
  onToggleMotorData: () => void;
  onToggleFullscreen: () => void;
}

export default function CameraHudControls({
  cameraLayout,
  showMultiCameraControls = true,
  hasMotors,
  showMotorData,
  isFullscreen,
  canSwapCameras,
  onSetPipLayout,
  onToggleSplitLayout,
  onSwapCameras,
  onToggleMotorData,
  onToggleFullscreen,
}: CameraHudControlsProps) {
  return (
    <div className="absolute left-2 top-2 z-50 flex max-w-[calc(100%-1rem)] flex-wrap gap-1.5 rounded-lg border border-border-default bg-surface-primary/75 p-1.5 shadow-lg backdrop-blur-sm sm:left-3 sm:top-3">
      {showMultiCameraControls && (
        <>
          <div
            className="flex rounded-md border border-border-subtle bg-surface-primary p-0.5"
            role="group"
            aria-label="Camera layout"
          >
            <button
              type="button"
              onClick={onSetPipLayout}
              className={`flex h-8 w-8 items-center justify-center rounded transition-colors ${
                cameraLayout === 'pip'
                  ? 'bg-accent-data text-surface-base'
                  : 'text-text-muted hover:text-text-primary'
              }`}
              title="PiP layout"
              aria-label="PiP layout"
            >
              <span className="relative block h-4 w-4 rounded-[2px] border border-current">
                <span className="absolute -bottom-px -right-px h-2 w-2 rounded-[1px] border border-current bg-current/20" />
              </span>
            </button>
            <button
              type="button"
              onClick={onToggleSplitLayout}
              className={`flex h-8 w-8 items-center justify-center rounded transition-colors ${
                cameraLayout === 'side-by-side' || cameraLayout === 'stacked'
                  ? 'bg-accent-data text-surface-base'
                  : 'text-text-muted hover:text-text-primary'
              }`}
              title={cameraLayout === 'stacked' ? 'Top-bottom layout' : 'Side-by-side layout'}
              aria-label={cameraLayout === 'stacked' ? 'Top-bottom layout' : 'Side-by-side layout'}
            >
              <span className={`grid h-4 w-4 grid-cols-2 gap-[2px] ${cameraLayout === 'stacked' ? 'rotate-90' : ''}`}>
                <span className="rounded-[1px] border border-current" />
                <span className="rounded-[1px] border border-current" />
              </span>
            </button>
          </div>
          <button
            type="button"
            onClick={onSwapCameras}
            disabled={!canSwapCameras}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border-subtle bg-surface-primary text-text-muted transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
            title="Swap cameras"
            aria-label="Swap cameras"
          >
            <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </>
      )}
      {hasMotors && (
        <button
          type="button"
          onClick={onToggleMotorData}
          className={`flex h-9 w-9 items-center justify-center rounded-md border transition-colors ${
            showMotorData
              ? 'border-accent-success-deep bg-accent-success-bg text-text-primary'
              : 'border-border-subtle bg-surface-primary text-text-muted hover:text-text-primary'
          }`}
          title={showMotorData ? 'Hide motor panel' : 'Show motor panel'}
          aria-label={showMotorData ? 'Hide motor panel' : 'Show motor panel'}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        onClick={onToggleFullscreen}
        className={`flex h-9 w-9 items-center justify-center rounded-md border transition-colors ${
          isFullscreen
            ? 'border-accent-data bg-accent-data text-surface-base'
            : 'border-border-subtle bg-surface-primary text-text-muted hover:text-text-primary'
        }`}
        title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen camera view'}
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen camera view'}
      >
        {isFullscreen ? (
          <Minimize2 className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
