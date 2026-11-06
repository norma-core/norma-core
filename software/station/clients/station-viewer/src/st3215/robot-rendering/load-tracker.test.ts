import { describe, expect, it } from 'vitest';
import { LoadTracker } from './load-tracker';

describe('LoadTracker', () => {
  it('settles the load it started', () => {
    const tracker = new LoadTracker();
    const token = tracker.begin();
    expect(tracker.isPending).toBe(true);
    expect(tracker.settle(token)).toBe(true);
    expect(tracker.isPending).toBe(false);
  });

  it('rejects a load that was cancelled while in flight', () => {
    const tracker = new LoadTracker();
    const stale = tracker.begin();
    tracker.cancel();
    expect(tracker.isPending).toBe(false);
    expect(tracker.settle(stale)).toBe(false);
  });

  it('lets a new load start after a cancel and settles only that one', () => {
    const tracker = new LoadTracker();
    const stale = tracker.begin();
    tracker.cancel();
    const fresh = tracker.begin();
    expect(tracker.settle(stale)).toBe(false);
    expect(tracker.isPending).toBe(true);
    expect(tracker.settle(fresh)).toBe(true);
    expect(tracker.isPending).toBe(false);
  });
});
