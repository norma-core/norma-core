import { Component, Suspense, memo } from 'react';
import type { ReactNode } from 'react';
import type {
  LiveDeviceError,
  LiveDevicePlan,
  ResolvedLiveDeviceView,
} from './live-registry';

interface LiveDeviceErrorBoundaryProps {
  label: string;
  children: ReactNode;
}

interface LiveDeviceErrorBoundaryState {
  error: Error | null;
}

class LiveDeviceErrorBoundary extends Component<
  LiveDeviceErrorBoundaryProps,
  LiveDeviceErrorBoundaryState
> {
  state: LiveDeviceErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): LiveDeviceErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-40 items-center justify-center rounded-lg border border-accent-critical bg-surface-primary/40 p-4 text-center text-accent-critical">
          Failed to render {this.props.label}: {this.state.error.message}
        </div>
      );
    }

    return this.props.children;
  }
}

interface LiveDeviceViewProps {
  view: ResolvedLiveDeviceView;
}

function LiveDeviceView({ view }: LiveDeviceViewProps) {
  return (
    <LiveDeviceErrorBoundary label={view.moduleLabel}>
      <Suspense
        fallback={(
          <div className="flex min-h-40 items-center justify-center rounded-lg border border-border-default bg-surface-primary/40 text-accent-data">
            Loading {view.moduleLabel}...
          </div>
        )}
      >
        {view.content}
      </Suspense>
    </LiveDeviceErrorBoundary>
  );
}

interface LiveDeviceSelectionErrorProps {
  error: LiveDeviceError;
}

function LiveDeviceSelectionError({ error }: LiveDeviceSelectionErrorProps) {
  return (
    <div className="rounded-lg border border-accent-critical bg-surface-primary/40 p-4 text-accent-critical">
      Failed to select {error.moduleLabel}: {error.message}
    </div>
  );
}

interface LiveDeviceSurfaceProps {
  plan: LiveDevicePlan;
}

const LiveDeviceSurface = memo(function LiveDeviceSurface({ plan }: LiveDeviceSurfaceProps) {
  const summaryViews = plan.views.filter((view) => view.slot === 'summary');
  const primaryViews = plan.views.filter((view) => view.slot === 'primary');

  return (
    <>
      {summaryViews.length > 0 && (
        <div className="grid grid-cols-1 gap-2 xl:grid-cols-2 2xl:grid-cols-4">
          {summaryViews.map((view) => (
            <LiveDeviceView key={`${view.moduleId}:${view.key}`} view={view} />
          ))}
        </div>
      )}
      {plan.errors.map((error) => (
        <LiveDeviceSelectionError key={error.moduleId} error={error} />
      ))}
      {primaryViews.map((view) => (
        <LiveDeviceView key={`${view.moduleId}:${view.key}`} view={view} />
      ))}
    </>
  );
});

export default LiveDeviceSurface;
