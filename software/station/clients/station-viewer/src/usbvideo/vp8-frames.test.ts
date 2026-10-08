import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOAD_TIMEOUT_MS, RESTART_AFTER_MS, RETRY_AFTER_MS, quietLibAV, retryingLoader } from './vp8-frames.js';

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

describe('retryingLoader restart', () => {
  it('gives a young load until RESTART_AFTER_MS, then starts again', async () => {
    vi.useFakeTimers();
    try {
      let now = 0;
      const load = vi.fn((attempt: number) =>
        attempt === 0 ? new Promise<string>(() => undefined) : Promise.resolve('decoder'));
      const get = retryingLoader(load, () => now);

      const first = get();
      now = 1_000;
      get.restart();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(get.retryAt()).toBeNull();

      now = RESTART_AFTER_MS;
      await vi.advanceTimersByTimeAsync(RESTART_AFTER_MS);
      expect(await first).toBeNull();
      const second = get();
      await vi.advanceTimersByTimeAsync(RESTART_AFTER_MS);
      expect(await second).toBe('decoder');
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up on an old load at once', async () => {
    vi.useFakeTimers();
    try {
      let now = 0;
      const load = vi.fn(() => new Promise<string>(() => undefined));
      const get = retryingLoader(load, () => now);
      const first = get();
      now = RESTART_AFTER_MS;
      get.restart();
      expect(await first).toBeNull();
      expect(get.retryAt()).toBe(now);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('quietLibAV', () => {
  it('stops only instances that finish after the abort', async () => {
    const made: Array<{ terminate: ReturnType<typeof vi.fn> }> = [];
    const LibAV = {
      LibAV: async () => {
        const libav = { terminate: vi.fn(), av_log_set_level: async () => undefined, AV_LOG_ERROR: 16 };
        made.push(libav);
        return libav;
      },
    } as unknown as Parameters<typeof quietLibAV>[0];
    const controller = new AbortController();
    const quiet = quietLibAV(LibAV, controller.signal);

    await quiet.LibAV();
    controller.abort();
    await expect(quiet.LibAV()).rejects.toThrow();
    expect(made[0].terminate).not.toHaveBeenCalled();
    expect(made[1].terminate).toHaveBeenCalledTimes(1);
  });
});
