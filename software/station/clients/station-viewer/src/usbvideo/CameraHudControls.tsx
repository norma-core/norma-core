import { Maximize2, Minimize2, SlidersHorizontal } from 'lucide-react';
import CameraLayoutControls, { type CameraLayoutMode } from './CameraLayoutControls';

export type { CameraLayoutMode } from './CameraLayoutControls';

interface CameraHudControlsProps {
  cameraLayout: CameraLayoutMode;
  showMultiCameraControls?: boolean;
  hasMotors: boolean;
  showMotorData: boolean;
  isFullscreen: boolean;
  canSwapCameras: boolean;
  onCameraLayoutChange: (layout: CameraLayoutMode) => void;
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
  onCameraLayoutChange,
  onSwapCameras,
  onToggleMotorData,
  onToggleFullscreen,
}: CameraHudControlsProps) {
  return (
    <div className="absolute left-2 top-2 z-50 flex max-w-[calc(100%-1rem)] flex-wrap gap-1.5 rounded-lg border border-border-default bg-surface-primary/75 p-1.5 shadow-lg backdrop-blur-sm sm:left-3 sm:top-3">
      {showMultiCameraControls && (
        <CameraLayoutControls
          cameraLayout={cameraLayout}
          canSwapCameras={canSwapCameras}
          onCameraLayoutChange={onCameraLayoutChange}
          onSwapCameras={onSwapCameras}
        />
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
