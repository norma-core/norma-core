import type { Frame } from '@/api/frame-parser';
import { useLiveSnapshot } from './useLiveSnapshot';

export function useInferenceState(): Frame | null {
  return useLiveSnapshot().frame;
}
