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
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-accent-data">
              {group.title}
            </h3>
            <div className="h-px flex-1 bg-border-default" />
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
                      ? 'border-accent-data bg-accent-data/10 text-accent-data'
                      : 'border-border-default bg-surface-primary/80 text-text-primary hover:border-accent-data hover:text-accent-data'
                  }`}
                >
                  {action.label}
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <section className="space-y-2 border-t border-border-default pt-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-accent-critical">
          Reset
        </h3>
        <button
          type="button"
          onClick={() => onActionSelect(QUICK_ACTIONS[3])}
          className={`w-full rounded-md border px-4 py-4 text-left text-sm font-semibold transition ${
            activeAction === QUICK_ACTIONS[3].value
              ? 'border-accent-critical bg-accent-critical/20 text-accent-critical'
              : 'border-accent-critical-deep bg-accent-critical/10 text-accent-critical hover:border-accent-critical hover:bg-accent-critical/20'
          }`}
        >
          Restore Default Pose
        </button>
      </section>
    </div>
  );
});

export default ActionPanel;
