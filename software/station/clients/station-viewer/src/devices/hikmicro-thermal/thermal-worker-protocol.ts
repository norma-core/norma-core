import type { hikmicro } from '@/api/proto.js';
import type { ThermalPalette, ThermalRenderResult } from './thermal';

export interface ThermalRenderRequest {
  payload: Uint8Array;
  deviceInfo: hikmicro.IDeviceInfo | null;
  palette: ThermalPalette;
}

export interface ThermalRenderResponse {
  result: ThermalRenderResult | null;
  error: string | null;
}
