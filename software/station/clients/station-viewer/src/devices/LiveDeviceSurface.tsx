import { Suspense, memo } from 'react';
import DeviceErrorBoundary from '@/components/DeviceErrorBoundary';
import type {
  LiveDeviceError,
  LiveDevicePlan,
  ResolvedLiveDeviceView,
} from './live-registry';

interface LiveDeviceViewProps {
  view: ResolvedLiveDeviceView;
  resetKey: unknown;
}

function LiveDeviceView({ view, resetKey }: LiveDeviceViewProps) {
  return (
    <DeviceErrorBoundary label={view.moduleLabel} resetKey={resetKey}>
      <Suspense
        fallback={(
          <div className="flex min-h-40 items-center justify-center rounded-lg border border-border-default bg-surface-primary/40 text-accent-data">
            Loading {view.moduleLabel}...
          </div>
        )}
      >
        {view.content}
      </Suspense>
    </DeviceErrorBoundary>
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
  summaryLayout?: 'responsive' | 'stacked';
}

const LiveDeviceSurface = memo(function LiveDeviceSurface({
  plan,
  summaryLayout = 'responsive',
}: LiveDeviceSurfaceProps) {
  const summaryViews = plan.views.filter((view) => view.slot === 'summary');
  const primaryViews = plan.views.filter((view) => view.slot === 'primary');

  return (
    <>
      {summaryViews.length > 0 && (
        <div className={`grid grid-cols-1 gap-2 ${
          summaryLayout === 'responsive' ? 'xl:grid-cols-2 2xl:grid-cols-4' : ''
        }`}>
          {summaryViews.map((view) => (
            <LiveDeviceView key={`${view.moduleId}:${view.key}`} view={view} resetKey={plan} />
          ))}
        </div>
      )}
      {plan.errors.map((error) => (
        <LiveDeviceSelectionError key={error.moduleId} error={error} />
      ))}
      {primaryViews.map((view) => (
        <LiveDeviceView key={`${view.moduleId}:${view.key}`} view={view} resetKey={plan} />
      ))}
    </>
  );
});

export default LiveDeviceSurface;
