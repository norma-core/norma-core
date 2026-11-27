import { useId } from 'react';
import { ArrowLeftRight } from 'lucide-react';

export type CameraLayoutMode = 'pip' | 'side-by-side' | 'stacked';

interface CameraLayoutControlsProps {
  cameraLayout: CameraLayoutMode;
  canSwapCameras: boolean;
  onCameraLayoutChange: (layout: CameraLayoutMode) => void;
  onSwapCameras: () => void;
}

export default function CameraLayoutControls({
  cameraLayout,
  canSwapCameras,
  onCameraLayoutChange,
  onSwapCameras,
}: CameraLayoutControlsProps) {
  const splitDescriptionId = useId();
  const splitActive = cameraLayout !== 'pip';
  const nextSplitLayout: CameraLayoutMode = cameraLayout === 'side-by-side'
    ? 'stacked'
    : 'side-by-side';
  const splitDirection = cameraLayout === 'stacked' ? 'top and bottom' : 'side by side';

  return (
    <>
      <div
        className="flex rounded-md border border-border-subtle bg-surface-primary p-0.5"
        role="group"
        aria-label="Camera layout"
      >
        <button
          type="button"
          onClick={() => onCameraLayoutChange('pip')}
          className={`flex h-8 w-8 items-center justify-center rounded transition-colors ${
            cameraLayout === 'pip'
              ? 'bg-accent-data text-surface-base'
              : 'text-text-muted hover:text-text-primary'
          }`}
          title="PiP layout"
          aria-label="PiP layout"
          aria-pressed={cameraLayout === 'pip'}
        >
          <span className="relative block h-4 w-4 rounded-[2px] border border-current">
            <span className="absolute -bottom-px -right-px h-2 w-2 rounded-[1px] border border-current bg-current/20" />
          </span>
        </button>
        <button
          type="button"
          onClick={() => onCameraLayoutChange(nextSplitLayout)}
          className={`flex h-8 w-8 items-center justify-center rounded transition-colors ${
            splitActive
              ? 'bg-accent-data text-surface-base'
              : 'text-text-muted hover:text-text-primary'
          }`}
          title={cameraLayout === 'stacked' ? 'Top-bottom layout' : 'Side-by-side layout'}
          aria-label="Split layout"
          aria-describedby={splitDescriptionId}
          aria-pressed={splitActive}
        >
          <span className={`grid h-4 w-4 grid-cols-2 gap-[2px] ${cameraLayout === 'stacked' ? 'rotate-90' : ''}`}>
            <span className="rounded-[1px] border border-current" />
            <span className="rounded-[1px] border border-current" />
          </span>
        </button>
        <span id={splitDescriptionId} className="sr-only">
          {splitActive
            ? `Split layout active, ${splitDirection}`
            : `Split layout inactive, next split is ${splitDirection}`}
        </span>
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
  );
}
