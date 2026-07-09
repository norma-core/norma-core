import type { DeviceModule } from '@/devices/types';
import type { ArduinoNiclaSenseEnvLiveViewProps } from './ui/ArduinoNiclaSenseEnvLiveView';

const arduinoNiclaSenseEnvModule = {
  id: 'arduino-nicla-sense-env',
  label: 'Arduino Nicla Sense Env',
  order: 1,
  live: {
    select: ({ frame }) => {
      const entry = frame.arduinoNiclaSenseEnv;
      if (!entry) {
        return [];
      }

      return [{
        key: entry.queueId,
        placement: 'widget' as const,
        props: { data: entry.data },
      }];
    },
    loadView: () => import('./ui/ArduinoNiclaSenseEnvLiveView'),
  },
} satisfies DeviceModule<ArduinoNiclaSenseEnvLiveViewProps>;

export default arduinoNiclaSenseEnvModule;
