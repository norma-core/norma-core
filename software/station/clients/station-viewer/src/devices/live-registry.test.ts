import { describe, expect, it } from 'vitest';
import type { Frame } from '@/api/frame-parser';
import type { LiveDeviceAdapter } from './live';
import { createLiveDeviceCatalog } from './live-registry';

const frame = {} as Frame;

function adapter(
  id: string,
  options: Partial<Omit<LiveDeviceAdapter, 'id' | 'label'>> = {},
): LiveDeviceAdapter {
  return {
    id,
    label: id,
    order: 0,
    slot: 'primary',
    isRealtime: false,
    embedsCameraFeed: false,
    resolve: () => [{ key: id, content: id }],
    ...options,
  };
}

describe('live device catalog', () => {
  it('sorts selected views and derives active capabilities', () => {
    const catalog = createLiveDeviceCatalog([
      adapter('realtime-camera', {
        order: 2,
        isRealtime: true,
        embedsCameraFeed: true,
      }),
      adapter('summary', { order: 1, slot: 'summary' }),
    ]);

    const plan = catalog.resolve(frame);

    expect(plan.views.map((view) => view.moduleId)).toEqual(['summary', 'realtime-camera']);
    expect(plan.hasRealtimeDevice).toBe(true);
    expect(plan.hasEmbeddedCameraFeed).toBe(true);
    expect(plan.isEmpty).toBe(false);
  });

  it('isolates one selection failure without hiding healthy modules', () => {
    const catalog = createLiveDeviceCatalog([
      adapter('broken', {
        resolve: () => {
          throw new Error('bad selector');
        },
      }),
      adapter('healthy'),
    ]);

    const plan = catalog.resolve(frame);

    expect(plan.views.map((view) => view.moduleId)).toEqual(['healthy']);
    expect(plan.errors).toEqual([{
      moduleId: 'broken',
      moduleLabel: 'broken',
      message: 'bad selector',
    }]);
    expect(plan.isEmpty).toBe(false);
  });

  it('rejects duplicate module ids and duplicate selected keys', () => {
    expect(() => createLiveDeviceCatalog([adapter('same'), adapter('same')]))
      .toThrow('Duplicate live device module id');
    expect(() => createLiveDeviceCatalog([
      adapter('camera-summary', { slot: 'summary', embedsCameraFeed: true }),
    ])).toThrow('can only embed cameras in the primary slot');

    const catalog = createLiveDeviceCatalog([
      adapter('duplicate-views', {
        resolve: () => [
          { key: 'same', content: 'first' },
          { key: 'same', content: 'second' },
        ],
      }),
    ]);

    expect(catalog.resolve(frame).errors[0]?.message).toContain('Duplicate live device view key');
  });
});
