import { useRef } from 'react';
import type { st3215 } from '@/api/proto.js';
import { type BusRole, resolveBusRole } from '@/st3215/bus-role';

/**
 * Bus role from the supply voltage, kept across frames without a reading.
 * Null until the first frame that carries one.
 */
export function useBusRole(
  motors: st3215.InferenceState.IMotorState[] | null | undefined,
): BusRole | null {
  const roleRef = useRef<BusRole | null>(null);
  roleRef.current = resolveBusRole(motors, roleRef.current);
  return roleRef.current;
}
