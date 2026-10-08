import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOAD_TIMEOUT_MS, RETRY_AFTER_MS, retryingLoader } from './vp8-frames.js';

describe('retryingLoader', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps a loaded result', async () => {
    const load = vi.fn(async () => 'decoder');
    const get = retryingLoader(load);
    expect(await get()).toBe('decoder');
    expect(await get()).toBe('decoder');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('waits before trying a failed load again, and logs each failure once', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let now = 0;
    const load = vi.fn(async (attempt: number) => {
      if (attempt === 0) {
        throw new Error('no wasm');
      }
      return 'decoder';
    });
    const get = retryingLoader(load, () => now);

    expect(await Promise.all([get(), get()])).toEqual([null, null]);
    now = RETRY_AFTER_MS - 1;
    expect(await get()).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledTimes(1);

    now = RETRY_AFTER_MS;
    expect(await get()).toBe('decoder');
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith(1, expect.any(AbortSignal));
  });

  it('treats a load that never ends as failed, then retries it', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      let now = 0;
      const load = vi.fn((attempt: number) =>
        attempt === 0 ? new Promise<string>(() => undefined) : Promise.resolve('decoder'));
      const get = retryingLoader(load, () => now);

      const first = get();
      now = LOAD_TIMEOUT_MS;
      await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS);
      expect(await first).toBeNull();
      expect(get.retryAt()).toBe(LOAD_TIMEOUT_MS + RETRY_AFTER_MS);

      now = LOAD_TIMEOUT_MS + RETRY_AFTER_MS;
      expect(await get()).toBe('decoder');
      expect(get.retryAt()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
