import { describe, expect, it } from 'vitest';
import {
  buildDatasetGeneratorCommand,
  validateDatasetGeneratorParams,
  type DatasetGeneratorParams,
} from './dataset-export';

const VALID_PARAMS: DatasetGeneratorParams = {
  robot: '192.168.0.10',
  queue: 'inference/normvla',
  from: 18979274n,
  to: 22445334n,
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

  it('preserves pointer values beyond JavaScript number precision', () => {
    const from = 9007199254740993n;
    expect(buildDatasetGeneratorCommand({
      ...VALID_PARAMS,
      from,
      to: from + 1n,
    })).toContain('-from 9007199254740993');
  });
});

describe('validateDatasetGeneratorParams', () => {
  it('rejects reversed tag bounds', () => {
    expect(validateDatasetGeneratorParams({
      ...VALID_PARAMS,
      from: VALID_PARAMS.to,
      to: VALID_PARAMS.from,
    })).toContain('End tag must be after the start tag.');
  });
});
