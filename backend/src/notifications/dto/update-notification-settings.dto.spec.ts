import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateNotificationSettingsDto } from './update-notification-settings.dto';

describe('UpdateNotificationSettingsDto', () => {
  it('clears a DND time sent as an explicit null', async () => {
    const dto = plainToInstance(UpdateNotificationSettingsDto, {
      dndStartTime: null,
      dndEndTime: null,
      dndTimezone: null,
    });

    expect(dto.dndStartTime).toBeNull();
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('clears a DND time sent as an empty string', async () => {
    const dto = plainToInstance(UpdateNotificationSettingsDto, {
      dndStartTime: '',
      dndEndTime: '',
      dndTimezone: '',
    });

    expect(dto.dndStartTime).toBeNull();
    expect(dto.dndEndTime).toBeNull();
    expect(dto.dndTimezone).toBeNull();
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('keeps a valid time', async () => {
    const dto = plainToInstance(UpdateNotificationSettingsDto, {
      dndStartTime: '22:30',
      dndEndTime: '07:00',
      dndTimezone: 'Europe/Berlin',
    });

    expect(dto.dndStartTime).toBe('22:30');
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects an invalid time', async () => {
    const errors = await validate(
      plainToInstance(UpdateNotificationSettingsDto, { dndStartTime: '25:00' }),
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'dndStartTime' }),
      ]),
    );
  });

  it('rejects a value that is neither null, empty nor a string', async () => {
    const errors = await validate(
      plainToInstance(UpdateNotificationSettingsDto, { dndTimezone: 5 }),
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'dndTimezone' }),
      ]),
    );
  });
});
