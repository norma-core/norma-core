import type { FC } from 'react';
import { useElapsedSeconds } from '@/hooks';

function formatElapsedSeconds(seconds: number | null): string {
  if (seconds === null) {
    return 'N/A';
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

interface ConnectionUptimeProps {
  connectedAt: number | null;
}

const ConnectionUptime: FC<ConnectionUptimeProps> = ({ connectedAt }) => {
  return formatElapsedSeconds(useElapsedSeconds(connectedAt));
};

export default ConnectionUptime;
