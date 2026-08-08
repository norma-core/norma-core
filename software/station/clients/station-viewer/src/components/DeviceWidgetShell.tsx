import type { ReactNode } from 'react';

interface DeviceWidgetShellProps {
  title: string;
  subtitle: string;
  error?: string | null;
  children: ReactNode;
}

function DeviceWidgetShell({
  title,
  subtitle,
  error,
  children,
}: DeviceWidgetShellProps) {
  return (
    <section className="min-w-0 w-full max-w-[24rem] justify-self-start rounded-md border border-border-default bg-surface-secondary px-3 py-2 shadow-sm">
      <div className="mb-2 flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-text-primary" title={title}>{title}</div>
          <div className="truncate font-mono text-[11px] text-text-muted" title={subtitle}>{subtitle}</div>
        </div>
        {error && (
          <span className="rounded border border-accent-critical px-1.5 py-0.5 text-[10px] font-semibold uppercase text-accent-critical">
            Error
          </span>
        )}
      </div>
      {children}
      {error && (
        <div className="mt-2 truncate rounded bg-surface-primary px-2 py-1 text-xs text-accent-critical" title={error}>
          {error}
        </div>
      )}
    </section>
  );
}

export default DeviceWidgetShell;
