import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  memo,
} from 'react';
import HistoryTimelineTrack, { Tick } from './HistoryTimelineTrack';
import TickLabel from './TickLabel';
import { TimelineState, TimelineActions } from '../hooks/useTimelineState';
import { StartupMarker } from '../hooks/useStartupMarkers';
import { TagMarker } from '../hooks/useInferenceTags';

interface TimelineProps {
  state: TimelineState;
  actions: TimelineActions;
  startups?: StartupMarker[];
  tags?: TagMarker[];
}

const useFrameToPercent = (minFrame: number, maxFrame: number) => {
  return useCallback(
    (frame: number) => {
      const totalFrames = maxFrame - minFrame + 1;
      if (totalFrames <= 1) return 0;
      return ((frame - minFrame) / (totalFrames - 1)) * 100;
    },
    [minFrame, maxFrame],
  );
};

const TimelineTrackWithOverlay = memo(function TimelineTrackWithOverlay({
  minFrame,
  maxFrame,
  ticks,
  selectionRange,
  currentFrame,
  startups,
  tags,
  onMouseDown,
  onTagClick,
  tracksRef,
}: {
  minFrame: number;
  maxFrame: number;
  ticks: Tick[];
  selectionRange: { start: number; end: number } | null;
  currentFrame: number;
  startups: StartupMarker[];
  tags: TagMarker[];
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  onTagClick: (frame: number) => void;
  tracksRef: React.RefObject<HTMLDivElement | null>;
}) {
  const frameToPercent = useFrameToPercent(minFrame, maxFrame);

  return (
    <div
      className="relative"
      ref={tracksRef}
      onMouseDown={onMouseDown}
    >
      <HistoryTimelineTrack
        minFrame={minFrame}
        maxFrame={maxFrame}
        ticks={ticks}
      />

      {selectionRange && (
        <div
          className="absolute top-0 bottom-0 bg-timeline-selection/20 border-x-2 border-timeline-selection pointer-events-none"
          style={{
            left: `${frameToPercent(
              Math.min(selectionRange.start, selectionRange.end),
            )}%`,
            width: `${Math.abs(
              frameToPercent(selectionRange.end) -
                frameToPercent(selectionRange.start),
            )}%`,
          }}
        />
      )}

      {currentFrame >= minFrame && currentFrame <= maxFrame && (
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-timeline-cursor pointer-events-none"
          style={{ left: `${frameToPercent(currentFrame)}%` }}
        >
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-timeline-cursor border-2 border-text-primary" />
        </div>
      )}

      {startups.map((s) => {
        if (s.frame < minFrame || s.frame > maxFrame) return null;
        const percent = frameToPercent(s.frame);
        const labelAlign =
          percent < 10
            ? 'left-0 translate-x-0'
            : percent > 90
            ? 'right-0 translate-x-0 left-auto'
            : 'left-1/2 -translate-x-1/2';
        return (
          <div
            key={`startup-${s.startupId || s.appStartId}-${s.frame}`}
            className="absolute top-0 bottom-0 w-0.5 bg-accent-warning-deep pointer-events-none z-20"
            style={{ left: `${percent}%` }}
          >
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-accent-warning-deep" />
            <div
              className={`absolute -top-5 ${labelAlign} text-[10px] leading-none text-accent-warning font-mono whitespace-nowrap pointer-events-none`}
              title={`Startup #${s.startupId} @ ${s.frame} • app_start_id ${s.appStartId} • ${s.version} (${s.gitHash})`}
            >
              #{s.startupId}
            </div>
          </div>
        );
      })}

      {tags.map((t, idx) => {
        if (t.frame < minFrame || t.frame > maxFrame) return null;
        const percent = frameToPercent(t.frame);
        return (
          <div
            key={`tag-${idx}-${t.frame}-${t.tag}`}
            className="absolute top-0 bottom-0 w-0.5 bg-accent-data z-20 cursor-pointer"
            style={{ left: `${percent}%` }}
            title={`@ ${t.frame}: ${t.tag}`}
            onMouseDown={(e) => {
              e.stopPropagation();
              if (e.button === 0) onTagClick(t.frame);
            }}
          >
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-accent-data" />
          </div>
        );
      })}
    </div>
  );
});

const TickLabelsContainer = memo(function TickLabelsContainer({
  ticks,
  minFrame,
  maxFrame,
}: {
  ticks: Tick[];
  minFrame: number;
  maxFrame: number;
}) {
  const frameToPercent = useFrameToPercent(minFrame, maxFrame);
  const majorTicks = useMemo(() => ticks.filter((t) => t.isMajor), [ticks]);

  return (
    <div className="relative h-20 z-10 pointer-events-none mt-2">
      {majorTicks.map((tick) => (
        <TickLabel
          key={tick.frame}
          frame={tick.frame}
          framePercent={frameToPercent(tick.frame)}
        />
      ))}
    </div>
  );
});

const EMPTY_STARTUPS: StartupMarker[] = [];
const EMPTY_TAGS: TagMarker[] = [];

const Timeline: React.FC<TimelineProps> = ({
  state,
  actions,
  startups = EMPTY_STARTUPS,
  tags = EMPTY_TAGS,
}) => {
  const { currentFrame, range, originalRange, selection, isZoomed } = state;
  const { selectFrame, zoomToRange, resetZoom } = actions;

  const lastStartupFrame = useMemo(() => {
    if (startups.length === 0) return null;
    let max = -Infinity;
    for (const s of startups) {
      if (s.frame > max) max = s.frame;
    }
    return Number.isFinite(max) ? max : null;
  }, [startups]);

  const handleZoomFromLastStartup = useCallback(() => {
    if (lastStartupFrame === null) return;
    zoomToRange(lastStartupFrame, originalRange.max);
  }, [lastStartupFrame, originalRange.max, zoomToRange]);

  const [isDragging, setIsDragging] = useState(false);
  const [localSelection, setLocalSelection] = useState<{ start: number; end: number } | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);

  const tracksRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tracksRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setTrackWidth(entry.contentRect.width);
      }
    });

    resizeObserver.observe(tracksRef.current);
    setTrackWidth(tracksRef.current.offsetWidth);

    return () => resizeObserver.disconnect();
  }, []);

  const pixelToFrame = useCallback(
    (pixel: number) => {
      if (!tracksRef.current) return range.min;
      const rect = tracksRef.current.getBoundingClientRect();
      const percent = pixel / rect.width;
      const frame = Math.round(range.min + percent * (range.max - range.min));
      return Math.max(range.min, Math.min(range.max, frame));
    },
    [range.min, range.max],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const frame = pixelToFrame(e.nativeEvent.offsetX);
      setIsDragging(true);
      setLocalSelection({ start: frame, end: frame });
    },
    [pixelToFrame],
  );

  useEffect(() => {
    const handleWindowMouseMove = (e: MouseEvent) => {
      if (!isDragging || !tracksRef.current) return;
      const rect = tracksRef.current.getBoundingClientRect();
      const pixel = e.clientX - rect.left;
      const frame = pixelToFrame(pixel);
      setLocalSelection((prev) => (prev ? { ...prev, end: frame } : null));
    };

    const handleWindowMouseUp = () => {
      if (!isDragging) return;

      setIsDragging(false);

      if (localSelection) {
        const { start, end } = localSelection;
        if (Math.abs(start - end) < 2) {
          setLocalSelection(null);
          selectFrame(start);
        } else {
          zoomToRange(start, end);
          selectFrame(Math.max(start, end));
          setLocalSelection(null);
        }
      }
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleWindowMouseMove);
      window.addEventListener('mouseup', handleWindowMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [isDragging, localSelection, pixelToFrame, selectFrame, zoomToRange]);

  const ticks = useMemo(() => {
    const newTicks: Tick[] = [];
    const totalFrames = range.max - range.min + 1;

    if (totalFrames <= 1 || trackWidth === 0) return newTicks;

    const numMajorTicks = Math.max(
      2,
      Math.min(10, Math.floor(trackWidth / 100)),
    );
    const rangeSize = range.max - range.min;

    if (rangeSize <= 0) return newTicks;

    const powerOf10 = Math.pow(
      10,
      Math.floor(Math.log10(rangeSize / numMajorTicks)),
    );
    const majorTickStep = Math.max(
      1,
      Math.round(rangeSize / numMajorTicks / powerOf10) * powerOf10,
    );

    if (majorTickStep === 0) return [];

    const firstMajor = Math.ceil(range.min / majorTickStep) * majorTickStep;
    for (let major = firstMajor; major <= range.max; major += majorTickStep) {
      if (major >= range.min) {
        newTicks.push({ frame: major, isMajor: true });
      }
    }

    const minorTickStep = majorTickStep / 10;
    if (minorTickStep > 0) {
      const firstMinor = Math.ceil(range.min / minorTickStep) * minorTickStep;
      for (let minor = firstMinor; minor <= range.max; minor += minorTickStep) {
        if (minor >= range.min && minor % majorTickStep !== 0) {
          newTicks.push({ frame: minor, isMajor: false });
        }
      }
    }

    return newTicks;
  }, [range.min, range.max, trackWidth]);

  const displaySelection = localSelection || selection;

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 mb-5">
        {isZoomed && (
          <button
            onClick={resetZoom}
            className="px-2 py-1 text-xs bg-surface-tertiary hover:bg-surface-elevated active:bg-surface-active active:scale-95 text-text-primary rounded border border-border-subtle transition-transform cursor-pointer"
          >
            Reset Zoom
          </button>
        )}
        {lastStartupFrame !== null && (
          <button
            onClick={handleZoomFromLastStartup}
            className="px-2 py-1 text-xs rounded border border-accent-warning-deep bg-accent-warning-deep text-text-primary hover:bg-accent-warning transition-colors"
          >
            From last startup
          </button>
        )}
      </div>

      <div className="w-full relative">
        <TimelineTrackWithOverlay
          minFrame={range.min}
          maxFrame={range.max}
          ticks={ticks}
          selectionRange={displaySelection}
          currentFrame={currentFrame}
          startups={startups}
          tags={tags}
          onMouseDown={handleMouseDown}
          onTagClick={selectFrame}
          tracksRef={tracksRef}
        />

        <TickLabelsContainer
          ticks={ticks}
          minFrame={range.min}
          maxFrame={range.max}
        />
      </div>
    </div>
  );
};

export default Timeline;
