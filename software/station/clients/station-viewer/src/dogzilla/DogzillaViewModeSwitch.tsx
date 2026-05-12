import { Camera, Maximize2 } from 'lucide-react';

export type DogzillaViewMode = '3d' | 'photo' | 'fullscreenVideo';

interface DogzillaViewModeSwitchProps {
  value: DogzillaViewMode;
  onChange: (value: DogzillaViewMode) => void;
  photoDisabled?: boolean;
}

const BUTTON_CLASS_NAME = 'inline-flex h-6 min-w-8 items-center justify-center rounded px-2 text-xs font-bold transition-colors';

export default function DogzillaViewModeSwitch({
  value,
  onChange,
  photoDisabled = false
}: DogzillaViewModeSwitchProps) {
  const buttonClassName = (mode: DogzillaViewMode) => (
    `${BUTTON_CLASS_NAME} ${
      value === mode
        ? 'bg-accent-success-deep text-text-primary'
        : 'text-text-muted hover:bg-surface-elevated hover:text-text-primary'
    }`
  );

  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border-default bg-surface-secondary p-0.5">
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
        title="Photo"
        aria-label="Photo"
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
