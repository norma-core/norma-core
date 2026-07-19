import { describe, expect, it } from 'vitest';
import historyAdapters from './history';

describe('ST3215 history adapter', () => {
  it('keeps expanded device UI collapsed until requested', () => {
    expect(historyAdapters.every((adapter) => adapter.defaultExpanded === false)).toBe(true);
  });

  it('projects motor state bytes as a readable hexdump instead of base64', () => {
    const json = historyAdapters[0].toJson({
      buses: [{ motors: [{ state: Uint8Array.of(0, 1, 254, 255) }] }],
    }) as { buses: Array<{ motors: Array<{ state: { byteLength: number; hexdump: string[] } }> }> };

    expect(json.buses[0].motors[0].state).toEqual({
      byteLength: 4,
      hexdump: ['00000000  00 01 fe ff'],
    });
  });
});
