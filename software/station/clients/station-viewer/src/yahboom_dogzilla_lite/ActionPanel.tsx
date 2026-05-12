import { memo } from 'react';
import { yahboom_dogzilla_lite } from '@/api/proto.js';

export interface ActionDefinition {
  label: string;
  value: yahboom_dogzilla_lite.ActionType;
}

export interface ActionGroup {
  title: string;
  actions: ActionDefinition[];
}

export const QUICK_ACTIONS: ActionDefinition[] = [
  { label: 'Stand', value: yahboom_dogzilla_lite.ActionType.ACTION_STAND_UP },
  { label: 'Sit', value: yahboom_dogzilla_lite.ActionType.ACTION_SIT_DOWN },
  { label: 'Crawl', value: yahboom_dogzilla_lite.ActionType.ACTION_CRAWL_FORWARD },
  { label: 'Reset', value: yahboom_dogzilla_lite.ActionType.ACTION_RESTORE_DEFAULT }
];

export const ACTION_GROUPS: ActionGroup[] = [
  {
    title: 'Pose',
    actions: [
      { label: 'Lie Down', value: yahboom_dogzilla_lite.ActionType.ACTION_LIE_DOWN },
      { label: 'Stand Up', value: yahboom_dogzilla_lite.ActionType.ACTION_STAND_UP },
      { label: 'Sit', value: yahboom_dogzilla_lite.ActionType.ACTION_SIT_DOWN },
      { label: 'Squat', value: yahboom_dogzilla_lite.ActionType.ACTION_SQUAT }
    ]
  },
  {
    title: 'Movement',
    actions: [
      { label: 'Crawl', value: yahboom_dogzilla_lite.ActionType.ACTION_CRAWL_FORWARD },
      { label: 'Turn', value: yahboom_dogzilla_lite.ActionType.ACTION_TURN_AROUND },
      { label: 'Roll', value: yahboom_dogzilla_lite.ActionType.ACTION_ROLL },
      { label: 'Pitch', value: yahboom_dogzilla_lite.ActionType.ACTION_PITCH },
      { label: 'Yaw', value: yahboom_dogzilla_lite.ActionType.ACTION_YAW }
    ]
  },
  {
    title: 'Tricks',
    actions: [
      { label: 'Wave', value: yahboom_dogzilla_lite.ActionType.ACTION_WAVE },
      { label: 'Beg', value: yahboom_dogzilla_lite.ActionType.ACTION_BEG_FOR_FOOD },
      { label: 'Pee', value: yahboom_dogzilla_lite.ActionType.ACTION_PEE },
      { label: 'Pushups', value: yahboom_dogzilla_lite.ActionType.ACTION_PUSHUPS },
      { label: 'Handshake', value: yahboom_dogzilla_lite.ActionType.ACTION_HANDSHAKE }
    ]
  }
];

interface ActionPanelProps {
  activeAction: yahboom_dogzilla_lite.ActionType | null;
  onActionSelect: (action: ActionDefinition) => void;
}

const ActionPanel = memo(function ActionPanel({ activeAction, onActionSelect }: ActionPanelProps) {
  return (
    <div className="space-y-4">
      {ACTION_GROUPS.map((group) => (
        <section key={group.title} className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-cyan-400">
              {group.title}
            </h3>
            <div className="h-px flex-1 bg-gray-700" />
          </div>
          <div className="grid grid-cols-2 gap-2 2xl:grid-cols-3">
            {group.actions.map((action) => {
              const isActive = activeAction === action.value;
              return (
                <button
                  key={action.value}
                  type="button"
                  onClick={() => onActionSelect(action)}
                  className={`min-h-14 rounded-md border px-3 py-3 text-left text-sm font-medium transition ${
                    isActive
                      ? 'border-cyan-500 bg-gray-800 text-cyan-300'
                      : 'border-gray-700 bg-gray-900/80 text-gray-100 hover:border-cyan-700 hover:text-cyan-300'
                  }`}
                >
                  {action.label}
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <section className="space-y-2 border-t border-gray-700 pt-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-red-400">
          Reset
        </h3>
        <button
          type="button"
          onClick={() => onActionSelect(QUICK_ACTIONS[3])}
          className={`w-full rounded-md border px-4 py-4 text-left text-sm font-semibold transition ${
            activeAction === QUICK_ACTIONS[3].value
              ? 'border-red-700 bg-red-950 text-red-300'
              : 'border-red-900 bg-red-950/50 text-red-300 hover:border-red-700 hover:bg-red-950/70'
          }`}
        >
          Restore Default Pose
        </button>
      </section>
    </div>
  );
});

export default ActionPanel;
