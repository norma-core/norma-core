export interface DatasetGeneratorParams {
  robot: string;
  queue: string;
  from: number;
  to: number;
  output: string;
  task: string;
  episodeDuration: number;
  episodeMinCommands: number;
}

const SHELL_SAFE_VALUE = /^[A-Za-z0-9_@%+=:,./~-]+$/;

function shellQuote(value: string): string {
  if (value.length > 0 && SHELL_SAFE_VALUE.test(value)) {
    return value;
  }
  if (value.startsWith('~/')) {
    return `~/${shellQuote(value.slice(2))}`;
  }

  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function validateDatasetGeneratorParams(params: DatasetGeneratorParams): string[] {
  const errors: string[] = [];

  if (params.robot.trim().length === 0) errors.push('Robot address is required.');
  if (params.queue.trim().length === 0) errors.push('Queue is required.');
  if (params.output.trim().length === 0) errors.push('Output path is required.');
  if (params.task.trim().length === 0) errors.push('Task description is required.');

  if (!Number.isSafeInteger(params.from) || params.from < 0) {
    errors.push('Start tag pointer is invalid.');
  }
  if (!Number.isSafeInteger(params.to) || params.to < 0) {
    errors.push('End tag pointer is invalid.');
  }
  if (Number.isSafeInteger(params.from) && Number.isSafeInteger(params.to) && params.from >= params.to) {
    errors.push('End tag must be after the start tag.');
  }
  if (!Number.isSafeInteger(params.episodeDuration) || params.episodeDuration <= 0) {
    errors.push('Episode duration must be a positive whole number.');
  }
  if (!Number.isSafeInteger(params.episodeMinCommands) || params.episodeMinCommands < 0) {
    errors.push('Minimum commands must be a non-negative whole number.');
  }

  return errors;
}

export function buildDatasetGeneratorCommand(params: DatasetGeneratorParams): string {
  const errors = validateDatasetGeneratorParams(params);
  if (errors.length > 0) {
    throw new Error(errors.join(' '));
  }

  const lines = [
    ['-robot', params.robot.trim()],
    ['-queue', params.queue.trim()],
    ['-from', params.from.toString()],
    ['-to', params.to.toString()],
    ['-output', params.output.trim()],
    ['-task', params.task.trim()],
    ['-episode.duration', params.episodeDuration.toString()],
    ['-episode.min-commands', params.episodeMinCommands.toString()],
  ].map(([flag, value]) => `  ${flag} ${shellQuote(value)}`);

  return `dataset-generator \\\n${lines.join(' \\\n')}`;
}
