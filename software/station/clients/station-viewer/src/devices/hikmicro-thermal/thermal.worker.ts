import { renderThermalFrame } from './thermal';
import type { ThermalRenderRequest, ThermalRenderResponse } from './thermal-worker-protocol';

// Keep the worker independent of protobuf runtime and React.
const worker = self as unknown as {
  onmessage: (event: MessageEvent<ThermalRenderRequest>) => void;
  postMessage: (message: ThermalRenderResponse, transfer: Transferable[]) => void;
};

worker.onmessage = ({ data }) => {
  try {
    const result = renderThermalFrame({ deviceInfo: data.deviceInfo }, { payload: data.payload }, data.palette);
    worker.postMessage({ result, error: null }, [result.rgba.buffer]);
  } catch (error) {
    worker.postMessage({ result: null, error: error instanceof Error ? error.message : 'Thermal decoding failed' }, []);
  }
};
