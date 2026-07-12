import { useEffect, useState } from 'react';

export function useElapsedSeconds(startedAt: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    if (startedAt === null) {
      return;
    }

    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [startedAt]);

  if (startedAt === null) {
    return null;
  }

  return Math.max(0, Math.floor((now - startedAt) / 1000));
}
