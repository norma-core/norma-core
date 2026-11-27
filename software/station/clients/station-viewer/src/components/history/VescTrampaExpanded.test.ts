// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { vesc_trampa } from '@/api/proto.js';

// Full GET_VALUES packet, matching the driver telemetry test's wire format.
function valuesPayload() {
  const bytes = [4];
  const append = (size: number, value: number) => {
    const buffer = new ArrayBuffer(size);
    const view = new DataView(buffer);
    if (size === 2) view.setInt16(0, value);
    else view.setInt32(0, value);
    bytes.push(...new Uint8Array(buffer));
  };
  append(2, 321); append(2, 456);
  for (const value of [1234, -567, 111, -222]) append(4, value);
  append(2, 765); append(4, -4500); append(2, 501);
  for (const value of [123456, 234567, 345678, 456789, 777, 888]) append(4, value);
  bytes.push(2); append(4, 314159); bytes.push(42);
  for (const value of [311, 322, 333]) append(2, value);
  append(4, 1200); append(4, -1300); bytes.push(3);
  return Uint8Array.from(bytes);
}

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });

async function mount(data: vesc_trampa.InferenceState | vesc_trampa.RxEnvelope, type: string) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('WebSocket', class { close() {} });
  const { default: ExpandedView } = await import('./ExpandedView');
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element);
  cleanup = async () => { await act(async () => root.unmount()); element.remove(); };
  const rawData = data instanceof vesc_trampa.InferenceState
    ? vesc_trampa.InferenceState.encode(data).finish() : vesc_trampa.RxEnvelope.encode(data).finish();
  await act(async () => root.render(createElement(ExpandedView, { data, type, rawData })));
  const clickTab = async (label: string) => act(async () => {
    const button = Array.from(element.querySelectorAll('button')).find(b => b.textContent === label);
    expect(button).toBeDefined(); button!.click();
  });
  return { element, clickTab };
}

it.each(['inference', 'rx'])('shows recorded VESC temperatures and full telemetry for %s with decoded JSON and raw bytes', async source => {
  const payload = valuesPayload();
  const board = { uuid: Uint8Array.of(1), hardwareName: 'TRAMPA', portName: '/dev/ttyACM0' };
  const data = source === 'inference'
    ? vesc_trampa.InferenceState.create({ boards: [{ board, valuesPayload: payload }] })
    : vesc_trampa.RxEnvelope.create({ board, signalType: 3, boardPacket: { commandId: 4, payload } });
  const { element, clickTab } = await mount(data, source === 'inference' ? 'vesc-trampa' : 'vesc-trampa-rx');
  const fields = Object.fromEntries(Array.from(element.querySelectorAll('dt')).map(dt => [dt.textContent, dt.nextElementSibling?.textContent]));
  expect(fields).toMatchObject({
    'FET temperature': '32.1 °C', 'Motor temperature': '45.6 °C',
    'Input current': '-5.67 A', 'Motor current': '12.34 A',
    'Voltage': '50.1 V', 'RPM': '-4,500', 'Duty cycle': '76.5 %',
    'Ah charged': '23.4567 Ah', 'Wh charged': '45.6789 Wh',
    'MOSFET temperatures': '31.1 / 32.2 / 33.3 °C',
    'Timeout': 'Active', 'Kill switch': 'Active', 'Controller ID': '42',
  });
  expect(element.querySelector('input')).toBeNull();
  expect(element.textContent).not.toContain('Momentary Current');
  await clickTab('JSON');
  const json = JSON.parse(element.querySelector('pre')!.textContent!);
  const values = source === 'inference' ? json.boards[0].decodedValues.values : json.decodedValues.values;
  expect(values).toMatchObject({ tempFetC: 32.1, tempMotorC: 45.6, rpm: -4500 });
  await clickTab('Hex');
  expect(element.textContent).not.toContain('Raw data not available');
});

it('shows missing selective fields and corrupt payloads without inventing zero temperatures', async () => {
  const data = vesc_trampa.InferenceState.create({ boards: [
    { board: { uuid: Uint8Array.of(1) }, valuesPayload: Uint8Array.of(50, 0, 0, 1, 0, 1, 244) },
    { board: { uuid: Uint8Array.of(2) }, valuesPayload: Uint8Array.of(4, 0) },
  ] });
  const { element } = await mount(data, 'vesc-trampa');
  expect(element.textContent).toContain('50.0 V');
  expect(element.textContent).toContain('temp_fet_c: need 2 bytes, have 1');
  const temperatures = Array.from(element.querySelectorAll('dt')).filter(dt => dt.textContent === 'FET temperature');
  expect(temperatures[0].nextElementSibling?.textContent).toBe('—');
});
