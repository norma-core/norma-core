import type { Frame } from '@/api/frame-parser';
import { assertLiveModule } from './define-live-module';
import type {
  LiveContent,
  LiveLayout,
  LiveModule,
} from './define-live-module';

export interface ResolvedLiveView extends LiveContent {
  moduleId: string;
  moduleLabel: string;
  layout: LiveLayout;
}

export interface LiveModuleError {
  moduleId: string;
  moduleLabel: string;
  message: string;
}

export interface LivePlan {
  views: readonly ResolvedLiveView[];
  errors: readonly LiveModuleError[];
  isEmpty: boolean;
  traits: readonly string[];
}

interface LiveCatalog {
  resolve: (frame: Frame | null) => LivePlan;
}

interface RegisteredLiveModule extends LiveModule {
  id: string;
}

function compareModules(left: RegisteredLiveModule, right: RegisteredLiveModule): number {
  return left.order - right.order || left.id.localeCompare(right.id);
}

interface ResolvedModule {
  module: RegisteredLiveModule;
  content: readonly LiveContent[];
}

function compareClaimCoverage(left: ResolvedModule, right: ResolvedModule): number {
  return right.module.claims.length - left.module.claims.length
    || compareModules(left.module, right.module);
}

function createCatalog(modules: readonly RegisteredLiveModule[]): LiveCatalog {
  const sortedModules = [...modules].sort(compareModules);
  const moduleIds = new Set<string>();

  for (const module of sortedModules) {
    if (!module.id) {
      throw new Error('Live module id must not be empty.');
    }
    if (moduleIds.has(module.id)) {
      throw new Error(`Duplicate live module id: ${module.id}`);
    }
    if (!Number.isFinite(module.order)) {
      throw new Error(`Live module ${module.id} has an invalid order.`);
    }
    if (module.claims.length === 0 || module.claims.some((claim) => !claim)) {
      throw new Error(`Live module ${module.id} must declare non-empty claims.`);
    }
    if (new Set(module.claims).size !== module.claims.length) {
      throw new Error(`Live module ${module.id} has duplicate claims.`);
    }
    if (module.traits.some((trait) => !trait)) {
      throw new Error(`Live module ${module.id} has an empty trait.`);
    }
    if (new Set(module.traits).size !== module.traits.length) {
      throw new Error(`Live module ${module.id} has duplicate traits.`);
    }

    moduleIds.add(module.id);
  }

  return {
    resolve(frame) {
      if (!frame) {
        return {
          views: [],
          errors: [],
          isEmpty: true,
          traits: [],
        };
      }

      const resolvedModules: ResolvedModule[] = [];
      const errors: LiveModuleError[] = [];

      for (const module of sortedModules) {
        try {
          const selected = [...module.resolve(frame)].sort((left, right) =>
            left.key.localeCompare(right.key),
          );
          const keys = new Set<string>();

          for (const view of selected) {
            if (!view.key) {
              throw new Error('A live view key must not be empty.');
            }
            if (keys.has(view.key)) {
              throw new Error(`Duplicate live view key: ${view.key}`);
            }
            keys.add(view.key);
          }

          if (selected.length > 0) {
            resolvedModules.push({ module, content: selected });
          }
        } catch (error) {
          errors.push({
            moduleId: module.id,
            moduleLabel: module.label,
            message: error instanceof Error ? error.message : 'Unknown module selection error.',
          });
        }
      }

      const claimedPresentation = new Set<string>();
      const visibleModuleIds = new Set<string>();

      for (const resolved of [...resolvedModules].sort(compareClaimCoverage)) {
        if (resolved.module.claims.some((claim) => claimedPresentation.has(claim))) {
          continue;
        }

        visibleModuleIds.add(resolved.module.id);
        for (const claim of resolved.module.claims) {
          claimedPresentation.add(claim);
        }
      }

      const visibleModules = resolvedModules.filter(({ module }) =>
        visibleModuleIds.has(module.id),
      );
      const visibleViews = visibleModules.flatMap(({ module, content }) =>
        content.map((view) => ({
          ...view,
          moduleId: module.id,
          moduleLabel: module.label,
          layout: module.layout,
        })),
      );
      const traits = [...new Set(visibleModules.flatMap(({ module }) => module.traits))];

      return {
        views: visibleViews,
        errors,
        isEmpty: visibleViews.length === 0 && errors.length === 0,
        traits,
      };
    },
  };
}

const liveModuleEntries = import.meta.glob<{ default: unknown }>(
  '../modules/*/live.ts',
  { eager: true },
);

function moduleIdFromPath(path: string): string {
  const match = path.match(/\/modules\/([^/]+)\/live\.ts$/);
  if (!match?.[1]) {
    throw new Error(`Cannot derive live module id from path: ${path}`);
  }
  return match[1];
}

const liveCatalog = createCatalog(
  Object.entries(liveModuleEntries).map(([path, entry]) => {
    assertLiveModule(entry.default, path);

    return {
      ...entry.default,
      id: moduleIdFromPath(path),
    };
  }),
);

export function resolveLiveModules(frame: Frame | null): LivePlan {
  return liveCatalog.resolve(frame);
}
