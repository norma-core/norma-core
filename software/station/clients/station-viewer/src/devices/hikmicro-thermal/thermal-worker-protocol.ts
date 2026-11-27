import type { hikmicro } from '@/api/proto.js';
import type { ThermalFrameData, ThermalPalette, ThermalRenderResult } from './thermal';

export interface ThermalRenderRequest {
  frame: ThermalFrameData;
  deviceInfo: hikmicro.IDeviceInfo | null;
  palette: ThermalPalette;
}

export interface ThermalRenderResponse {
  result: ThermalRenderResult | null;
  error: string | null;
}
