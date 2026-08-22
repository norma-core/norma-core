import { customLive, frameFieldClaims } from '@/live/define-live-module';
import type { CameraSurfaceProps } from '@/modules/usb-video/CameraSurface';

export default customLive<CameraSurfaceProps>({
  label: 'Cameras',
  order: 100,
  layout: 'feature',
  claims: frameFieldClaims('videoQueues'),
  select: (frame) => frame.videoQueues?.length ? [{
    key: 'usb-video',
    props: {
      videoSources: frame.videoQueues,
      desktopAspectRatio: true,
    },
  }] : [],
  loadView: () => import('@/modules/usb-video/CameraSurface'),
});
