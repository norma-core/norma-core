import { useLiveSnapshot } from '@/hooks/useLiveSnapshot';

export function useLatestEntryId(): number | null {
  return useLiveSnapshot().latestEntryId;
}
