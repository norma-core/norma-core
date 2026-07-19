import { describe, expect, it } from 'vitest';
import { drivers, sysinfo } from '@/api/proto.js';
import { defineQueueAdapter } from './queue-adapter';
import { createQueueAdapterRegistry } from './queue-adapter-registry';

function queueAdapter(key: string, options: { matchQueue?: (queueId: string) => boolean } = {}) {
  return defineQueueAdapter<sysinfo.IEnvelope>({
    key,
    message: sysinfo.Envelope,
    queueType: drivers.QueueDataType.QDT_SYSTEM,
    cardinality: 'single',
    matchQueue: options.matchQueue,
  });
}

describe('queue adapter registry', () => {
  it('prefers one matching specific adapter over the bare fallback', () => {
    const fallback = queueAdapter('fallback');
    const specific = queueAdapter('specific', { matchQueue: (queueId) => queueId.endsWith('/special') });
    const registry = createQueueAdapterRegistry([fallback, specific]);

    expect(registry.resolve(drivers.QueueDataType.QDT_SYSTEM, '/robot/special')).toEqual({ adapter: specific });
    expect(registry.resolve(drivers.QueueDataType.QDT_SYSTEM, '/robot/other')).toEqual({ adapter: fallback });
  });

  it('reports all matching specific adapters as ambiguous', () => {
    const first = queueAdapter('first', { matchQueue: () => true });
    const second = queueAdapter('second', { matchQueue: () => true });
    const resolution = createQueueAdapterRegistry([first, second]).resolve(
      drivers.QueueDataType.QDT_SYSTEM,
      '/queue',
    );

    expect(resolution).toEqual({ ambiguous: [first, second] });
  });

  it('rejects duplicate keys and multiple bare adapters', () => {
    expect(() => createQueueAdapterRegistry([
      queueAdapter('same'),
      queueAdapter('same', { matchQueue: () => true }),
    ])).toThrow('Duplicate device queue adapter key');
    expect(() => createQueueAdapterRegistry([queueAdapter('first'), queueAdapter('second')]))
      .toThrow('Multiple bare device queue adapters');
  });
});
