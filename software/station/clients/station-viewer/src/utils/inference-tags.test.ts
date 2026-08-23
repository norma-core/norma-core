import { describe, expect, it } from 'vitest';
import {
  resolveInferenceTagEvents,
  type InferenceTagEvent,
  type TagMarker,
} from './inference-tags';

function marker(frame: number, tag: string): TagMarker {
  return { frame, pointer: Uint8Array.of(frame), tag };
}

function event(frame: number, tag: string, removed = false): InferenceTagEvent {
  return { ...marker(frame, tag), removed };
}

describe('resolveInferenceTagEvents', () => {
  it('replays add and remove events into the selectable tag markers', () => {
    expect(resolveInferenceTagEvents([
      event(30, 'finish'),
      event(10, 'start'),
      event(10, 'discarded'),
      event(10, 'discarded', true),
    ])).toEqual([
      marker(10, 'start'),
      marker(30, 'finish'),
    ]);
  });

  it('allows a removed tag to be added again', () => {
    expect(resolveInferenceTagEvents([
      event(10, 'boundary'),
      event(10, 'boundary', true),
      event(10, 'boundary'),
    ])).toEqual([marker(10, 'boundary')]);
  });
});
