import { useRef, useState } from 'react';
import type { FrameEntry } from '@/api/frame-parser';
import type { usbvideo } from '@/api/proto.js';
import { useElementFullscreen } from '@/hooks';
import CameraHudControls, { type CameraLayoutMode } from '@/usbvideo/CameraHudControls';
import CameraViewer from '@/usbvideo/CameraViewer';
import { getVideoSourceId, getVideoSourceLabel } from '@/usbvideo/camera-source';

interface CameraSurfaceProps {
  videoSources: readonly FrameEntry<usbvideo.IRxEnvelope>[];
  desktopAspectRatio?: boolean;
}

const CameraSurface: React.FC<CameraSurfaceProps> = ({
  videoSources,
  desktopAspectRatio = false,
}) => {
  const [cameraLayout, setCameraLayout] = useState<CameraLayoutMode>('pip');
  const [areCamerasSwapped, setAreCamerasSwapped] = useState(false);
  const surfaceRef = useRef<HTMLElement>(null);
  const { isFullscreen, toggleFullscreen } = useElementFullscreen(surfaceRef);
  const hasCameraPair = videoSources.length === 2;
  const hasCameraGrid = videoSources.length > 2;
  const orderedVideoSources = areCamerasSwapped && hasCameraPair
    ? [videoSources[1], videoSources[0], ...videoSources.slice(2)]
    : videoSources;
  const primaryVideoSource = orderedVideoSources[0];
  const secondaryVideoSource = orderedVideoSources[1];
  const isSplitLayout = hasCameraPair && cameraLayout !== 'pip';
  const isStackedLayout = cameraLayout === 'stacked';
  const contentHeightClass = desktopAspectRatio
    ? 'min-h-[28rem] xl:min-h-0'
    : 'min-h-[28rem]';

  const renderCamera = (
    videoSource: FrameEntry<usbvideo.IRxEnvelope>,
    overlay: 'none' | 'fps' = 'fps',
  ) => (
    <figure
      key={videoSource.queueId}
      className="relative h-full min-h-0 min-w-0 overflow-hidden bg-surface-primary"
    >
      <CameraViewer
        sourceId={getVideoSourceId(videoSource)}
        className="h-full w-full"
        overlay={overlay}
      />
      <figcaption className="absolute bottom-0 left-0 max-w-full rounded-tr-lg bg-surface-secondary/80 px-3 py-2 text-xs font-medium text-text-primary backdrop-blur-sm">
        <span className="block truncate">{getVideoSourceLabel(videoSource)}</span>
      </figcaption>
    </figure>
  );

  return (
    <section
      ref={surfaceRef}
      aria-label="Cameras"
      className={`relative flex-1 overflow-hidden rounded-lg border border-border-default bg-black ${
        desktopAspectRatio ? 'min-h-[28rem] xl:aspect-video xl:min-h-0' : 'min-h-[28rem]'
      } ${
        isFullscreen ? 'h-screen' : ''
      }`}
    >
      {hasCameraGrid ? (
        <div className={`grid h-full w-full grid-cols-1 gap-px bg-border-default lg:grid-cols-2 ${contentHeightClass}`}>
          {orderedVideoSources.map((videoSource) => renderCamera(videoSource))}
        </div>
      ) : isSplitLayout && secondaryVideoSource ? (
        <div className={`grid h-full w-full ${contentHeightClass} ${
          isStackedLayout ? 'grid-rows-2' : 'grid-rows-2 sm:grid-cols-2 sm:grid-rows-1'
        }`}>
          <div className={`min-h-0 min-w-0 border-border-default ${
            isStackedLayout ? 'border-b' : 'border-b sm:border-b-0 sm:border-r'
          }`}>
            {renderCamera(primaryVideoSource)}
          </div>
          {renderCamera(secondaryVideoSource)}
        </div>
      ) : (
        <div className={`h-full w-full ${contentHeightClass}`}>
          {renderCamera(primaryVideoSource)}
          {secondaryVideoSource && (
            <div className="absolute bottom-4 right-4 z-30 h-[34%] min-h-[9rem] w-[36%] min-w-[16rem] max-w-[26rem] overflow-hidden rounded-lg border-2 border-border-default bg-surface-primary shadow-2xl">
              {renderCamera(secondaryVideoSource, 'none')}
            </div>
          )}
        </div>
      )}
      <CameraHudControls
        cameraLayout={cameraLayout}
        showMultiCameraControls={hasCameraPair}
        hasMotors={false}
        showMotorData={false}
        isFullscreen={isFullscreen}
        canSwapCameras={hasCameraPair}
        onSetPipLayout={() => setCameraLayout('pip')}
        onToggleSplitLayout={() => setCameraLayout((layout) => (
          layout === 'side-by-side' ? 'stacked' : 'side-by-side'
        ))}
        onSwapCameras={() => setAreCamerasSwapped((swapped) => !swapped)}
        onToggleMotorData={() => undefined}
        onToggleFullscreen={() => void toggleFullscreen()}
      />
    </section>
  );
};

export default CameraSurface;
