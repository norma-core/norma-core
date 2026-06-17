import { memo } from 'react';
import { commandManager } from '@/api/commands.js';
import { yahboom_dogzilla_lite } from '@/api/proto.js';

interface YahboomDogzillaLiteDesktopActionPanelProps {
  deviceSerial: string;
}

const ACTIONS = [
  { label: 'Lie Down', value: yahboom_dogzilla_lite.ActionType.ACTION_LIE_DOWN },
  { label: 'Stand Up', value: yahboom_dogzilla_lite.ActionType.ACTION_STAND_UP },
  { label: 'Crawl', value: yahboom_dogzilla_lite.ActionType.ACTION_CRAWL_FORWARD },
  { label: 'Turn', value: yahboom_dogzilla_lite.ActionType.ACTION_TURN_AROUND },
  { label: 'Squat', value: yahboom_dogzilla_lite.ActionType.ACTION_SQUAT },
  { label: 'Roll', value: yahboom_dogzilla_lite.ActionType.ACTION_ROLL },
  { label: 'Pitch', value: yahboom_dogzilla_lite.ActionType.ACTION_PITCH },
  { label: 'Yaw', value: yahboom_dogzilla_lite.ActionType.ACTION_YAW },
  { label: '3-Axis', value: yahboom_dogzilla_lite.ActionType.ACTION_THREE_AXIS_ROTATION },
  { label: 'Pee', value: yahboom_dogzilla_lite.ActionType.ACTION_PEE },
  { label: 'Sit', value: yahboom_dogzilla_lite.ActionType.ACTION_SIT_DOWN },
  { label: 'Wave', value: yahboom_dogzilla_lite.ActionType.ACTION_WAVE },
  { label: 'Stretch', value: yahboom_dogzilla_lite.ActionType.ACTION_STRETCH },
  { label: 'Wave 2', value: yahboom_dogzilla_lite.ActionType.ACTION_WAVE2 },
  { label: 'Sway', value: yahboom_dogzilla_lite.ActionType.ACTION_SWAY },
  { label: 'Beg', value: yahboom_dogzilla_lite.ActionType.ACTION_BEG_FOR_FOOD },
  { label: 'Find Food', value: yahboom_dogzilla_lite.ActionType.ACTION_FIND_FOOD },
  { label: 'Handshake', value: yahboom_dogzilla_lite.ActionType.ACTION_HANDSHAKE },
  { label: 'Arm Demo', value: yahboom_dogzilla_lite.ActionType.ACTION_ARM_DEMO },
  { label: 'Pushups', value: yahboom_dogzilla_lite.ActionType.ACTION_PUSHUPS },
  { label: 'Pitch/Yaw', value: yahboom_dogzilla_lite.ActionType.ACTION_PITCH_YAW_ROTATION },
  { label: 'Up/Down', value: yahboom_dogzilla_lite.ActionType.ACTION_UP_DOWN_ROTATION },
  { label: 'Fwd/Back', value: yahboom_dogzilla_lite.ActionType.ACTION_FORWARD_BACKWARD_ROTATION },
  { label: 'Reset', value: yahboom_dogzilla_lite.ActionType.ACTION_RESTORE_DEFAULT }
];

const YahboomDogzillaLiteDesktopActionPanel = memo(function YahboomDogzillaLiteDesktopActionPanel({
  deviceSerial
}: YahboomDogzillaLiteDesktopActionPanelProps) {
  const sendAction = (action: yahboom_dogzilla_lite.ActionType) => {
    commandManager.sendYahboomDogzillaLiteCommand({
      targetDeviceSerial: deviceSerial,
      action: { action }
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-border-default bg-surface-primary/72 p-3 backdrop-blur">
      <h3 className="flex min-h-6 items-center pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent-data">
        Actions
      </h3>
      <div className="mt-1 grid min-h-0 flex-1 grid-cols-4 gap-2 text-[10px] font-semibold text-text-primary">
        {ACTIONS.map((action) => {
          const isReset = action.value === yahboom_dogzilla_lite.ActionType.ACTION_RESTORE_DEFAULT;
          return (
            <button
              key={action.value}
              type="button"
              onClick={() => sendAction(action.value)}
              className={`min-h-12 w-full rounded-md border px-1.5 py-2 text-center transition-colors active:bg-surface-active ${isReset
                ? 'border-accent-critical-deep bg-accent-critical/12 text-accent-critical hover:bg-accent-critical/20'
                : 'border-border-default bg-surface-tertiary/78 text-text-primary hover:border-border-subtle hover:bg-surface-elevated'
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

export default YahboomDogzillaLiteDesktopActionPanel;
