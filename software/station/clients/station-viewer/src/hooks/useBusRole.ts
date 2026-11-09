import { useState } from 'react';
import type { st3215 } from '@/api/proto.js';
import { type BusRole, resolveBusRole } from '@/st3215/bus-role';

/**
 * Bus role from the supply voltage, kept across frames without a reading.
 * Null until the first frame that carries one.
 *
 * The previous role is state rather than a ref so that a render React throws
 * away cannot leak its result into the next one; setting state during render
 * is React's sanctioned way to carry information across renders.
 */
export function useBusRole(
  motors: st3215.InferenceState.IMotorState[] | null | undefined,
): BusRole | null {
  const [previous, setPrevious] = useState<BusRole | null>(null);
  const role = resolveBusRole(motors, previous);
  if (role !== previous) setPrevious(role);
  return role;
}
