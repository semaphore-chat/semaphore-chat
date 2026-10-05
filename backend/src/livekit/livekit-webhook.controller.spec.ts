import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { LivekitWebhookController } from './livekit-webhook.controller';
import { LivekitReplayService } from './livekit-replay.service';
import { LivekitService } from './livekit.service';
import { ChannelAccessService } from '@/roles/channel-access.service';
import { LivekitAccessService } from './livekit-access.service';
import { VoicePresenceService } from '@/voice-presence/voice-presence.service';

import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { WebhookReceiver } from 'livekit-server-sdk';
import {
  LiveKitWebhookDto,
  LiveKitWebhookEvent,
  LiveKitEgressStatus,
} from './dto/livekit-webhook.dto';

// Mock the livekit-server-sdk module
jest.mock('livekit-server-sdk', () => ({
  WebhookReceiver: jest.fn().mockImplementation(() => ({
    receive: jest.fn(),
  })),
  // Real protocol values (used by publishGrantFor)
  TrackSource: {
    UNKNOWN: 0,
    CAMERA: 1,
    MICROPHONE: 2,
    SCREEN_SHARE: 3,
    SCREEN_SHARE_AUDIO: 4,
  },
}));

describe('LivekitWebhookController', () => {
  let controller: LivekitWebhookController;
  let replayService: Mocked<LivekitReplayService>;
  let livekitService: Mocked<LivekitService>;
  let livekitAccessService: Mocked<LivekitAccessService>;
  let voicePresenceService: Mocked<VoicePresenceService>;
  let channelAccessService: Mocked<ChannelAccessService>;
  let webhookReceiverMock: { receive: jest.Mock };

  const createMockRequest = (rawBody?: string) => ({
    rawBody: rawBody ? Buffer.from(rawBody) : undefined,
  });

  const createEgressEndedWebhook = (
    egressId: string,
    status: LiveKitEgressStatus,
    error?: string,
  ): LiveKitWebhookDto => ({
    event: LiveKitWebhookEvent.EGRESS_ENDED,
    egressInfo: {
      egressId,
      status,
      error,
    },
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    // Get the mock webhook receiver instance
    webhookReceiverMock = {
      receive: jest.fn().mockResolvedValue(true),
    };
    (WebhookReceiver as jest.Mock).mockImplementation(
      () => webhookReceiverMock,
    );

    const { unit, unitRef } = await TestBed.solitary(LivekitWebhookController)
      .mock(ConfigService)
      .final({
        get: jest.fn().mockImplementation((key: string) => {
          const config: Record<string, string> = {
            LIVEKIT_API_KEY: 'test-api-key',
            LIVEKIT_API_SECRET: 'test-api-secret',
          };
          return config[key];
        }),
      })
      .compile();

    controller = unit;
    replayService = unitRef.get(LivekitReplayService);
    livekitService = unitRef.get(LivekitService);
    livekitAccessService = unitRef.get(LivekitAccessService);
    voicePresenceService = unitRef.get(VoicePresenceService);
    channelAccessService = unitRef.get(ChannelAccessService);
    livekitAccessService.checkJoin.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('constructor', () => {
    it('should initialize WebhookReceiver with API credentials', () => {
      expect(WebhookReceiver).toHaveBeenCalledWith(
        'test-api-key',
        'test-api-secret',
      );
    });

    it('should use fallback values when credentials are not set', async () => {
      await TestBed.solitary(LivekitWebhookController)
        .mock(ConfigService)
        .final({
          get: jest.fn().mockReturnValue(undefined),
        })
        .compile();

      expect(WebhookReceiver).toHaveBeenCalledWith('unused', 'unused');
    });
  });

  describe('handleWebhook', () => {
    describe('signature verification', () => {
      it('should verify webhook signature when credentials are configured', async () => {
        const rawBody = JSON.stringify({
          event: LiveKitWebhookEvent.EGRESS_ENDED,
          egressInfo: { egressId: 'test-egress', status: 'COMPLETE' },
        });
        const req = createMockRequest(rawBody);
        const authorization = 'Bearer valid-signature';
        const body = createEgressEndedWebhook(
          'test-egress',
          LiveKitEgressStatus.COMPLETE,
        );

        webhookReceiverMock.receive.mockResolvedValue(true);

        await controller.handleWebhook(req as any, authorization, body);

        expect(webhookReceiverMock.receive).toHaveBeenCalledWith(
          rawBody,
          authorization,
        );
      });

      it('should throw BadRequestException when signature is invalid', async () => {
        const req = createMockRequest('{"event":"egress_ended"}');
        const authorization = 'Bearer invalid-signature';
        const body = createEgressEndedWebhook(
          'test-egress',
          LiveKitEgressStatus.COMPLETE,
        );

        webhookReceiverMock.receive.mockResolvedValue(false);

        await expect(
          controller.handleWebhook(req as any, authorization, body),
        ).rejects.toThrow(BadRequestException);
        await expect(
          controller.handleWebhook(req as any, authorization, body),
        ).rejects.toThrow('Invalid webhook signature');
      });

      it('should throw BadRequestException when signature verification throws an error', async () => {
        const req = createMockRequest('{"event":"egress_ended"}');
        const authorization = 'Bearer malformed';
        const body = createEgressEndedWebhook(
          'test-egress',
          LiveKitEgressStatus.COMPLETE,
        );

        webhookReceiverMock.receive.mockRejectedValue(
          new Error('Malformed signature'),
        );

        await expect(
          controller.handleWebhook(req as any, authorization, body),
        ).rejects.toThrow(BadRequestException);
        await expect(
          controller.handleWebhook(req as any, authorization, body),
        ).rejects.toThrow('Webhook verification failed');
      });

      it('should throw ForbiddenException when credentials are not configured', async () => {
        // Recreate controller without credentials
        const { unit: controllerWithoutCreds } = await TestBed.solitary(
          LivekitWebhookController,
        )
          .mock(ConfigService)
          .final({
            get: jest.fn().mockReturnValue(undefined),
          })
          .compile();

        const req = createMockRequest();
        const body = createEgressEndedWebhook(
          'test-egress',
          LiveKitEgressStatus.COMPLETE,
        );

        await expect(
          controllerWithoutCreds.handleWebhook(req as any, '', body),
        ).rejects.toThrow(ForbiddenException);
        await expect(
          controllerWithoutCreds.handleWebhook(req as any, '', body),
        ).rejects.toThrow(
          'Webhook verification not configured - LIVEKIT_API_KEY and LIVEKIT_API_SECRET required',
        );
        // Should not call receive when credentials are missing
        expect(webhookReceiverMock.receive).not.toHaveBeenCalled();
      });

      it('should use JSON.stringify when rawBody is not available', async () => {
        const req = { rawBody: undefined }; // No raw body
        const authorization = 'Bearer signature';
        const body = createEgressEndedWebhook(
          'test-egress',
          LiveKitEgressStatus.COMPLETE,
        );

        webhookReceiverMock.receive.mockResolvedValue(true);

        await controller.handleWebhook(req as any, authorization, body);

        // Should fall back to JSON.stringify(body)
        expect(webhookReceiverMock.receive).toHaveBeenCalledWith(
          JSON.stringify(body),
          authorization,
        );
      });
    });

    describe('egress_ended event handling', () => {
      beforeEach(() => {
        webhookReceiverMock.receive.mockResolvedValue(true);
      });

      it('should process egress_ended event with COMPLETE status', async () => {
        const req = createMockRequest('{}');
        const body = createEgressEndedWebhook(
          'egress-123',
          LiveKitEgressStatus.COMPLETE,
        );

        replayService.handleEgressEnded.mockResolvedValue(undefined);

        const result = await controller.handleWebhook(
          req as any,
          'Bearer token',
          body,
        );

        expect(replayService.handleEgressEnded).toHaveBeenCalledWith(
          'egress-123',
          'stopped',
          undefined,
        );
        expect(result).toEqual({ success: true });
      });

      it('should process egress_ended event with FAILED status', async () => {
        const req = createMockRequest('{}');
        const body = createEgressEndedWebhook(
          'egress-456',
          LiveKitEgressStatus.FAILED,
          'Egress failed due to network error',
        );

        replayService.handleEgressEnded.mockResolvedValue(undefined);

        await controller.handleWebhook(req as any, 'Bearer token', body);

        expect(replayService.handleEgressEnded).toHaveBeenCalledWith(
          'egress-456',
          'failed',
          'Egress failed due to network error',
        );
      });

      it('should process egress_ended event with ABORTED status', async () => {
        const req = createMockRequest('{}');
        const body = createEgressEndedWebhook(
          'egress-789',
          LiveKitEgressStatus.ABORTED,
        );

        replayService.handleEgressEnded.mockResolvedValue(undefined);

        await controller.handleWebhook(req as any, 'Bearer token', body);

        expect(replayService.handleEgressEnded).toHaveBeenCalledWith(
          'egress-789',
          'failed',
          undefined,
        );
      });

      it('should not throw when replay service fails to process event', async () => {
        const req = createMockRequest('{}');
        const body = createEgressEndedWebhook(
          'egress-error',
          LiveKitEgressStatus.COMPLETE,
        );

        replayService.handleEgressEnded.mockRejectedValue(
          new Error('Database connection lost'),
        );

        // Should not throw - just log and return success
        const result = await controller.handleWebhook(
          req as any,
          'Bearer token',
          body,
        );

        expect(result).toEqual({ success: true });
      });
    });

    describe('other event types', () => {
      beforeEach(() => {
        webhookReceiverMock.receive.mockResolvedValue(true);
      });

      it('should ignore non-egress_ended events', async () => {
        const req = createMockRequest('{}');
        const body = {
          event: 'room_started' as LiveKitWebhookEvent,
          egressInfo: {
            egressId: 'irrelevant',
            status: LiveKitEgressStatus.ACTIVE,
          },
        };

        const result = await controller.handleWebhook(
          req as any,
          'Bearer token',
          body,
        );

        expect(replayService.handleEgressEnded).not.toHaveBeenCalled();
        expect(result).toEqual({ success: true });
      });

      it('should return success for any valid webhook', async () => {
        const req = createMockRequest('{}');
        const body = {
          event: 'participant_joined' as LiveKitWebhookEvent,
          egressInfo: {
            egressId: '',
            status: LiveKitEgressStatus.STARTING,
          },
        };

        const result = await controller.handleWebhook(
          req as any,
          'Bearer token',
          body,
        );

        expect(result).toEqual({ success: true });
      });
    });
  });

  describe('participant_joined access check', () => {
    const attributes = { 'semaphore.issuedAt': '123.sig' };

    const joined = (identity = 'user-1', kind = 0) => {
      const body = {
        event: LiveKitWebhookEvent.PARTICIPANT_JOINED,
        room: { name: 'room-1' },
        participant: { identity, name: 'User' },
      } as LiveKitWebhookDto;
      // The verified event (what WebhookReceiver.receive returns) carries
      // the participant's kind and attributes
      webhookReceiverMock.receive.mockResolvedValue({
        event: 'participant_joined',
        room: { name: 'room-1' },
        participant: { identity, kind, attributes },
      });
      return controller.handleWebhook(
        createMockRequest(JSON.stringify(body)) as any,
        'Bearer token',
        body,
      );
    };

    it('registers presence for a normal user', async () => {
      await expect(joined()).resolves.toEqual({ success: true });

      expect(livekitAccessService.checkJoin).toHaveBeenCalledWith(
        'user-1',
        attributes,
      );
      expect(livekitService.removeParticipant).not.toHaveBeenCalled();
      expect(
        voicePresenceService.handleWebhookParticipantJoined,
      ).toHaveBeenCalledWith('room-1', 'user-1', 'User', undefined);
    });

    it.each([
      'USER_BANNED',
      'USER_DELETED',
      'TOKEN_REVOKED',
      'SESSION_REVOKED',
    ] as const)(
      'removes the participant and skips presence (%s)',
      async (denial) => {
        livekitAccessService.checkJoin.mockResolvedValue(denial);

        await expect(joined()).resolves.toEqual({ success: true });

        expect(livekitService.removeParticipant).toHaveBeenCalledWith(
          'room-1',
          'user-1',
        );
        expect(
          voicePresenceService.handleWebhookParticipantJoined,
        ).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['ingress', 1],
      ['egress', 2],
    ])("leaves LiveKit's own %s participants alone", async (_kind, kind) => {
      await joined('EG_abc', kind);

      expect(livekitAccessService.checkJoin).not.toHaveBeenCalled();
      expect(livekitService.removeParticipant).not.toHaveBeenCalled();
    });

    describe('clamps a stale token to current voice permissions', () => {
      it('timed out since the token was issued: listen-only right away', async () => {
        channelAccessService.channelCapabilities.mockResolvedValue({
          channelId: 'room-1',
          view: true,
          post: true,
          attach: true,
          react: true,
          threadReply: true,
          connect: true,
          speak: false,
          video: false,
          share: false,
          managePermissions: false,
          timedOutUntil: null,
        });
        await joined();
        expect(livekitService.updatePublishPermissions).toHaveBeenCalledWith(
          'room-1',
          'user-1',
          { canPublish: false },
        );
        // presence still registers (they can listen)
        expect(
          voicePresenceService.handleWebhookParticipantJoined,
        ).toHaveBeenCalled();
      });

      it('a partial grant is narrowed to the allowed sources', async () => {
        channelAccessService.channelCapabilities.mockResolvedValue({
          channelId: 'room-1',
          view: true,
          post: true,
          attach: true,
          react: true,
          threadReply: true,
          connect: true,
          speak: true,
          video: false,
          share: false,
          managePermissions: false,
          timedOutUntil: null,
        });
        await joined();
        expect(livekitService.updatePublishPermissions).toHaveBeenCalledWith(
          'room-1',
          'user-1',
          {
            canPublish: true,
            canPublishSources: [2], // TrackSource.MICROPHONE
          },
        );
      });

      it('a full grant changes nothing', async () => {
        channelAccessService.channelCapabilities.mockResolvedValue({
          channelId: 'room-1',
          view: true,
          post: true,
          attach: true,
          react: true,
          threadReply: true,
          connect: true,
          speak: true,
          video: true,
          share: true,
          managePermissions: false,
          timedOutUntil: null,
        });
        await joined();
        expect(livekitService.updatePublishPermissions).not.toHaveBeenCalled();
      });

      it('skips DM rooms (no channel)', async () => {
        channelAccessService.channelCapabilities.mockResolvedValue(null);
        await joined();
        expect(livekitService.updatePublishPermissions).not.toHaveBeenCalled();
      });

      it("skips LiveKit's own egress participants", async () => {
        await joined('EG_abc', 2);
        expect(channelAccessService.channelCapabilities).not.toHaveBeenCalled();
      });

      it('skips removed (revoked) participants', async () => {
        livekitAccessService.checkJoin.mockResolvedValue('USER_BANNED');
        await joined();
        expect(channelAccessService.channelCapabilities).not.toHaveBeenCalled();
      });
    });

    it('does not check other events', async () => {
      const body = {
        event: LiveKitWebhookEvent.PARTICIPANT_LEFT,
        room: { name: 'room-1' },
        participant: { identity: 'user-1' },
      } as LiveKitWebhookDto;
      webhookReceiverMock.receive.mockResolvedValue({
        event: 'participant_left',
      });

      await controller.handleWebhook(
        createMockRequest('{}') as any,
        'Bearer token',
        body,
      );

      expect(livekitAccessService.checkJoin).not.toHaveBeenCalled();
      expect(
        voicePresenceService.handleWebhookParticipantLeft,
      ).toHaveBeenCalledWith('room-1', 'user-1');
    });
  });
});
