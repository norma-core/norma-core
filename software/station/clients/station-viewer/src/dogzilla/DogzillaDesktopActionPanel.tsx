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
    <div className="rounded-lg border border-gray-700 bg-gray-900/90 p-2 backdrop-blur">
      <h3 className="border-b border-gray-700 pb-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-400">
        Actions
      </h3>
      <div className="mt-2 grid grid-cols-3 gap-1 text-[9px] text-gray-200">
        {ACTIONS.map((action) => {
          const isReset = action.value === dogzilla.ActionType.ACTION_RESTORE_DEFAULT;
          return (
            <button
              key={action.value}
              type="button"
              onClick={() => sendAction(action.value)}
              className={isReset
                ? 'rounded border border-blue-500/50 bg-blue-950/70 px-1.5 py-1 text-center text-blue-200 transition hover:border-blue-400 hover:text-blue-100'
                : 'rounded border border-gray-700 bg-gray-800/80 px-1.5 py-1 text-center transition hover:border-cyan-400/60 hover:text-cyan-200'
              }
            >
              {action.label}
            </button>
          );
        })}
      </div>
    </div>
  );
});

export default DogzillaDesktopActionPanel;
