import { useEffect, useRef, useState, type FormEvent, type MouseEvent, type SyntheticEvent } from 'react';

interface TagDialogProps {
  entryId: number | null;
  defaultValue: string;
  error: string | null;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (tag: string) => void | Promise<void>;
}

function TagDialog({ entryId, defaultValue, error, isSubmitting, onClose, onSubmit }: TagDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(defaultValue);
  const canSubmit = entryId !== null && value.trim().length > 0 && !isSubmitting;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;

    dialog.showModal();

    return () => {
      if (dialog.open) {
        dialog.close();
      }
    };
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    void onSubmit(value.trim());
  };

  const handleDialogClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget && !isSubmitting) {
      onClose();
    }
  };

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement, Event>) => {
    if (isSubmitting) {
      event.preventDefault();
      return;
    }
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="tag-dialog-title"
      onCancel={handleCancel}
      onClick={handleDialogClick}
      className="m-auto w-[calc(100vw-2rem)] max-w-lg border-0 bg-transparent p-0 text-text-primary backdrop:bg-surface-overlay"
    >
      <form
        onSubmit={handleSubmit}
        className="rounded-lg border border-border-default bg-surface-secondary p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="tag-dialog-title" className="text-sm font-bold uppercase tracking-wide text-accent-secondary">
            Tag Current Pointer
          </h2>
          <span className="shrink-0 rounded border border-border-subtle bg-surface-primary px-2 py-1 text-xs font-mono text-accent-warning">
            {entryId?.toLocaleString() ?? 'N/A'}
          </span>
        </div>
        <label htmlFor="tag-input" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-label">
          Tag
        </label>
        <input
          id="tag-input"
          type="text"
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
          onFocus={(event) => event.currentTarget.select()}
          disabled={isSubmitting}
          autoComplete="off"
          autoFocus
          className="w-full rounded border border-border-subtle bg-surface-primary px-3 py-2 text-sm font-mono text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent-secondary disabled:cursor-wait disabled:text-text-muted"
        />
        {error && (
          <p role="alert" className="mt-3 text-xs font-semibold text-accent-critical">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="cursor-pointer rounded border border-border-subtle bg-surface-elevated px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-active disabled:cursor-wait disabled:text-text-muted"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            title={entryId === null ? 'No inference pointer available' : undefined}
            className="cursor-pointer rounded border border-accent-secondary bg-accent-secondary-bg px-4 py-2 text-sm font-bold text-text-primary transition-colors hover:bg-accent-secondary-deep disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-surface-elevated disabled:text-text-muted"
          >
            {isSubmitting ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export default TagDialog;
