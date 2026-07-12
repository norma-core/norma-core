import { useLiveSnapshot } from './useLiveSnapshot';

export function useLatestEntryId(): number | null {
  return useLiveSnapshot().latestEntryId;
}
