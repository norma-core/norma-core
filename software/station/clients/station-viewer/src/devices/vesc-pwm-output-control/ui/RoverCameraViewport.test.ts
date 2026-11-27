// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { drivers, usbvideo } from '@/api/proto.js';
import { getLiveCameraFrame, isLiveCameraSuppressed, publishLiveCameraFrame, shouldLoadLiveCameraFrame, clearLiveCameraFrame } from '@/usbvideo/live-camera-store';

it('pauses cockpit frame fetching while hidden and resumes it without sending camera commands', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('WebSocket', class { close() {} });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:camera-test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const { default: manager } = await import('@/api/websocket');
  const send = vi.spyOn(manager.normFs, 'enqueuePack').mockResolvedValue([]);
  const { default: Viewport } = await import('./RoverCameraViewport');
  const envelope = usbvideo.RxEnvelope.create({ camera: { uniqueId: 'hide-video-test' }, frames: { framesData: [Uint8Array.of(1)] } });
  const source = { queueId: 'video', queueType: drivers.QueueDataType.QDT_USB_VIDEO_FRAMES, ptr: Uint8Array.of(1), data: envelope };
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element);
  try {
    await act(async () => root.render(createElement(Viewport, { source, motion: null, now: Date.now(), isFullscreen: false, onToggleFullscreen: () => {}, onBeforeChange: () => {}, disabled: false })));
    const toggle = element.querySelector<HTMLButtonElement>('button[aria-label="Hide video display"]');
    expect(toggle).not.toBeNull();
    await act(async () => toggle!.click());
    expect(element.textContent).toContain('Video hidden');
    expect(isLiveCameraSuppressed('hide-video-test')).toBe(false);
    expect(shouldLoadLiveCameraFrame('video', envelope)).toBe(false);
    expect(element.querySelector('img')).toBeNull();
    // A read already in flight may still finish after hiding the viewer.
    const next = usbvideo.RxEnvelope.create({ ...envelope, frames: { framesData: [Uint8Array.of(2)] } });
    await act(async () => publishLiveCameraFrame('video', next));
    expect(getLiveCameraFrame('hide-video-test')?.data).toEqual(Uint8Array.of(2));
    await act(async () => element.querySelector<HTMLButtonElement>('button[aria-label="Show video display"]')!.click());
    expect(shouldLoadLiveCameraFrame('video', envelope)).toBe(true);
    expect(element.textContent).not.toContain('Video hidden');
    expect(element.querySelector<HTMLImageElement>('img')?.getAttribute('src')).toBe('blob:camera-test');
    expect(send).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount()); element.remove(); clearLiveCameraFrame('hide-video-test');
  }
});
