// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, drivers, vesc_trampa } from '@/api/proto.js';
import type { RoverControlSession } from './useRoverControlSession';

let session: RoverControlSession;
let written: vesc_trampa.Command[];
let root: ReturnType<typeof createRoot>;
let element: HTMLDivElement;
let releaseFirst: (() => void) | undefined;
let blockFirst = false;
let useSession: typeof import('./useRoverControlSession').useRoverControlSession;
function Harness({ suspended = false, id = 1 }: { suspended?: boolean; id?: number }) {
  session = useSession({ boardUuid: Uint8Array.of(id), steeringOutputId: 'steering', suspended });
  return null;
}
function rpm(c: vesc_trampa.Command) { const p = c.boardCommands[0].payload!; return new DataView(p.buffer,p.byteOffset,p.byteLength).getInt32(1,false); }
beforeEach(async () => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  vi.stubGlobal('WebSocket',class { close() {} });
  written=[]; blockFirst=false; releaseFirst=undefined;
  const { default: manager } = await import('@/api/websocket');
  vi.spyOn(manager.normFs,'enqueuePack').mockImplementation(async (_queue,packets) => {
    let blocked=false;
    for(const packet of packets) for(const cmd of commands.StationCommandsPack.decode(packet).commands) {
      if(cmd.type===drivers.StationCommandType.STC_VESC_TRAMPA_COMMAND) {
        written.push(vesc_trampa.Command.decode(cmd.body!));
        blocked ||= blockFirst && written.length===1;
      }
    }
    if(blocked) await new Promise<void>(resolve => { releaseFirst=resolve; });
    return [];
  });
  useSession=(await import('./useRoverControlSession')).useRoverControlSession;
  element=document.createElement('div'); document.body.append(element); root=createRoot(element);
  await act(async()=>root.render(createElement(Harness)));
});
afterEach(async()=>{await act(async()=>root.unmount());element.remove();vi.useRealTimers();vi.unstubAllGlobals();});
it('sends bounded RPM leases and coalesces a release ahead of queued driving while transport is slow',async()=>{
  blockFirst=true;
  await act(async()=>{session.actions.startTouch();session.actions.setTouchInput(0,-1);});
  await act(async()=>vi.advanceTimersByTimeAsync(150));
  await act(async()=>session.actions.releaseTouch());
  await act(async()=>releaseFirst?.());
  expect(written.map(rpm)).toEqual([-4500,0]);
  expect(written[0].boardCommands[0].payload![0]).toBe(8);
  expect(written[0].boardCommands[0].durationMs).toBeGreaterThan(0);
  expect(written[0].boardCommands[0].durationMs).toBeLessThanOrEqual(500);
  const tail=written[0].boardCommands[1].payload!;
  expect(new DataView(tail.buffer,tail.byteOffset,tail.byteLength).getInt32(1,false)).toBe(0);
  await act(async()=>vi.advanceTimersByTimeAsync(500));
  expect(written.map(rpm)).toEqual([-4500,0]);
});
it('uses the RPM slider for keyboard driving and releases on blur, suspension and unmount',async()=>{
  await act(async()=>session.actions.setRpmLimit(5000));
  await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW'})));
  expect(rpm(written.at(-1)!)).toBe(-5000);
  await act(async()=>window.dispatchEvent(new Event('blur')));
  expect(rpm(written.at(-1)!)).toBe(0);
  await act(async()=>{session.actions.startTouch();session.actions.setTouchInput(1,1);});
  await act(async()=>root.render(createElement(Harness,{suspended:true})));
  expect(rpm(written.at(-1)!)).toBe(0);
  const count=written.length;
  await act(async()=>{session.actions.startTouch();session.actions.setTouchInput(0,-1);});
  await act(async()=>vi.advanceTimersByTimeAsync(500));
  expect(written).toHaveLength(count);
  await act(async()=>root.render(createElement(Harness)));
  await act(async()=>{session.actions.startTouch();session.actions.setTouchInput(0,-1);});
  await act(async()=>root.render(null));
  expect(rpm(written.at(-1)!)).toBe(0);
});
it('sends a delayed cleanup stop to the original drive board after the target changes',async()=>{
  blockFirst=true;
  await act(async()=>{session.actions.startTouch();session.actions.setTouchInput(0,-1);});
  await act(async()=>root.render(createElement(Harness,{id:2})));
  await act(async()=>releaseFirst?.());
  expect(written.map(rpm)).toEqual([-4500,0]);
  expect(Array.from(written[1].targetBoardUuid)).toEqual([1]);
  expect(session.state.active).toBe(false);
});

it('ends held input at navigation intent before a lazy route unmounts, and ignores key repeats until a new press',async()=>{
  await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW'})));
  expect(rpm(written.at(-1)!)).toBeLessThan(0);
  const link=document.createElement('a');link.href='/history';document.body.append(link);
  link.addEventListener('click',e=>e.preventDefault());
  await act(async()=>link.click());
  expect(rpm(written.at(-1)!)).toBe(0);
  await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',repeat:true})));
  await act(async()=>vi.advanceTimersByTimeAsync(200));
  expect(rpm(written.at(-1)!)).toBe(0);
  expect(session.state.active).toBe(false);
  link.remove();
});

it('keeps nonzero joystick requests above the rover speed-controller minimum while preserving the dead zone and selected cap', async () => {
  await act(async () => session.actions.setRpmLimit(1100));
  for (const y of [-1, -.5, -.13, 0, .11, .13, .5, 1]) {
    // eslint-disable-next-line no-await-in-loop -- exercise successive joystick positions in one control session
    await act(async () => { session.actions.startTouch(); session.actions.setTouchInput(0, y); });
    const target = rpm(written.at(-1)!);
    if (Math.abs(y) <= .12) expect(target).toBe(0);
    else {
      expect(Math.sign(target)).toBe(Math.sign(y));
      expect(Math.abs(target)).toBeGreaterThanOrEqual(900);
      expect(Math.abs(target)).toBeLessThanOrEqual(1100);
    }
  }
  await act(async () => session.actions.setRpmLimit(100));
  await act(async () => { session.actions.startTouch(); session.actions.setTouchInput(0, -1); });
  expect(Math.abs(rpm(written.at(-1)!))).toBeGreaterThanOrEqual(900);
  await act(async () => session.actions.releaseTouch());
  expect(rpm(written.at(-1)!)).toBe(0);
});
