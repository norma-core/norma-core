import type { VictronTextValues } from '@/modules/victron-smartsolar-mppt/values';

// Approximate 4S open-circuit curve for a rested battery at 0 A.
// Runtime display is intentionally rounded because load and charging shift terminal voltage.
const LIFEPO4_4S_VOLTAGE_CURVE = [
  [10.0, 0],
  [12.0, 9],
  [12.5, 14],
  [12.8, 17],
  [12.9, 20],
  [13.0, 30],
  [13.1, 40],
  [13.2, 70],
  [13.3, 90],
  [13.4, 99],
  [13.6, 100],
] as const;

function roundApproximateSoc(percent: number, voltageV: number): number {
  if (voltageV >= 13.6) return 100;
  return Math.min(95, Math.max(0, Math.round(percent / 5) * 5));
}

export type BatteryFlowMode = 'charging' | 'discharging' | 'idle' | 'unavailable';

export interface RoverEnergyState {
  batteryVoltageV: number | null;
  batteryCurrentA: number | null;
  batterySocPercent: number | null;
  batteryMode: BatteryFlowMode;
  panelVoltageV: number | null;
  solarPowerW: number | null;
  loadCurrentA: number | null;
  loadPowerW: number | null;
  solarActive: boolean;
  loadActive: boolean;
  loadOn: boolean | null;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) ? value : null;
}

export function estimateLifepo4SocPercent(voltageV: number | null | undefined): number | null {
  const voltage = finiteOrNull(voltageV);
  if (voltage === null) return null;
  if (voltage <= LIFEPO4_4S_VOLTAGE_CURVE[0][0]) return 0;

  for (let index = 1; index < LIFEPO4_4S_VOLTAGE_CURVE.length; index += 1) {
    const [upperVoltage, upperPercent] = LIFEPO4_4S_VOLTAGE_CURVE[index];
    if (voltage <= upperVoltage) {
      const [lowerVoltage, lowerPercent] = LIFEPO4_4S_VOLTAGE_CURVE[index - 1];
      const ratio = (voltage - lowerVoltage) / (upperVoltage - lowerVoltage);
      const interpolatedPercent = lowerPercent + ratio * (upperPercent - lowerPercent);
      return roundApproximateSoc(interpolatedPercent, voltage);
    }
  }

  return 100;
}

export function buildRoverEnergyState(
  values: VictronTextValues,
  fallbackBatteryVoltageV?: number | null,
): RoverEnergyState {
  const batteryVoltageV = finiteOrNull(values.batteryVoltageV ?? fallbackBatteryVoltageV);
  const batteryCurrentA = finiteOrNull(values.batteryCurrentA);
  const panelVoltageV = finiteOrNull(values.panelVoltageV);
  const solarPowerW = finiteOrNull(values.panelPowerW);
  const loadCurrentA = finiteOrNull(values.loadCurrentA);
  const loadPowerW = batteryVoltageV !== null && loadCurrentA !== null
    ? Math.max(0, batteryVoltageV * loadCurrentA)
    : null;

  let batteryMode: BatteryFlowMode = 'unavailable';
  if (batteryCurrentA !== null) {
    if (batteryCurrentA > 0.1) batteryMode = 'charging';
    else if (batteryCurrentA < -0.1) batteryMode = 'discharging';
    else batteryMode = 'idle';
  }

  return {
    batteryVoltageV,
    batteryCurrentA,
    batterySocPercent: estimateLifepo4SocPercent(batteryVoltageV),
    batteryMode,
    panelVoltageV,
    solarPowerW,
    loadCurrentA,
    loadPowerW,
    solarActive: (solarPowerW ?? 0) > 0.5,
    loadActive: values.loadOn !== false && (loadPowerW ?? 0) > 0.2,
    loadOn: values.loadOn,
  };
}
