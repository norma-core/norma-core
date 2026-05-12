import { memo, useEffect, useState } from 'react';
import type { FrameEntry } from '@/api/frame-parser';
import { dogzilla, ov5647, usbvideo } from '@/api/proto.js';
import DogzillaDashboard from '@/dogzilla/DogzillaDashboard';
import DogzillaDesktopCard from '@/dogzilla/DogzillaDesktopCard';

interface DogzillaCardProps {
  deviceState: dogzilla.InferenceState.IDeviceState;
  deviceIndex: number;
  videoSources?: FrameEntry<usbvideo.IRxEnvelope>[];
  ov5647Sources?: FrameEntry<ov5647.IRxEnvelope>[];
}

const DESKTOP_MEDIA_QUERY = '(min-width: 1024px)';

const DogzillaCard = memo(function DogzillaCard({
  deviceState,
  deviceIndex,
  videoSources,
  ov5647Sources
}: DogzillaCardProps) {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const mediaQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      setIsDesktop(event.matches);
    };

    setIsDesktop(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  if (isDesktop) {
    return (
      <DogzillaDesktopCard
        deviceState={deviceState}
        deviceIndex={deviceIndex}
        videoSources={videoSources}
        ov5647Sources={ov5647Sources}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-[28rem] sm:max-w-[32rem]">
      <DogzillaDashboard
        deviceState={deviceState}
        refreshToken={deviceIndex}
      />
    </div>
  );
});

export default DogzillaCard;
