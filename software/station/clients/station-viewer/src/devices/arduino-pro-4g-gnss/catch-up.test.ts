import { describe, expect, it } from 'vitest';
import { detectQueueReset, planCatchUp } from './catch-up';

describe('planCatchUp', () => {
  it('reads the contiguous gap since the last processed entry', () => {
    expect(planCatchUp(100, 110)).toEqual({ startId: 101, count: 10 });
  });

  it('returns null when there is nothing new', () => {
    expect(planCatchUp(110, 110)).toBeNull();
    expect(planCatchUp(111, 110)).toBeNull();
  });

  it('backfills a bounded window on the first run', () => {
    expect(planCatchUp(null, 1000, 64)).toEqual({ startId: 937, count: 64 });
  });

  it('caps oversized gaps by skipping forward', () => {
    expect(planCatchUp(100, 1000, 64)).toEqual({ startId: 937, count: 64 });
  });

  it('clamps the window start for young queues', () => {
    expect(planCatchUp(null, 10, 64)).toEqual({ startId: 0, count: 11 });
  });
});

describe('detectQueueReset', () => {
  it('flags a queue whose ids went backwards (data wiped / queue recreated)', () => {
    expect(detectQueueReset(500, 3)).toBe(true);
  });

  it('does not flag normal progress or a fresh start', () => {
    expect(detectQueueReset(null, 3)).toBe(false);
    expect(detectQueueReset(500, 500)).toBe(false);
    expect(detectQueueReset(500, 501)).toBe(false);
  });
});
