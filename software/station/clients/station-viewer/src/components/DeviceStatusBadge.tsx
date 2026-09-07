import type { ReactNode } from 'react';

const TONES = {
  success: 'border-accent-success text-accent-success',
  warning: 'border-accent-warning text-accent-warning',
  critical: 'border-accent-critical text-accent-critical',
};

interface DeviceStatusBadgeProps {
  tone: keyof typeof TONES;
  children: ReactNode;
}

function DeviceStatusBadge({ tone, children }: DeviceStatusBadgeProps) {
  return <span className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-4 uppercase ${TONES[tone]}`}>{children}</span>;
}

export default DeviceStatusBadge;
