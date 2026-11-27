// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import Long from 'long';
import { expect, it, vi } from 'vitest';
import { commands, drivers, pwm_output, vesc_trampa } from '@/api/proto.js';

it('sends steering and drive commands without PWM status telemetry', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('WebSocket', class { close() {} });
  const { default: manager } = await import('@/api/websocket');
  const stats = { ...manager.getConnectionStats(), status: 'connected' as const };
  vi.spyOn(manager, 'getConnectionStats').mockReturnValue(stats);
  const written: commands.IDriverCommand[] = [];
  vi.spyOn(manager.normFs, 'enqueuePack').mockImplementation(async (_queue, packets) => {
    for (const packet of packets) written.push(...commands.StationCommandsPack.decode(packet).commands);
    return [];
  });
  const { default: Panel } = await import('./VescPwmOutputControlPanel');
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element);
  // GET_VALUES_SEL: valid voltage and fault fields.
  const payload = Uint8Array.of(50,0,0,129,0,0,132,0);
  const vesc = { boards: [{ board: { uuid: Uint8Array.of(1) }, valuesPayload: payload, valuesMonotonicStampNs: Long.fromNumber(Date.now()*1e6) }] };
  try {
    await act(async () => root.render(createElement(Panel, { vesc })));
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', bubbles: true })));
    const steering = written.filter(c => c.type === drivers.StationCommandType.STC_PWM_OUTPUT_COMMAND).map(c => pwm_output.Command.decode(c.body!));
    expect(steering.length).toBeGreaterThan(0);
    expect(steering.every(c => c.targetOutputId === 'steering')).toBe(true);
    await act(async () => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA', bubbles: true })));
    const drive = written.filter(c => c.type === drivers.StationCommandType.STC_VESC_TRAMPA_COMMAND).map(c => vesc_trampa.Command.decode(c.body!));
    expect(drive.at(-1)?.boardCommands[0].payload?.[0]).toBe(8);
  } finally { await act(async () => root.unmount()); element.remove(); vi.unstubAllGlobals(); }
});
