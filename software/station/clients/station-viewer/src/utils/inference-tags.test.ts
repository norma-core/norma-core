import { describe, expect, it } from 'vitest';
import { resolveInferenceTagEvents } from './inference-tags';

describe('resolveInferenceTagEvents', () => {
  it('replays add and remove events into the selectable tag markers', () => {
    expect(resolveInferenceTagEvents([
      { frame: 30, tag: 'finish', removed: false },
      { frame: 10, tag: 'start', removed: false },
      { frame: 10, tag: 'discarded', removed: false },
      { frame: 10, tag: 'discarded', removed: true },
    ])).toEqual([
      { frame: 10, tag: 'start' },
      { frame: 30, tag: 'finish' },
    ]);
  });

  it('allows a removed tag to be added again', () => {
    expect(resolveInferenceTagEvents([
      { frame: 10, tag: 'boundary', removed: false },
      { frame: 10, tag: 'boundary', removed: true },
      { frame: 10, tag: 'boundary', removed: false },
    ])).toEqual([{ frame: 10, tag: 'boundary' }]);
  });
});
