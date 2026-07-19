import { describe, expect, it } from 'vitest';
import { drivers, sysinfo } from '@/api/proto.js';
import { defineCodec } from './codec';
import { createCodecRegistry } from './codec-registry';

function codec(key: string, options: { matchQueue?: (queueId: string) => boolean } = {}) {
  return defineCodec<sysinfo.IEnvelope>({
    key,
    message: sysinfo.Envelope,
    queueType: drivers.QueueDataType.QDT_SYSTEM,
    cardinality: 'single',
    matchQueue: options.matchQueue,
  });
}

describe('codec registry', () => {
  it('prefers one matching specific codec over the bare fallback', () => {
    const fallback = codec('fallback');
    const specific = codec('specific', { matchQueue: (queueId) => queueId.endsWith('/special') });
    const registry = createCodecRegistry([fallback, specific]);

    expect(registry.resolve(drivers.QueueDataType.QDT_SYSTEM, '/robot/special')).toEqual({ codec: specific });
    expect(registry.resolve(drivers.QueueDataType.QDT_SYSTEM, '/robot/other')).toEqual({ codec: fallback });
  });

  it('reports all matching specific codecs as ambiguous', () => {
    const first = codec('first', { matchQueue: () => true });
    const second = codec('second', { matchQueue: () => true });
    const resolution = createCodecRegistry([first, second]).resolve(
      drivers.QueueDataType.QDT_SYSTEM,
      '/queue',
    );

    expect(resolution).toEqual({ ambiguous: [first, second] });
  });

  it('rejects duplicate keys and multiple bare codecs', () => {
    expect(() => createCodecRegistry([codec('same'), codec('same', { matchQueue: () => true })]))
      .toThrow('Duplicate device codec key');
    expect(() => createCodecRegistry([codec('first'), codec('second')]))
      .toThrow('Multiple bare device codecs');
  });
});
