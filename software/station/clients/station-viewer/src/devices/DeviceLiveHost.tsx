import { lazy, memo, Suspense, useMemo } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import type { SelectedLiveDeviceView } from './types';

type LazyLiveView = LazyExoticComponent<ComponentType<Record<string, unknown>>>;

const lazyViewCache = new Map<string, LazyLiveView>();

function getLazyLiveView(
  moduleId: string,
  loadSelectedView: SelectedLiveDeviceView['loadView'],
): LazyLiveView {
  const cached = lazyViewCache.get(moduleId);
  if (cached) {
    return cached;
  }

  const loadView = loadSelectedView as () => Promise<{
    default: ComponentType<Record<string, unknown>>;
  }>;
  const LazyView = lazy(loadView);
  lazyViewCache.set(moduleId, LazyView);
  return LazyView;
}

interface DeviceLiveHostProps {
  views: SelectedLiveDeviceView[];
}

interface DeviceLiveViewProps {
  selected: SelectedLiveDeviceView;
}

function DeviceLiveView({ selected }: DeviceLiveViewProps) {
  const LazyView = useMemo(
    () => getLazyLiveView(selected.moduleId, selected.loadView),
    [selected.moduleId, selected.loadView],
  );
  const props = selected.view.props as Record<string, unknown>;

  return (
    <Suspense
      fallback={
        <div className="flex min-h-40 items-center justify-center rounded-lg border border-border-default bg-surface-primary/40 text-accent-data">
          Loading {selected.view.label ?? selected.moduleLabel}...
        </div>
      }
    >
      <LazyView {...props} />
    </Suspense>
  );
}

const DeviceLiveHost = memo(function DeviceLiveHost({ views }: DeviceLiveHostProps) {
  const groups = views.reduce<Array<{
    placement: 'full' | 'widget';
    views: SelectedLiveDeviceView[];
  }>>((result, view) => {
    const placement = view.view.placement ?? 'full';
    const previous = result.at(-1);

    if (placement === 'widget' && previous?.placement === 'widget') {
      previous.views.push(view);
    } else {
      result.push({ placement, views: [view] });
    }

    return result;
  }, []);

  return (
    <>
      {groups.map((group) => {
        const content = group.views.map((view) => (
          <DeviceLiveView
            key={`${view.moduleId}:${view.view.key}`}
            selected={view}
          />
        ));

        if (group.placement === 'widget') {
          const groupKey = group.views
            .map((view) => `${view.moduleId}:${view.view.key}`)
            .join('|');
          return (
            <div key={groupKey} className="grid grid-cols-1 gap-2 xl:grid-cols-2 2xl:grid-cols-4">
              {content}
            </div>
          );
        }

        return content;
      })}
    </>
  );
});

export default DeviceLiveHost;
