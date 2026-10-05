import {
  Controller,
  Post,
  Body,
  Headers,
  Logger,
  BadRequestException,
  ForbiddenException,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiCreatedResponse } from '@nestjs/swagger';
import { Public } from '@/auth/public.decorator';
import { SuccessResponseDto } from '@/common/dto/common-response.dto';
import { ConfigService } from '@nestjs/config';
import { WebhookReceiver, type WebhookEvent } from 'livekit-server-sdk';
import { LivekitService } from './livekit.service';
import { LivekitAccessService } from './livekit-access.service';
import { ChannelAccessService } from '@/roles/channel-access.service';
import { FULL_PUBLISH_GRANT, publishGrantFor } from './publish-grant.util';
import { LivekitReplayService } from './livekit-replay.service';
import { VoicePresenceService } from '@/voice-presence/voice-presence.service';
import {
  LiveKitWebhookDto,
  LiveKitWebhookEvent,
  LiveKitEgressStatus,
} from './dto/livekit-webhook.dto';

/**
 * `ParticipantInfo.Kind` values (livekit protocol) of LiveKit's own
 * participants. The enum lives in @livekit/protocol, which
 * livekit-server-sdk doesn't re-export.
 */
const PARTICIPANT_KIND_INGRESS = 1;
const PARTICIPANT_KIND_EGRESS = 2;

/**
 * LiveKit Webhook Controller
 *
 * Receives webhook events from LiveKit server for egress status updates.
 * Verifies webhook signatures and delegates to LivekitReplayService.
 *
 * @example
 * Configure in LiveKit Cloud dashboard or self-hosted server:
 * Webhook URL: https://your-domain.com/api/livekit/webhook
 * Webhook signatures are verified using LIVEKIT_API_KEY and LIVEKIT_API_SECRET.
 */
@Controller('livekit')
export class LivekitWebhookController {
  private readonly logger = new Logger(LivekitWebhookController.name);
  private readonly webhookReceiver: WebhookReceiver;
  private readonly webhookVerificationEnabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly livekitReplayService: LivekitReplayService,
    private readonly voicePresenceService: VoicePresenceService,
    private readonly livekitService: LivekitService,
    private readonly livekitAccessService: LivekitAccessService,
    private readonly channelAccessService: ChannelAccessService,
  ) {
    const apiKey = this.configService.get<string>('LIVEKIT_API_KEY');
    const apiSecret = this.configService.get<string>('LIVEKIT_API_SECRET');

    this.webhookVerificationEnabled = !!(apiKey && apiSecret);

    if (!this.webhookVerificationEnabled) {
      this.logger.warn(
        'LIVEKIT_API_KEY or LIVEKIT_API_SECRET not set - webhooks will be rejected',
      );
    }

    // Initialize webhook receiver with API credentials for signature verification
    // Note: WebhookReceiver uses API secret to verify webhook signatures
    this.webhookReceiver = new WebhookReceiver(
      apiKey || 'unused',
      apiSecret || 'unused',
    );
  }

  /**
   * Handle LiveKit webhook events
   *
   * Verifies webhook signature and processes egress_ended events
   *
   * @param req - Raw request (needed for signature verification)
   * @param authorization - Authorization header containing webhook signature
   * @param body - Parsed webhook payload
   */
  @Post('webhook')
  @Public()
  @ApiCreatedResponse({ type: SuccessResponseDto })
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('authorization') authorization: string,
    @Body() body: LiveKitWebhookDto,
  ): Promise<{ success: boolean }> {
    this.logger.debug(`Received webhook event: ${body.event}`);

    // Reject webhooks entirely when verification credentials are not configured
    if (!this.webhookVerificationEnabled) {
      throw new ForbiddenException(
        'Webhook verification not configured - LIVEKIT_API_KEY and LIVEKIT_API_SECRET required',
      );
    }

    // Verify webhook signature using API credentials
    let verified: WebhookEvent;
    try {
      // Extract raw body for signature verification
      const rawBody = req.rawBody?.toString('utf-8') || JSON.stringify(body);

      // Verify signature using LiveKit SDK
      verified = await this.webhookReceiver.receive(rawBody, authorization);

      if (!verified) {
        this.logger.warn('Invalid webhook signature');
        throw new BadRequestException('Invalid webhook signature');
      }
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.logger.error(
        `Webhook signature verification failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BadRequestException('Webhook verification failed');
    }

    // Handle events by type
    switch (body.event) {
      case LiveKitWebhookEvent.PARTICIPANT_JOINED:
        await this.handleParticipantJoined(body, verified);
        break;

      case LiveKitWebhookEvent.PARTICIPANT_LEFT:
        await this.handleParticipantLeft(body);
        break;

      case LiveKitWebhookEvent.EGRESS_ENDED:
        await this.handleEgressEnded(body);
        break;

      case LiveKitWebhookEvent.ROOM_FINISHED:
        // Room finished event could be used for cleanup, but we handle
        // individual participant leaves which is sufficient
        this.logger.debug(`Room finished: ${body.room?.name}`);
        break;

      default:
        this.logger.debug(`Ignoring webhook event: ${body.event}`);
    }

    return { success: true };
  }

  /**
   * Handle participant_joined webhook event
   *
   * This is the authoritative source for voice presence.
   * When a participant joins a LiveKit room, we update Redis and notify clients.
   *
   * It is also the safety net for revoked voice access: LiveKit tokens can't
   * be revoked, so a banned or deleted user, or a token issued before the
   * user's credentials changed, is removed from the room right away (and
   * never shows up in voice presence).
   *
   * @param event - The verified event, which carries the participant's kind
   *   and attributes (the DTO doesn't)
   */
  private async handleParticipantJoined(
    webhook: LiveKitWebhookDto,
    event: WebhookEvent,
  ) {
    const { room, participant } = webhook;

    if (!room?.name || !participant?.identity) {
      this.logger.warn(
        'participant_joined webhook missing room.name or participant.identity',
      );
      return;
    }

    if (
      await this.denyRevokedParticipant(room.name, participant.identity, event)
    ) {
      return;
    }

    await this.clampPublishPermissions(room.name, participant.identity, event);

    try {
      await this.voicePresenceService.handleWebhookParticipantJoined(
        room.name,
        participant.identity,
        participant.name,
        participant.metadata,
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle participant_joined for ${participant.identity} in room ${room.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Don't throw - acknowledge webhook receipt even if processing fails
    }
  }

  /**
   * Remove a participant whose voice access was revoked (see
   * LivekitAccessService.checkJoin). Egress and ingress participants are
   * LiveKit's own (their identities aren't user IDs) and are left alone; the
   * backend only issues standard tokens. Returns whether it was removed.
   */
  private async denyRevokedParticipant(
    roomName: string,
    identity: string,
    event: WebhookEvent,
  ): Promise<boolean> {
    const kind: number | undefined = event.participant?.kind;
    if (kind === PARTICIPANT_KIND_INGRESS || kind === PARTICIPANT_KIND_EGRESS) {
      return false;
    }

    const denial = await this.livekitAccessService.checkJoin(
      identity,
      event.participant?.attributes,
    );
    if (!denial) return false;

    this.logger.warn(
      `Removing ${identity} from LiveKit room ${roomName}: ${denial}`,
    );
    await this.livekitService.removeParticipant(roomName, identity);
    return true;
  }

  /**
   * A token can predate a timeout or an overwrite (tokens can't be revoked),
   * so on join the publish grant is recomputed from the participant's
   * current channel capabilities and narrowed if it isn't full. DM rooms
   * (no channel) and LiveKit's own ingress/egress participants are skipped.
   * Errors are logged, never thrown.
   */
  private async clampPublishPermissions(
    roomName: string,
    identity: string,
    event: WebhookEvent,
  ): Promise<void> {
    const kind: number | undefined = event.participant?.kind;
    if (kind === PARTICIPANT_KIND_INGRESS || kind === PARTICIPANT_KIND_EGRESS) {
      return;
    }
    try {
      const caps = await this.channelAccessService.channelCapabilities(
        identity,
        roomName,
      );
      if (!caps) return; // not a channel room (DM call)
      const grant = publishGrantFor(caps);
      if (grant === FULL_PUBLISH_GRANT) return;
      await this.livekitService.updatePublishPermissions(
        roomName,
        identity,
        grant,
      );
    } catch (error) {
      this.logger.error(
        `Failed to clamp publish permissions of ${identity} in room ${roomName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Handle participant_left webhook event
   *
   * This is the authoritative source for voice presence.
   * When a participant leaves a LiveKit room, we update Redis and notify clients.
   */
  private async handleParticipantLeft(webhook: LiveKitWebhookDto) {
    const { room, participant } = webhook;

    if (!room?.name || !participant?.identity) {
      this.logger.warn(
        'participant_left webhook missing room.name or participant.identity',
      );
      return;
    }

    try {
      await this.voicePresenceService.handleWebhookParticipantLeft(
        room.name,
        participant.identity,
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle participant_left for ${participant.identity} in room ${room.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Don't throw - acknowledge webhook receipt even if processing fails
    }
  }

  /**
   * Handle egress_ended webhook event
   *
   * Updates session status in database and notifies user if egress failed
   */
  private async handleEgressEnded(webhook: LiveKitWebhookDto) {
    const { egressInfo } = webhook;

    if (!egressInfo) {
      this.logger.warn('egress_ended webhook missing egressInfo');
      return;
    }

    const { egressId, status, error: errorMessage } = egressInfo;

    this.logger.log(
      `Egress ended: ${egressId} with status: ${status}${errorMessage ? ` (error: ${errorMessage})` : ''}`,
    );

    // Determine if egress completed successfully or failed
    const isFailed =
      status === LiveKitEgressStatus.FAILED ||
      status === LiveKitEgressStatus.ABORTED;

    try {
      // Delegate to replay service to handle the egress end
      await this.livekitReplayService.handleEgressEnded(
        egressId,
        isFailed ? 'failed' : 'stopped',
        errorMessage,
      );

      this.logger.log(`Successfully processed egress_ended for ${egressId}`);
    } catch (serviceError) {
      this.logger.error(
        `Failed to process egress_ended for ${egressId}: ${serviceError instanceof Error ? serviceError.message : String(serviceError)}`,
      );
      // Don't throw - we don't want LiveKit to retry webhooks for internal errors
      // Just log and return success to acknowledge webhook receipt
    }
  }
}
