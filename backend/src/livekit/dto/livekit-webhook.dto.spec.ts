import { AppValidationPipe } from '@/common/pipes/app-validation.pipe';
import { LiveKitWebhookDto } from './livekit-webhook.dto';

/**
 * Webhook bodies as LiveKit sends them: protojson, so 64-bit integers are
 * strings and enums are names. Validated by the app's global pipe, as the
 * webhook route is.
 */
describe('LiveKitWebhookDto', () => {
  const pipe = new AppValidationPipe();
  const validate = (body: unknown) =>
    pipe.transform(body, {
      type: 'body',
      metatype: LiveKitWebhookDto,
    }) as Promise<LiveKitWebhookDto>;

  it('accepts a participant_joined event with protojson int64 strings', async () => {
    const dto = await validate({
      event: 'participant_joined',
      room: {
        sid: 'RM_hgqF5y88PdqA',
        name: '3f090053-4034-436e-8f08-1f967ddc5775',
        emptyTimeout: 300,
        creationTime: '1790979309',
        creationTimeMs: '1790979309123',
        numParticipants: 2,
        version: { unixMicro: '1790979309123456' },
      },
      participant: {
        sid: 'PA_WWcLBdPi2gTR',
        identity: '5e17be9e-bde0-4b63-8ed0-20eeb0543385',
        state: 'ACTIVE',
        joinedAt: '1790979309',
        joinedAtMs: '1790979309456',
        name: 'Test User',
        version: 2,
        permission: { canSubscribe: true, canPublish: true },
        kind: 'STANDARD',
        attributes: { 'semaphore.issuedAt': '1790979309000.sig' },
      },
      id: 'EV_LdPSbgpvGQgU',
      createdAt: '1790979309',
    });

    expect(dto.room?.name).toBe('3f090053-4034-436e-8f08-1f967ddc5775');
    expect(dto.room?.creationTime).toBe(1790979309);
    expect(dto.participant?.identity).toBe(
      '5e17be9e-bde0-4b63-8ed0-20eeb0543385',
    );
    expect(dto.participant?.joinedAt).toBe(1790979309);
    expect(dto.createdAt).toBe(1790979309);
  });

  it('accepts an egress_ended event with protojson int64 strings', async () => {
    const dto = await validate({
      event: 'egress_ended',
      egressInfo: {
        egressId: 'EG_abc',
        roomName: 'room',
        status: 'EGRESS_COMPLETE',
        startedAt: '1790979309123456789',
        endedAt: '1790979369123456789',
        updatedAt: '1790979369123456789',
      },
      id: 'EV_x',
      createdAt: '1790979369',
    });

    expect(dto.egressInfo?.egressId).toBe('EG_abc');
    expect(typeof dto.egressInfo?.endedAt).toBe('number');
  });

  it('still accepts plain numbers', async () => {
    const dto = await validate({
      event: 'participant_left',
      room: { name: 'r', creationTime: 1790979309 },
      participant: { identity: 'u', joinedAt: 1790979309 },
      createdAt: 1790979369,
    });

    expect(dto.participant?.joinedAt).toBe(1790979309);
  });

  it('rejects a non-numeric timestamp', async () => {
    await expect(
      validate({ event: 'participant_left', createdAt: 'yesterday' }),
    ).rejects.toThrow();
  });
});
