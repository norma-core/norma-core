import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import Long from 'long';
import { Activity, X } from 'lucide-react';
import type { FrameEntry } from '@/api/frame-parser';
import { serverToLocal } from '@/api/timestamp-utils';
import { pwm_output, usbvideo, vesc_trampa, victron_smartsolar_mppt } from '@/api/proto.js';
import { useElementFullscreen } from '@/hooks';
import { parseVescTrampaValuesPayload } from '@/devices/vesc-trampa/values-parser';
import { formatVescTrampaUuid, shortVescTrampaUuid } from '@/devices/vesc-trampa/utils';
import {
  EMPTY_STATE,
  applyEnvelope,
  type VictronState,
} from '@/devices/victron-smartsolar-mppt/values';
import { useRoverControlSession } from '../useRoverControlSession';
import RoverCameraViewport from './RoverCameraViewport';
import RoverDriveControls from './RoverDriveControls';
import RoverDriveSummary from './RoverDriveSummary';
import RoverEnergyFlow from './RoverEnergyFlow';
import RoverTelemetryDetails from './RoverTelemetryDetails';

const EMPTY_UUID = new Uint8Array();

interface BoardOption {
  key: string;
  label: string;
  uuid: Uint8Array;
  state: vesc_trampa.InferenceState.IBoardState;
}

export interface VescPwmOutputControlPanelProps {
  vesc: vesc_trampa.IInferenceState;
  pwmOutputRx?: pwm_output.IRxEnvelope;
  pwmOutputTx?: pwm_output.ITxEnvelope;
  videoSources?: FrameEntry<usbvideo.IRxEnvelope>[];
  powerSources?: FrameEntry<victron_smartsolar_mppt.IRxEnvelope>[];
}

function outputIdsFromFrame(
  rx?: pwm_output.IRxEnvelope,
  tx?: pwm_output.ITxEnvelope,
): string[] {
  return [
    rx?.device?.id,
    rx?.state?.id,
    rx?.command?.targetOutputId,
    rx?.command?.command?.targetOutputId,
    tx?.targetOutputId,
    tx?.command?.targetOutputId,
  ]
    .map((value) => value?.trim() ?? '')
    .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
}

function boardOptionsFromState(vesc: vesc_trampa.IInferenceState): BoardOption[] {
  return (vesc.boards ?? [])
    .map((state, index) => {
      const board = state.board;
      const uuid = board?.uuid ?? EMPTY_UUID;
      const uuidKey = uuid.length > 0 ? formatVescTrampaUuid(uuid) : '';
      return {
        key: uuidKey || board?.portName || String(index),
        label: uuid.length > 0 ? shortVescTrampaUuid(uuid) : board?.portName || `board-${index + 1}`,
        uuid,
        state,
      };
    })
    .filter((board) => board.uuid.length > 0);
}

function formatAge(stampNs: Long | number | null | undefined): { label: string; stale: boolean } {
  if (!stampNs) return { label: '--', stale: true };
  const localStamp = serverToLocal(Long.fromValue(stampNs));
  const ageMs = Math.max(0, Date.now() - localStamp.toNumber() / 1e6);
  return {
    label: ageMs < 1000 ? `${ageMs.toFixed(0)}ms` : `${(ageMs / 1000).toFixed(1)}s`,
    stale: ageMs > 5000,
  };
}

const VescPwmOutputControlPanel = memo(function VescPwmOutputControlPanel({
  vesc,
  pwmOutputRx,
  pwmOutputTx,
  videoSources = [],
  powerSources = [],
}: VescPwmOutputControlPanelProps) {
  const rootRef = useRef<HTMLElement>(null);
  const powerAppStartRef = useRef('');
  const { isFullscreen, toggleFullscreen } = useElementFullscreen(rootRef);
  const boards = useMemo(() => boardOptionsFromState(vesc), [vesc]);
  const outputIds = useMemo(
    () => outputIdsFromFrame(pwmOutputRx, pwmOutputTx),
    [pwmOutputRx, pwmOutputTx],
  );
  const [selectedBoardKey, setSelectedBoardKey] = useState('');
  const [selectedOutputId, setSelectedOutputId] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [powerState, setPowerState] = useState<VictronState>(EMPTY_STATE);

  const selectedBoard = boards.find((board) => board.key === selectedBoardKey)
    ?? boards[0]
    ?? null;
  const selectedBoardKeyValue = selectedBoard?.key ?? '';
  const selectedOutputIdValue = outputIds.includes(selectedOutputId)
    ? selectedOutputId
    : outputIds[0] ?? '';
  const valuesResult = useMemo(
    () => parseVescTrampaValuesPayload(selectedBoard?.state.valuesPayload),
    [selectedBoard?.state.valuesPayload],
  );
  const values = valuesResult.values;
  const valuesAge = formatAge(selectedBoard?.state.valuesMonotonicStampNs);
  const faultCode = values?.faultCode ?? 0;
  const hasFault = faultCode !== 0 || Boolean(pwmOutputRx?.error) || Boolean(valuesResult.error);

  const controlSession = useRoverControlSession({
    boardUuid: selectedBoard?.uuid ?? EMPTY_UUID,
    steeringOutputId: selectedOutputIdValue,
    suspended: detailsOpen,
  });
  const controlTargetKey = `${selectedBoardKeyValue}\u0000${selectedOutputIdValue}`;
  const previousControlTargetKeyRef = useRef(controlTargetKey);
  const ready = controlSession.state.canSendDrive
    && controlSession.state.canSendSteering
    && !valuesAge.stale
    && !hasFault;

  useEffect(() => {
    if (!boards.some((board) => board.key === selectedBoardKey)) {
      setSelectedBoardKey(boards[0]?.key ?? '');
    }
  }, [boards, selectedBoardKey]);

  useEffect(() => {
    if (!outputIds.includes(selectedOutputId)) {
      setSelectedOutputId(outputIds[0] ?? '');
    }
  }, [outputIds, selectedOutputId]);

  useEffect(() => {
    if (previousControlTargetKeyRef.current !== controlTargetKey) {
      controlSession.actions.stop();
      previousControlTargetKeyRef.current = controlTargetKey;
    }
  }, [controlSession.actions, controlTargetKey]);

  useEffect(() => {
    const envelope = powerSources[0]?.data;
    if (!envelope) return;
    const appStart = envelope.appStartId?.toString() ?? '';
    const reset = powerAppStartRef.current !== appStart;
    powerAppStartRef.current = appStart;
    setPowerState((current) => applyEnvelope(reset ? EMPTY_STATE : current, envelope));
  }, [powerSources]);

  const openDetails = useCallback(() => {
    controlSession.actions.stop();
    setDetailsOpen(true);
  }, [controlSession.actions]);

  const handleFullscreenToggle = useCallback(() => {
    void toggleFullscreen();
  }, [toggleFullscreen]);

  const handleBoardChange = useCallback((nextBoardKey: string) => {
    controlSession.actions.stop();
    setSelectedBoardKey(nextBoardKey);
  }, [controlSession.actions]);

  const handleOutputChange = useCallback((nextOutputId: string) => {
    controlSession.actions.stop();
    setSelectedOutputId(nextOutputId);
  }, [controlSession.actions]);

  return (
    <section
      ref={rootRef}
      aria-label="Rover control"
      style={{
        '--rover-landscape-left-zone': 'min(15.25rem, 29vw, calc(100svh - 8.5rem))',
        '--rover-landscape-power-zone': 'min(5.75rem, 12vw)',
        '--rover-landscape-right-safe-zone': 'min(6.75rem, 16vw)',
      } as CSSProperties}
      className="group/dashboard relative isolate h-[calc(100svh-8.6rem)] min-h-[35rem] w-full overflow-hidden bg-surface-base text-text-primary lg:h-[min(84vh,58rem)] lg:min-h-[42rem] lg:rounded-lg lg:border lg:border-border-default [@media(max-width:1023px)_and_(orientation:landscape)]:min-h-[15rem] [@media(max-width:1023px)_and_(orientation:landscape)]:rounded-none [&:fullscreen]:!fixed [&:fullscreen]:!inset-0 [&:fullscreen]:!z-[60] [&:fullscreen]:!m-0 [&:fullscreen]:!h-[100svh] [&:fullscreen]:!min-h-0 [&:fullscreen]:!w-screen [&:fullscreen]:!rounded-none [&:fullscreen]:!border-0"
    >
      <div className="grid h-full grid-rows-[minmax(15rem,1fr)_minmax(20rem,48%)] lg:grid-cols-[minmax(0,1fr)_25rem] lg:grid-rows-1 [@media(max-width:1023px)_and_(orientation:landscape)]:block">
        <RoverCameraViewport
          videoSources={videoSources}
          status={{
            ready,
            hasFault,
            boardLabel: selectedBoard?.label ?? '',
            outputLabel: selectedOutputIdValue,
          }}
          isFullscreen={isFullscreen}
          onOpenDetails={openDetails}
          onToggleFullscreen={handleFullscreenToggle}
        />

        <aside className="relative flex min-h-0 flex-col border-t border-border-default bg-surface-primary/95 lg:border-l lg:border-t-0 [@media(max-width:1023px)_and_(orientation:landscape)]:pointer-events-none [@media(max-width:1023px)_and_(orientation:landscape)]:absolute [@media(max-width:1023px)_and_(orientation:landscape)]:inset-0 [@media(max-width:1023px)_and_(orientation:landscape)]:z-30 [@media(max-width:1023px)_and_(orientation:landscape)]:border-0 [@media(max-width:1023px)_and_(orientation:landscape)]:bg-transparent">
          <div className="shrink-0 border-b border-border-default bg-surface-secondary/45 px-3 py-2.5 [@media(max-width:1023px)_and_(orientation:landscape)]:pointer-events-auto [@media(max-width:1023px)_and_(orientation:landscape)]:absolute [@media(max-width:1023px)_and_(orientation:landscape)]:left-[calc(1rem+env(safe-area-inset-left)+var(--rover-landscape-left-zone))] [@media(max-width:1023px)_and_(orientation:landscape)]:right-[calc(1.5rem+env(safe-area-inset-right)+var(--rover-landscape-right-safe-zone))] [@media(max-width:1023px)_and_(orientation:landscape)]:top-[calc(0.5rem+env(safe-area-inset-top))] [@media(max-width:1023px)_and_(orientation:landscape)]:border-0 [@media(max-width:1023px)_and_(orientation:landscape)]:bg-transparent [@media(max-width:1023px)_and_(orientation:landscape)]:p-0">
            <div className="[@media(max-width:1023px)_and_(orientation:landscape)]:mx-auto [@media(max-width:1023px)_and_(orientation:landscape)]:max-w-96 [@media(max-width:1023px)_and_(orientation:landscape)]:rounded-md [@media(max-width:1023px)_and_(orientation:landscape)]:border [@media(max-width:1023px)_and_(orientation:landscape)]:border-accent-data/30 [@media(max-width:1023px)_and_(orientation:landscape)]:bg-black/72 [@media(max-width:1023px)_and_(orientation:landscape)]:px-3 [@media(max-width:1023px)_and_(orientation:landscape)]:py-1.5 [@media(max-width:1023px)_and_(orientation:landscape)]:shadow-[0_0.6rem_1.5rem_rgba(0,0,0,0.28)] [@media(max-width:1023px)_and_(orientation:landscape)]:backdrop-blur-md">
              <RoverEnergyFlow
                values={powerState.textValues}
                fallbackBatteryVoltageV={values?.inputVoltageV}
                linkLabel={valuesAge.label}
                linkStale={valuesAge.stale}
              />
            </div>
          </div>

          <RoverDriveSummary
            values={values}
            ready={ready}
            hasFault={hasFault}
            ageLabel={valuesAge.label}
          />

          <RoverDriveControls session={controlSession} onOpenDetails={openDetails} />
        </aside>
      </div>

      {detailsOpen && (
        <div className="absolute inset-0 z-[70] overflow-y-auto bg-surface-primary/98 text-text-primary backdrop-blur-xl">
          <div className="sticky top-0 z-20 border-b border-border-default bg-surface-primary/92 px-4 py-3 backdrop-blur-xl sm:px-6">
            <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.14em]"><Activity className="h-4 w-4 text-accent-data" />Rover status</div>
                <div className="mt-1 font-mono text-[10px] text-text-muted">Live drivetrain, steering and power diagnostics</div>
              </div>
              <button type="button" onClick={() => setDetailsOpen(false)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border-default bg-surface-secondary/60 text-text-secondary transition hover:border-accent-data hover:text-accent-data" aria-label="Close rover status">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="mx-auto max-w-3xl px-4 pb-8 pt-4 sm:px-6 sm:pt-5">
            <section className="mb-4 border-b border-border-default pb-4">
              <h3 className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-accent-data">Control targets</h3>
              <div className="grid gap-x-8 md:grid-cols-2">
                <label className="block py-2.5">
                  <span className="mb-1.5 block text-[9px] font-semibold uppercase tracking-[0.12em] text-text-muted">Drive board</span>
                  <select value={selectedBoardKeyValue} onChange={(event) => handleBoardChange(event.target.value)} className="h-10 w-full rounded-md border border-border-default bg-surface-secondary/60 px-3 font-mono text-xs text-text-primary outline-none focus:border-accent-data focus:ring-1 focus:ring-accent-data">
                    {boards.map((board) => <option key={board.key} value={board.key}>{board.label}</option>)}
                  </select>
                </label>
                <label className="block py-2.5">
                  <span className="mb-1.5 block text-[9px] font-semibold uppercase tracking-[0.12em] text-text-muted">Steering output</span>
                  <select value={selectedOutputIdValue} onChange={(event) => handleOutputChange(event.target.value)} className="h-10 w-full rounded-md border border-border-default bg-surface-secondary/60 px-3 font-mono text-xs text-text-primary outline-none focus:border-accent-data focus:ring-1 focus:ring-accent-data">
                    {outputIds.map((outputId) => <option key={outputId} value={outputId}>{outputId}</option>)}
                  </select>
                </label>
              </div>
            </section>
            <RoverTelemetryDetails
              boardState={selectedBoard?.state ?? null}
              values={values}
              valuesError={valuesResult.error}
              pwmOutputRx={pwmOutputRx}
              pwmOutputTx={pwmOutputTx}
              powerState={powerState}
              powerEnvelope={powerSources[0]?.data}
            />
          </div>
        </div>
      )}
    </section>
  );
});

export default VescPwmOutputControlPanel;
