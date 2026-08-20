import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type SyntheticEvent,
} from 'react';
import { Check, Clipboard, SquareTerminal, X } from 'lucide-react';
import { copyToClipboard } from '@/api/clipboard-utils';
import webSocketManager from '@/api/websocket';
import type { TagMarker } from '@/utils/inference-tags';
import {
  buildDatasetGeneratorCommand,
  validateDatasetGeneratorParams,
  type DatasetGeneratorParams,
} from './dataset-export';
import { hasDatasetData } from './dataset-export-preflight';

interface DatasetExportHelperProps {
  tags: TagMarker[];
}

type CopyState = 'idle' | 'copied' | 'error';

const INPUT_CLASSES = 'min-h-11 w-full rounded border border-border-subtle bg-surface-primary px-3 py-2 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent-data disabled:cursor-not-allowed disabled:text-text-muted';
const LABEL_CLASSES = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-label';

function tagIdentity(tag: TagMarker): string {
  return JSON.stringify([tag.frame, tag.tag]);
}

function parseWholeNumber(value: string): number {
  return /^\d+$/.test(value) ? Number(value) : Number.NaN;
}

function defaultRobotAddress(): string {
  return window.location.hostname;
}

function DatasetExportHelper({ tags }: DatasetExportHelperProps) {
  const selectableTags = useMemo(() => (
    [...tags].sort((left, right) => left.frame - right.frame || left.tag.localeCompare(right.tag))
  ), [tags]);
  const tagsById = useMemo(() => new Map(
    selectableTags.map((tag) => [tagIdentity(tag), tag]),
  ), [selectableTags]);

  const [fromTagId, setFromTagId] = useState('');
  const [toTagId, setToTagId] = useState('');
  const [robot, setRobot] = useState(defaultRobotAddress);
  const [queue, setQueue] = useState('inference/normvla');
  const [output, setOutput] = useState('~/datasets/dataset');
  const [task, setTask] = useState('');
  const [episodeDuration, setEpisodeDuration] = useState('45');
  const [episodeMinCommands, setEpisodeMinCommands] = useState('100');
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [availabilityWarning, setAvailabilityWarning] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const copyResetRef = useRef<number | null>(null);

  useEffect(() => {
    setFromTagId((current) => {
      if (tagsById.has(current)) return current;
      return selectableTags[0] ? tagIdentity(selectableTags[0]) : '';
    });
    setToTagId((current) => {
      if (tagsById.has(current)) return current;
      return selectableTags.length > 1
        ? tagIdentity(selectableTags[selectableTags.length - 1])
        : '';
    });
  }, [selectableTags, tagsById]);

  useEffect(() => () => {
    if (copyResetRef.current !== null) {
      window.clearTimeout(copyResetRef.current);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();

    return () => {
      if (dialog.open) {
        dialog.close();
      }
    };
  }, [isOpen]);

  const fromTag = tagsById.get(fromTagId);
  const toTag = tagsById.get(toTagId);

  const params: DatasetGeneratorParams | null = fromTag && toTag ? {
    robot,
    queue,
    from: fromTag.frame,
    to: toTag.frame,
    output,
    task,
    episodeDuration: parseWholeNumber(episodeDuration),
    episodeMinCommands: parseWholeNumber(episodeMinCommands),
  } : null;

  const errors = params
    ? validateDatasetGeneratorParams(params)
    : [selectableTags.length < 2
      ? 'Add at least two tags to define an export range.'
      : 'Choose both a start tag and an end tag.'];
  const command = params && errors.length === 0
    ? buildDatasetGeneratorCommand(params)
    : '';
  const availabilityFrom = fromTag?.frame ?? null;
  const availabilityTo = toTag?.frame ?? null;

  useEffect(() => {
    setAvailabilityWarning(null);

    if (
      !isOpen
      || availabilityFrom === null
      || availabilityTo === null
      || availabilityFrom >= availabilityTo
      || queue.trim().length === 0
    ) {
      return;
    }

    let isCurrent = true;

    void hasDatasetData(
      webSocketManager.normFs,
      queue,
      availabilityFrom,
      availabilityTo,
    ).then((hasData) => {
      if (isCurrent && !hasData) {
        setAvailabilityWarning(`Queue ${queue.trim()} has no data in the selected range.`);
      }
    }).catch(() => {
      if (isCurrent) {
        setAvailabilityWarning('Could not validate queue data. The command can still be copied.');
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [
    availabilityFrom,
    availabilityTo,
    isOpen,
    queue,
  ]);

  const handleCopy = async () => {
    if (!command) return;

    try {
      await copyToClipboard(command);
      setCopyState('copied');
    } catch (error) {
      console.error('Failed to copy dataset-generator command:', error);
      setCopyState('error');
    }

    if (copyResetRef.current !== null) {
      window.clearTimeout(copyResetRef.current);
    }
    copyResetRef.current = window.setTimeout(() => setCopyState('idle'), 2000);
  };

  const handleDialogClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) {
      setIsOpen(false);
    }
  };

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement, Event>) => {
    event.preventDefault();
    setIsOpen(false);
  };

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setIsOpen(true)}
        className="inline-flex h-[26px] w-auto self-end cursor-pointer items-center justify-center gap-1.5 rounded border border-accent-data/50 bg-accent-data/10 px-2 py-1 text-xs font-semibold text-accent-data transition-colors hover:bg-accent-data/20 active:bg-accent-data/30 sm:self-auto sm:border-0 sm:ring-1 sm:ring-inset sm:ring-accent-data/50"
      >
        <SquareTerminal className="h-3.5 w-3.5" aria-hidden="true" />
        Export dataset
        <span className="rounded bg-surface-primary px-1 text-[10px] leading-4 font-mono text-text-label">
          {selectableTags.length} {selectableTags.length === 1 ? 'tag' : 'tags'}
        </span>
      </button>

      {isOpen && (
        <dialog
          ref={dialogRef}
          aria-labelledby="dataset-export-title"
          aria-describedby="dataset-export-description"
          onCancel={handleCancel}
          onClick={handleDialogClick}
          className="dataset-export-dialog m-0 mt-auto max-h-[92svh] w-full max-w-none overflow-hidden border-0 bg-transparent p-0 text-text-primary backdrop:bg-surface-overlay-light sm:m-auto sm:max-h-[calc(100svh-3rem)] sm:w-[calc(100vw-3rem)] sm:max-w-4xl"
        >
          <form
            onSubmit={(event) => event.preventDefault()}
            className="flex h-[92svh] flex-col overflow-hidden rounded-t-xl border border-border-default bg-surface-secondary shadow-2xl sm:h-auto sm:max-h-[calc(100svh-3rem)] sm:rounded-lg"
          >
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border-default px-4 py-3 sm:px-5 sm:py-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="shrink-0 rounded border border-accent-data/40 bg-accent-data/10 p-2 text-accent-data">
                  <SquareTerminal className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 id="dataset-export-title" className="truncate text-sm font-semibold text-text-primary sm:text-base">
                      Dataset Export
                    </h2>
                    <span className="shrink-0 rounded border border-border-subtle bg-surface-primary px-1.5 py-0.5 text-[11px] font-mono text-text-label">
                      {selectableTags.length} {selectableTags.length === 1 ? 'tag' : 'tags'}
                    </span>
                  </div>
                  <p id="dataset-export-description" className="mt-0.5 truncate text-xs text-text-label">
                    Generate a dataset-generator command from two tag markers
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close dataset export"
                onClick={() => setIsOpen(false)}
                className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded border border-border-subtle bg-surface-primary text-text-label transition-colors hover:bg-surface-elevated hover:text-text-primary"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overscroll-contain overflow-y-auto p-4 sm:p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label>
                  <span className={LABEL_CLASSES}>Start tag</span>
                  <select
                    value={fromTagId}
                    onChange={(event) => setFromTagId(event.currentTarget.value)}
                    disabled={selectableTags.length === 0}
                    className={`${INPUT_CLASSES} font-mono`}
                  >
                    <option value="">Select start tag</option>
                    {selectableTags.map((tag) => {
                      const identity = tagIdentity(tag);
                      return (
                        <option key={`from-${identity}`} value={identity}>
                          {tag.tag || '(untitled)'} — {tag.frame.toLocaleString()}
                        </option>
                      );
                    })}
                  </select>
                </label>

                <label>
                  <span className={LABEL_CLASSES}>End tag</span>
                  <select
                    value={toTagId}
                    onChange={(event) => setToTagId(event.currentTarget.value)}
                    disabled={selectableTags.length < 2}
                    className={`${INPUT_CLASSES} font-mono`}
                  >
                    <option value="">Select end tag</option>
                    {selectableTags.map((tag) => {
                      const identity = tagIdentity(tag);
                      return (
                        <option key={`to-${identity}`} value={identity}>
                          {tag.tag || '(untitled)'} — {tag.frame.toLocaleString()}
                        </option>
                      );
                    })}
                  </select>
                </label>

                <label>
                  <span className={LABEL_CLASSES}>Robot address</span>
                  <input
                    type="text"
                    value={robot}
                    onChange={(event) => setRobot(event.currentTarget.value)}
                    placeholder="192.168.0.10"
                    spellCheck={false}
                    className={`${INPUT_CLASSES} font-mono`}
                  />
                </label>

                <label>
                  <span className={LABEL_CLASSES}>Queue</span>
                  <input
                    type="text"
                    value={queue}
                    onChange={(event) => setQueue(event.currentTarget.value)}
                    placeholder="inference/normvla"
                    spellCheck={false}
                    className={`${INPUT_CLASSES} font-mono`}
                  />
                </label>

                <label className="sm:col-span-2">
                  <span className={LABEL_CLASSES}>Output path</span>
                  <input
                    type="text"
                    value={output}
                    onChange={(event) => setOutput(event.currentTarget.value)}
                    placeholder="~/datasets/dataset-cube"
                    spellCheck={false}
                    className={`${INPUT_CLASSES} font-mono`}
                  />
                </label>

                <label className="sm:col-span-2">
                  <span className={LABEL_CLASSES}>Task description</span>
                  <input
                    type="text"
                    value={task}
                    onChange={(event) => setTask(event.currentTarget.value)}
                    placeholder="put the cube inside box"
                    className={INPUT_CLASSES}
                  />
                </label>

                <label>
                  <span className={LABEL_CLASSES}>Episode duration, seconds</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={episodeDuration}
                    onChange={(event) => setEpisodeDuration(event.currentTarget.value)}
                    className={`${INPUT_CLASSES} font-mono`}
                  />
                </label>

                <label>
                  <span className={LABEL_CLASSES}>Minimum commands</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={episodeMinCommands}
                    onChange={(event) => setEpisodeMinCommands(event.currentTarget.value)}
                    className={`${INPUT_CLASSES} font-mono`}
                  />
                </label>
              </div>

              {errors.length > 0 && (
                <p role="alert" className="mt-4 text-xs font-semibold text-accent-warning">
                  {errors[0]}
                </p>
              )}

              {availabilityWarning && (
                <p role="alert" className="mt-4 text-xs font-semibold text-accent-warning">
                  {availabilityWarning}
                </p>
              )}

              <div className="mt-4">
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-label">
                  Command preview
                </div>
                <pre className="min-h-28 max-h-56 overflow-auto whitespace-pre rounded border border-border-subtle bg-surface-primary p-3 text-xs leading-5 text-text-secondary">
                  <code>{command || 'Complete the required fields to generate a command.'}</code>
                </pre>
              </div>
            </div>

            <footer className="flex shrink-0 flex-col gap-2 border-t border-border-default px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:px-5 sm:pb-4">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded border border-border-subtle bg-surface-primary px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-elevated"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => void handleCopy()}
                disabled={!command}
                className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded border border-accent-data/50 bg-accent-data/10 px-4 py-2 text-sm font-semibold text-accent-data transition-colors hover:bg-accent-data/20 disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-surface-elevated disabled:text-text-muted"
              >
                {copyState === 'copied' ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Clipboard className="h-4 w-4" aria-hidden="true" />
                )}
                {copyState === 'copied'
                  ? 'Copied'
                  : copyState === 'error'
                  ? 'Copy failed'
                  : 'Copy command'}
              </button>
            </footer>
          </form>
        </dialog>
      )}
    </>
  );
}

export default DatasetExportHelper;
