import { describe, expect, it } from 'vitest';
import {
  buildDatasetGeneratorCommand,
  validateDatasetGeneratorParams,
  type DatasetGeneratorParams,
} from './dataset-export';

const VALID_PARAMS: DatasetGeneratorParams = {
  robot: '192.168.0.10',
  queue: 'inference/normvla',
  from: 18979274,
  to: 22445334,
  output: '~/datasets/dataset-cube',
  task: 'put the cube inside box',
  episodeDuration: 35,
  episodeMinCommands: 100,
};

describe('buildDatasetGeneratorCommand', () => {
  it('generates the dataset-generator command from tag pointers and parameters', () => {
    expect(buildDatasetGeneratorCommand(VALID_PARAMS)).toBe(`dataset-generator \\
  -robot 192.168.0.10 \\
  -queue inference/normvla \\
  -from 18979274 \\
  -to 22445334 \\
  -output ~/datasets/dataset-cube \\
  -task 'put the cube inside box' \\
  -episode.duration 35 \\
  -episode.min-commands 100`);
  });

  it('shell-quotes user text without disabling tilde expansion in the output path', () => {
    expect(buildDatasetGeneratorCommand({
      ...VALID_PARAMS,
      output: '~/datasets/cube run',
      task: "put user's cube inside $BOX",
    })).toContain("-output ~/'datasets/cube run'");
    expect(buildDatasetGeneratorCommand({
      ...VALID_PARAMS,
      task: "put user's cube inside $BOX",
    })).toContain(`-task 'put user'"'"'s cube inside $BOX'`);
  });
});

describe('validateDatasetGeneratorParams', () => {
  it('rejects reversed tag bounds and invalid required parameters', () => {
    expect(validateDatasetGeneratorParams({
      ...VALID_PARAMS,
      robot: ' ',
      from: VALID_PARAMS.to,
      to: VALID_PARAMS.from,
      episodeDuration: 0,
      episodeMinCommands: -1,
    })).toEqual([
      'Robot address is required.',
      'End tag must be after the start tag.',
      'Episode duration must be a positive whole number.',
      'Minimum commands must be a non-negative whole number.',
    ]);
  });
});
