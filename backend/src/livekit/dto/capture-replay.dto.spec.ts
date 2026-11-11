import { AppValidationPipe } from '@/common/pipes/app-validation.pipe';
import { CaptureReplayDto } from './capture-replay.dto';

/**
 * The capture route takes this DTO as a JSON body through the app's global
 * pipe. The conditions must tell a value of 0 apart from an absent field, and
 * a range from a duration preset.
 */
describe('CaptureReplayDto', () => {
  const pipe = new AppValidationPipe();
  const validate = (body: unknown) =>
    pipe.transform(body, {
      type: 'body',
      metatype: CaptureReplayDto,
    }) as Promise<CaptureReplayDto>;

  const destination = 'library';

  it('accepts a range that starts at 0', async () => {
    const dto = await validate({
      destination,
      startSeconds: 0,
      endSeconds: 20,
    });

    expect(dto.startSeconds).toBe(0);
    expect(dto.endSeconds).toBe(20);
  });

  it('requires an end after the start', async () => {
    await expect(
      validate({ destination, startSeconds: 20, endSeconds: 20 }),
    ).rejects.toMatchObject({
      validationErrors: expect.arrayContaining([
        expect.objectContaining({ property: 'endSeconds' }),
      ]),
    });
  });

  it.each([1, 2, 5, 10])(
    'accepts a durationMinutes preset of %i',
    async (minutes) => {
      const dto = await validate({ destination, durationMinutes: minutes });
      expect(dto.durationMinutes).toBe(minutes);
    },
  );

  it.each([3, 15])(
    'rejects a durationMinutes preset of %i',
    async (minutes) => {
      await expect(
        validate({ destination, durationMinutes: minutes }),
      ).rejects.toMatchObject({
        validationErrors: expect.arrayContaining([
          expect.objectContaining({ property: 'durationMinutes' }),
        ]),
      });
    },
  );

  it('still validates the range when durationMinutes is also sent', async () => {
    await expect(
      validate({
        destination,
        durationMinutes: 5,
        startSeconds: -1,
        endSeconds: 20,
      }),
    ).rejects.toMatchObject({
      validationErrors: expect.arrayContaining([
        expect.objectContaining({ property: 'startSeconds' }),
      ]),
    });
  });

  it('validates durationMinutes when it is sent alongside a range', async () => {
    await expect(
      validate({
        destination,
        durationMinutes: 3,
        startSeconds: 0,
        endSeconds: 20,
      }),
    ).rejects.toMatchObject({
      validationErrors: expect.arrayContaining([
        expect.objectContaining({ property: 'durationMinutes' }),
      ]),
    });
  });

  it('rejects a request with neither a range nor durationMinutes', async () => {
    await expect(validate({ destination })).rejects.toMatchObject({
      validationErrors: expect.arrayContaining([
        expect.objectContaining({ property: 'durationMinutes' }),
      ]),
    });
  });
});
