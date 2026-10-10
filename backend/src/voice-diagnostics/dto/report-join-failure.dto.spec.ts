import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  JOIN_FAILURE_MESSAGE_MAX,
  ReportJoinFailureDto,
} from './report-join-failure.dto';

const valid = {
  errorClass: 'permission',
  message: 'Forbidden resource',
  durationMs: 120,
  platform: 'web',
  appVersion: '0.6.0',
  isDm: false,
  channelId: 'chan-1',
};

async function check(body: Record<string, unknown>) {
  const dto = plainToInstance(ReportJoinFailureDto, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors: errors.map((e) => e.property) };
}

describe('ReportJoinFailureDto', () => {
  it('accepts a minimal valid report', async () => {
    expect((await check(valid)).errors).toEqual([]);
  });

  it('accepts candidate types and an OS', async () => {
    const { errors } = await check({
      ...valid,
      candidateTypes: ['host', 'relay'],
      os: 'Windows',
    });
    expect(errors).toEqual([]);
  });

  it('truncates a long message instead of rejecting it', async () => {
    const { dto, errors } = await check({
      ...valid,
      message: 'x'.repeat(5000),
    });
    expect(errors).toEqual([]);
    expect(dto.message).toHaveLength(JOIN_FAILURE_MESSAGE_MAX);
  });

  it.each([
    ['an unknown error class', { errorClass: 'kaboom' }, 'errorClass'],
    [
      'an unknown candidate type',
      { candidateTypes: ['host', 'mdns'] },
      'candidateTypes',
    ],
    ['an unknown platform', { platform: 'ios' }, 'platform'],
    ['a negative duration', { durationMs: -1 }, 'durationMs'],
    ['a non-integer duration', { durationMs: 1.5 }, 'durationMs'],
    ['a missing isDm', { isDm: undefined }, 'isDm'],
    ['a non-string message', { message: 42 }, 'message'],
  ])('rejects %s', async (_label, patch, property) => {
    const { errors } = await check({ ...valid, ...patch });
    expect(errors).toContain(property);
  });
});
