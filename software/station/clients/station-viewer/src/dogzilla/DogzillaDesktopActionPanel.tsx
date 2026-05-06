import { memo } from 'react';
import { commandManager } from '@/api/commands.js';
import { dogzilla } from '@/api/proto.js';

interface DogzillaDesktopActionPanelProps {
  deviceSerial: string;
}

const ACTIONS = [
  { label: 'Lie Down', value: dogzilla.ActionType.ACTION_LIE_DOWN },
  { label: 'Stand Up', value: dogzilla.ActionType.ACTION_STAND_UP },
  { label: 'Crawl', value: dogzilla.ActionType.ACTION_CRAWL_FORWARD },
  { label: 'Turn', value: dogzilla.ActionType.ACTION_TURN_AROUND },
  { label: 'Squat', value: dogzilla.ActionType.ACTION_SQUAT },
  { label: 'Roll', value: dogzilla.ActionType.ACTION_ROLL },
  { label: 'Pitch', value: dogzilla.ActionType.ACTION_PITCH },
  { label: 'Yaw', value: dogzilla.ActionType.ACTION_YAW },
  { label: '3-Axis', value: dogzilla.ActionType.ACTION_THREE_AXIS_ROTATION },
  { label: 'Pee', value: dogzilla.ActionType.ACTION_PEE },
  { label: 'Sit', value: dogzilla.ActionType.ACTION_SIT_DOWN },
  { label: 'Wave', value: dogzilla.ActionType.ACTION_WAVE },
  { label: 'Stretch', value: dogzilla.ActionType.ACTION_STRETCH },
  { label: 'Wave 2', value: dogzilla.ActionType.ACTION_WAVE2 },
  { label: 'Sway', value: dogzilla.ActionType.ACTION_SWAY },
  { label: 'Beg', value: dogzilla.ActionType.ACTION_BEG_FOR_FOOD },
  { label: 'Find Food', value: dogzilla.ActionType.ACTION_FIND_FOOD },
  { label: 'Handshake', value: dogzilla.ActionType.ACTION_HANDSHAKE },
  { label: 'Arm Demo', value: dogzilla.ActionType.ACTION_ARM_DEMO },
  { label: 'Pushups', value: dogzilla.ActionType.ACTION_PUSHUPS },
  { label: 'Pitch/Yaw', value: dogzilla.ActionType.ACTION_PITCH_YAW_ROTATION },
  { label: 'Up/Down', value: dogzilla.ActionType.ACTION_UP_DOWN_ROTATION },
  { label: 'Fwd/Back', value: dogzilla.ActionType.ACTION_FORWARD_BACKWARD_ROTATION },
  { label: 'Reset', value: dogzilla.ActionType.ACTION_RESTORE_DEFAULT }
];

const DogzillaDesktopActionPanel = memo(function DogzillaDesktopActionPanel({
  deviceSerial
}: DogzillaDesktopActionPanelProps) {
  const sendAction = (action: dogzilla.ActionType) => {
    commandManager.sendDogzillaCommand({
      targetDeviceSerial: deviceSerial,
      action: { action }
    });
  };

  return (
    <div className="rounded-xl border border-border-default bg-surface-primary/80 p-3 backdrop-blur">
      <h3 className="flex min-h-6 items-center pb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-accent-data">
        Actions
      </h3>
      <div className="mt-1 grid grid-cols-4 gap-2 text-[9px] font-semibold uppercase tracking-[0.05em] text-text-primary">
        {ACTIONS.map((action) => {
          const isReset = action.value === dogzilla.ActionType.ACTION_RESTORE_DEFAULT;
          return (
            <button
              key={action.value}
              type="button"
              onClick={() => sendAction(action.value)}
              className={`min-h-14 w-full rounded px-1.5 py-2 text-center transition-colors active:bg-surface-active ${isReset
                ? 'bg-accent-info-bg text-text-primary hover:bg-accent-info-deep'
                : 'bg-surface-tertiary text-text-primary hover:bg-surface-elevated'
              }`}
            >
              <span className="flex h-full items-center justify-center whitespace-normal text-center leading-tight">
                {action.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
});

export default DogzillaDesktopActionPanel;
