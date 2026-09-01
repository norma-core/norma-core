import { describe, expect, it } from 'vitest';
import { assertLiveModule } from './define-live-module';

const liveModuleEntries = import.meta.glob<{ default: unknown }>(
  '../modules/*/live.ts',
  { eager: true },
);

describe('live module contract', () => {
  it('discovers live module adapters', () => {
    expect(Object.keys(liveModuleEntries).length).toBeGreaterThan(0);
  });

  it('rejects adapters that bypass the factories', () => {
    expect(() => assertLiveModule({}, '../modules/example/live.ts')).toThrow(
      '../modules/example/live.ts must default-export a live module created by live() or customLive().',
    );
  });

  for (const [path, entry] of Object.entries(liveModuleEntries)) {
    it(`${path} default-exports a factory-created live module`, () => {
      expect(() => assertLiveModule(entry.default, path)).not.toThrow();
    });
  }
});
