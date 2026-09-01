import { Component, Suspense, memo } from 'react';
import type { ReactNode } from 'react';
import AsciiRobot from '@/components/AsciiRobot';
import type {
  LiveModuleError,
  LivePlan,
  ResolvedLiveView,
} from './live-registry';

interface LiveErrorBoundaryProps {
  label: string;
  children: ReactNode;
}

interface LiveErrorBoundaryState {
  error: Error | null;
}

class LiveErrorBoundary extends Component<
  LiveErrorBoundaryProps,
  LiveErrorBoundaryState
> {
  state: LiveErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): LiveErrorBoundaryState {
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

interface LiveViewProps {
  view: ResolvedLiveView;
}

function LiveView({ view }: LiveViewProps) {
  return (
    <LiveErrorBoundary label={view.moduleLabel}>
      <Suspense
        fallback={(
          <div className="flex min-h-40 items-center justify-center rounded-lg border border-border-default bg-surface-primary/40 text-accent-data">
            Loading {view.moduleLabel}...
          </div>
        )}
      >
        {view.content}
      </Suspense>
    </LiveErrorBoundary>
  );
}

interface LiveSelectionErrorProps {
  error: LiveModuleError;
}

function LiveSelectionError({ error }: LiveSelectionErrorProps) {
  return (
    <div className="rounded-lg border border-accent-critical bg-surface-primary/40 p-4 text-accent-critical">
      Failed to select {error.moduleLabel}: {error.message}
    </div>
  );
}

interface LiveSurfaceProps {
  plan: LivePlan;
}

const LiveSurface = memo(function LiveSurface({
  plan,
}: LiveSurfaceProps) {
  const cardViews = plan.views.filter((view) => view.layout === 'card');
  const sectionViews = plan.views.filter((view) => view.layout === 'section');
  const featureViews = plan.views.filter((view) => view.layout === 'feature');
  const screenViews = plan.views.filter((view) => view.layout === 'screen');
  const hasScreen = screenViews.length > 0;
  const hasFeatureCardLayout = featureViews.length === 1 && cardViews.length > 0;

  const cardContent = cardViews.length > 0 && (
    <div className={`grid grid-cols-1 gap-2 ${
      hasFeatureCardLayout ? '' : 'xl:grid-cols-2 2xl:grid-cols-4'
    }`}>
      {cardViews.map((view) => (
        <LiveView key={`${view.moduleId}:${view.key}`} view={view} />
      ))}
    </div>
  );

  return (
    <div className={`flex min-h-full w-full flex-col ${
      hasScreen ? 'gap-0 p-0 lg:gap-4 lg:p-4' : 'gap-4 p-4'
    }`}>
      {hasFeatureCardLayout ? (
        <div className="grid w-full gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)] xl:items-start">
          <LiveView view={featureViews[0]} />
          {cardContent}
        </div>
      ) : (
        <>
          {cardContent}
          {featureViews.map((view) => (
            <LiveView key={`${view.moduleId}:${view.key}`} view={view} />
          ))}
        </>
      )}
      {plan.errors.map((error) => (
        <LiveSelectionError key={error.moduleId} error={error} />
      ))}
      {sectionViews.map((view) => (
        <LiveView key={`${view.moduleId}:${view.key}`} view={view} />
      ))}
      {screenViews.map((view) => (
        <LiveView key={`${view.moduleId}:${view.key}`} view={view} />
      ))}
      {plan.isEmpty && (
        <div className="flex min-h-full w-full flex-1 items-center justify-center rounded-lg border border-dashed border-border-default bg-surface-primary/40 px-6">
          <AsciiRobot />
        </div>
      )}
    </div>
  );
});

export default LiveSurface;
