import { describe, expect, it } from 'vitest';
import type { Frame, FrameEntry } from '@/api/frame-parser';
import { LIVE_TRAIT_REALTIME } from '@/live/define-live-module';
import { resolveLiveModules } from '@/live/live-registry';

function entry<Data>(queueId: string, data: Data): FrameEntry<Data> {
  return {
    queueId,
    ptr: new Uint8Array([1]),
    data,
    queueType: 0,
  };
}

describe('live presentation composition', () => {
  it('lets every discovered module tolerate a partial frame', () => {
    const plan = resolveLiveModules({} as Frame);

    expect(plan.errors).toEqual([]);
    expect(plan.views).toEqual([]);
    expect(plan.isEmpty).toBe(true);
  });

  it('discovers cameras as a feature alongside unrelated cards', () => {
    const frame = {
      videoQueues: [entry('camera/front', {})],
      airgradientOpenAir: [entry('sensor/air', {})],
    } as Frame;

    const plan = resolveLiveModules(frame);

    expect(plan.views.map(({ moduleId, layout }) => ({ moduleId, layout }))).toEqual([
      { moduleId: 'airgradient-open-air-o-1pst', layout: 'card' },
      { moduleId: 'usb-video', layout: 'feature' },
    ]);
  });

  it('lets a screen claim the data it presents without naming replaced modules', () => {
    const frame = {
      vescTrampa: entry('vesc/state', { boards: [{}] }),
      pwmOutputRx: entry('pwm/rx', { device: { id: 'drive-output' } }),
      videoQueues: [entry('camera/front', {})],
      victronSmartSolar: [entry('power/solar', {})],
    } as Frame;

    const plan = resolveLiveModules(frame);
    const moduleIds = plan.views.map((view) => view.moduleId);

    expect(moduleIds).toContain('rover');
    expect(moduleIds).not.toContain('vesc-trampa');
    expect(moduleIds).not.toContain('pwm-output');
    expect(moduleIds).not.toContain('usb-video');
    expect(moduleIds).not.toContain('victron-smartsolar-mppt');
    expect(plan.traits).toContain(LIVE_TRAIT_REALTIME);
  });

  it('lets a section claim cameras while keeping unrelated cards', () => {
    const frame = {
      yahboom_dogzilla_lite: entry('dogzilla/state', { devices: [{}] }),
      videoQueues: [entry('camera/front', {})],
      ina226: [entry('sensor/current', {})],
    } as Frame;

    const plan = resolveLiveModules(frame);
    const moduleIds = plan.views.map((view) => view.moduleId);

    expect(moduleIds).toContain('dogzilla');
    expect(moduleIds).toContain('ina226');
    expect(moduleIds).not.toContain('usb-video');
  });

  it('keeps the camera module mounted across ST3215 lifecycle changes', () => {
    const cameraEntry = entry('camera/front', {
      camera: { uniqueId: 'front-camera' },
    });
    const withoutArm = {
      videoQueues: [cameraEntry],
    } as Frame;
    const withArm = {
      st3215: entry('st3215/state', {
        buses: [{ bus: { serialNumber: 'arm-1' }, motors: [{}] }],
      }),
      videoQueues: [cameraEntry],
    } as Frame;

    const plans = [withoutArm, withArm, withoutArm].map(resolveLiveModules);

    expect(plans.map((plan) => plan.views.map((view) => view.moduleId))).toEqual([
      ['usb-video'],
      ['st3215', 'usb-video'],
      ['usb-video'],
    ]);
  });
});
