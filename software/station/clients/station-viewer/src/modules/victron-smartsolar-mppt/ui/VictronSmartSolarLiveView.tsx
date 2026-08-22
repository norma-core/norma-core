import { useEffect, useRef, useState } from 'react';
import { victron_smartsolar_mppt } from '@/api/proto.js';
import VictronSmartSolarWidget from './VictronSmartSolarWidget';
import { EMPTY_STATE, applyEnvelope, type VictronState } from '../values';

export interface VictronSmartSolarLiveViewProps {
  data: victron_smartsolar_mppt.IRxEnvelope;
}

function VictronSmartSolarLiveView({ data }: VictronSmartSolarLiveViewProps) {
  const [state, setState] = useState<VictronState>(EMPTY_STATE);
  const appStartRef = useRef<string>('');

  useEffect(() => {
    // One queue per charger, so this view only ever sees one device: reset on a
    // station restart, not on a port rename.
    const appStart = data.appStartId?.toString() ?? '';
    const reset = appStart !== appStartRef.current;
    appStartRef.current = appStart;

    setState((prev) => applyEnvelope(reset ? EMPTY_STATE : prev, data));
  }, [data]);

  return (
    <VictronSmartSolarWidget
      device={data.device}
      textValues={state.textValues}
      hexRegs={state.hexRegs}
      error={data.error}
    />
  );
}

export default VictronSmartSolarLiveView;
