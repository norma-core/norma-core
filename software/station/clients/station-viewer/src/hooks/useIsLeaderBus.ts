import { useRef } from 'react';
import type { st3215 } from '@/api/proto.js';
import { isLeaderBus } from '@/st3215/bus-role';

/**
 * Leader/follower role of a bus, decided from the motors' reported supply
 * voltage and remembered across frames that carry no voltage reading, so a
 * missed read cycle does not swap the rendered URDF back and forth.
 */
export function useIsLeaderBus(
  motors: st3215.InferenceState.IMotorState[] | null | undefined,
): boolean {
  const roleRef = useRef(false);
  roleRef.current = isLeaderBus(motors, roleRef.current);
  return roleRef.current;
}
