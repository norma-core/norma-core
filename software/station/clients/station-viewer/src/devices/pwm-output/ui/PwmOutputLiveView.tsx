import Long from 'long';
import { pwm_output } from '@/api/proto.js';
import { serverToLocal } from '@/api/timestamp-utils';
import DeviceMetricPill from '@/components/DeviceMetricPill';
import DeviceWidgetShell from '@/components/DeviceWidgetShell';

export interface PwmOutputLiveViewProps {
  rx?: pwm_output.IRxEnvelope;
  tx?: pwm_output.ITxEnvelope;
}

function signalLabel(signalType: pwm_output.PwmOutputSignalType | null | undefined): string {
  switch (signalType) {
    case pwm_output.PwmOutputSignalType.PWM_OUTPUT_CONFIGURED:
      return 'configured';
    case pwm_output.PwmOutputSignalType.PWM_OUTPUT_COMMAND:
      return 'command';
    case pwm_output.PwmOutputSignalType.PWM_OUTPUT_COMMAND_SUCCESS:
      return 'success';
    case pwm_output.PwmOutputSignalType.PWM_OUTPUT_COMMAND_REJECTED:
      return 'rejected';
    case pwm_output.PwmOutputSignalType.PWM_OUTPUT_COMMAND_FAILED:
      return 'failed';
    case pwm_output.PwmOutputSignalType.PWM_OUTPUT_ERROR:
      return 'error';
    default:
      return 'unknown';
  }
}

function signalTone(signalType: pwm_output.PwmOutputSignalType | null | undefined): string {
  switch (signalType) {
    case pwm_output.PwmOutputSignalType.PWM_OUTPUT_COMMAND_SUCCESS:
    case pwm_output.PwmOutputSignalType.PWM_OUTPUT_CONFIGURED:
      return 'text-accent-success';
    case pwm_output.PwmOutputSignalType.PWM_OUTPUT_COMMAND_REJECTED:
    case pwm_output.PwmOutputSignalType.PWM_OUTPUT_COMMAND_FAILED:
      return 'text-accent-warning';
    case pwm_output.PwmOutputSignalType.PWM_OUTPUT_ERROR:
      return 'text-accent-critical';
    default:
      return 'text-accent-data';
  }
}

function formatCommand(command?: pwm_output.ICommand | null): string {
  if (!command) {
    return '--';
  }
  if (command.wave) {
    return formatWave(command.wave);
  }
  if (command.disable) {
    return `disable ch${command.disable.channel ?? 0}`;
  }
  return '--';
}

function formatLevel(level?: pwm_output.WaveLevel | null): string {
  switch (level) {
    case pwm_output.WaveLevel.WAVE_LEVEL_HIGH:
      return 'H';
    case pwm_output.WaveLevel.WAVE_LEVEL_LOW:
      return 'L';
    default:
      return '?';
  }
}

function formatWave(wave?: pwm_output.IWaveCommand | null): string {
  if (!wave) {
    return '--';
  }

  const segments = (wave.segments ?? [])
    .slice(0, 4)
    .map((segment) => `${formatLevel(segment.level)}${segment.durationUs ?? 0}us`)
    .join(' ');
  return `ch${wave.channel ?? 0} x${wave.repeat ?? 0}${segments ? ` ${segments}` : ''}`;
}

function formatAge(stampNs?: Long | number | null): string {
  if (!stampNs) {
    return '--';
  }

  const localStamp = serverToLocal(Long.fromValue(stampNs));
  const ageMs = Date.now() - localStamp.toNumber() / 1e6;
  if (!Number.isFinite(ageMs)) {
    return '--';
  }
  return ageMs < 1000 ? `${Math.max(0, ageMs).toFixed(0)}ms` : `${(Math.max(0, ageMs) / 1000).toFixed(1)}s`;
}

function PwmOutputLiveView({ rx, tx }: PwmOutputLiveViewProps) {
  const device = rx?.device;
  const state = rx?.state;
  const outputId = device?.id || state?.id || tx?.targetOutputId || tx?.command?.targetOutputId || 'pwm-output';
  const subtitle = device ? 'H7 wave output' : tx?.targetOutputId || '--';
  const txCommand = formatCommand(tx?.command);
  const rxCommand = formatCommand(rx?.command?.command);
  const stateWave = formatWave(state?.wave);

  return (
    <DeviceWidgetShell
      title={`PWM Output ${outputId}`}
      subtitle={subtitle}
      error={rx?.error || null}
    >
      <div className="grid grid-cols-2 gap-1.5">
        <DeviceMetricPill
          label="State"
          value={signalLabel(rx?.signalType)}
          tone={signalTone(rx?.signalType)}
        />
        <DeviceMetricPill
          label="PWM"
          value={state?.enabled ? 'enabled' : 'disabled'}
          tone={state?.enabled ? 'text-accent-success' : 'text-text-muted'}
        />
        <DeviceMetricPill
          label="Wave"
          value={stateWave}
          tone="text-accent-data"
        />
        <DeviceMetricPill
          label="RX Age"
          value={formatAge(rx?.monotonicStampNs)}
          tone="text-text-secondary"
        />
        <DeviceMetricPill
          label="Latest TX"
          value={txCommand}
          tone="text-accent-warning"
        />
        <DeviceMetricPill
          label="Result Cmd"
          value={rxCommand}
          tone="text-accent-info"
        />
      </div>
    </DeviceWidgetShell>
  );
}

export default PwmOutputLiveView;
