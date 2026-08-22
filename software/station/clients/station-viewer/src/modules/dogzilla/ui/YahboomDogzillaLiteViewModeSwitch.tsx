import { Camera, Maximize2 } from 'lucide-react';

export type YahboomDogzillaLiteViewMode = '3d' | 'photo' | 'fullscreenVideo';

interface YahboomDogzillaLiteViewModeSwitchProps {
  value: YahboomDogzillaLiteViewMode;
  onChange: (value: YahboomDogzillaLiteViewMode) => void;
  photoDisabled?: boolean;
}

const BUTTON_CLASS_NAME = 'inline-flex h-8 min-w-9 items-center justify-center rounded-md px-2.5 text-xs font-bold transition-colors';

export default function YahboomDogzillaLiteViewModeSwitch({
  value,
  onChange,
  photoDisabled = false
}: YahboomDogzillaLiteViewModeSwitchProps) {
  const buttonClassName = (mode: YahboomDogzillaLiteViewMode) => (
    `${BUTTON_CLASS_NAME} ${
      value === mode
        ? 'bg-accent-success-deep text-text-primary'
        : 'text-text-muted hover:bg-surface-elevated hover:text-text-primary'
    }`
  );

  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-border-default bg-surface-secondary p-0.5">
      <button
        type="button"
        onClick={() => onChange('3d')}
        className={buttonClassName('3d')}
      >
        3D
      </button>
      <button
        type="button"
        disabled={photoDisabled}
        onClick={() => onChange('photo')}
        className={`${buttonClassName('photo')} disabled:cursor-not-allowed disabled:opacity-40`}
        title="Camera"
        aria-label="Camera"
      >
        <Camera className="h-3.5 w-3.5" strokeWidth={2.5} />
      </button>
      <button
        type="button"
        disabled={photoDisabled}
        onClick={() => onChange('fullscreenVideo')}
        className={`${buttonClassName('fullscreenVideo')} disabled:cursor-not-allowed disabled:opacity-40`}
        title="Fullscreen video"
        aria-label="Fullscreen video"
      >
        <Maximize2 className="h-3.5 w-3.5" strokeWidth={2.5} />
      </button>
    </div>
  );
}
