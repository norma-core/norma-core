import { memo, useEffect, useState } from 'react';
import type { FrameEntry } from '@/api/frame-parser';
import { yahboom_dogzilla_lite, usbvideo } from '@/api/proto.js';
import YahboomDogzillaLiteDashboard from '@/yahboom_dogzilla_lite/YahboomDogzillaLiteDashboard';
import YahboomDogzillaLiteDesktopCard from '@/yahboom_dogzilla_lite/YahboomDogzillaLiteDesktopCard';

interface YahboomDogzillaLiteCardProps {
  deviceState: yahboom_dogzilla_lite.InferenceState.IDeviceState;
  deviceIndex: number;
  videoSources?: FrameEntry<usbvideo.IRxEnvelope>[];
}

const DESKTOP_MEDIA_QUERY = '(min-width: 1024px)';

const YahboomDogzillaLiteCard = memo(function YahboomDogzillaLiteCard({
  deviceState,
  deviceIndex,
  videoSources
}: YahboomDogzillaLiteCardProps) {
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
      <YahboomDogzillaLiteDesktopCard
        deviceState={deviceState}
        deviceIndex={deviceIndex}
        videoSources={videoSources}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-[28rem] sm:max-w-[32rem] [@media(max-width:1023px)_and_(orientation:landscape)]:max-w-none">
      <YahboomDogzillaLiteDashboard
        deviceState={deviceState}
        refreshToken={deviceIndex}
        videoSources={videoSources}
      />
    </div>
  );
});

export default YahboomDogzillaLiteCard;
