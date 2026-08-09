import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Clipboard, SquareTerminal } from 'lucide-react';
import { copyToClipboard } from '@/api/clipboard-utils';
import type { TagMarker } from '@/utils/inference-tags';
import {
  buildDatasetGeneratorCommand,
  validateDatasetGeneratorParams,
  type DatasetGeneratorParams,
} from './dataset-export';

interface DatasetExportHelperProps {
  tags: TagMarker[];
}

type CopyState = 'idle' | 'copied' | 'error';

const INPUT_CLASSES = 'w-full rounded border border-border-subtle bg-surface-primary px-3 py-2 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent-data disabled:cursor-not-allowed disabled:text-text-muted';
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
  const [isOpen, setIsOpen] = useState(true);
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

  return (
    <details
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      className="mt-4 overflow-hidden rounded-lg border border-border-default bg-surface-secondary"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 select-none [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-3">
          <span className="rounded border border-accent-data/40 bg-accent-data/10 p-2 text-accent-data">
            <SquareTerminal className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-text-primary">Dataset Export</span>
            <span className="block truncate text-xs text-text-label">
              Generate a dataset-generator command from two tag markers
            </span>
          </span>
        </span>
        <span className="shrink-0 rounded border border-border-subtle bg-surface-primary px-2 py-1 text-xs font-mono text-text-label">
          {selectableTags.length} {selectableTags.length === 1 ? 'tag' : 'tags'}
        </span>
      </summary>

      <div className="border-t border-border-default p-4">
        <div className="grid gap-4 md:grid-cols-2">
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

          <label className="md:col-span-2">
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

          <label className="md:col-span-2">
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

        <div className="mt-4 overflow-hidden rounded border border-border-subtle bg-surface-primary">
          <div className="flex items-center justify-between gap-3 border-b border-border-default px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-label">
              Command preview
            </span>
            <button
              type="button"
              onClick={() => void handleCopy()}
              disabled={!command}
              className="inline-flex cursor-pointer items-center gap-2 rounded border border-accent-data/50 bg-accent-data/10 px-3 py-1.5 text-xs font-semibold text-accent-data transition-colors hover:bg-accent-data/20 disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-surface-elevated disabled:text-text-muted"
            >
              {copyState === 'copied' ? (
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Clipboard className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {copyState === 'copied'
                ? 'Copied'
                : copyState === 'error'
                ? 'Copy failed'
                : 'Copy command'}
            </button>
          </div>
          <pre className="min-h-28 overflow-x-auto whitespace-pre p-3 text-xs leading-5 text-text-secondary">
            <code>{command || 'Complete the required fields to generate a command.'}</code>
          </pre>
        </div>
      </div>
    </details>
  );
}

export default DatasetExportHelper;
