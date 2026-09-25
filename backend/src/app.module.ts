import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { RolesModule } from './roles/roles.module';
import { InviteModule } from './invite/invite.module';
import { CommunityModule } from './community/community.module';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerModuleOptions } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import { ChannelsModule } from './channels/channels.module';
import { MessagesModule } from './messages/messages.module';
import { RoomsModule } from './rooms/rooms.module';
import { WebsocketService } from './websocket/websocket.service';
import { WebsocketModule } from './websocket/websocket.module';
import { RedisModule } from './redis/redis.module';
import { REDIS_CLIENT } from './redis/redis.constants';
import { FailOpenThrottlerStorage } from './throttler/fail-open-throttler.storage';
import { PresenceModule } from './presence/presence.module';
import { MembershipModule } from './membership/membership.module';
import { ChannelMembershipModule } from './channel-membership/channel-membership.module';
import { LivekitModule } from './livekit/livekit.module';
import { VoicePresenceModule } from './voice-presence/voice-presence.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { DirectMessagesModule } from './direct-messages/direct-messages.module';
import { FileUploadModule } from './file-upload/file-upload.module';
import { FileModule } from './file/file.module';
import { HealthModule } from './health/health.module';
import { ReadReceiptsModule } from './read-receipts/read-receipts.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PushNotificationsModule } from './push-notifications/push-notifications.module';
import { InstanceModule } from './instance/instance.module';
import { ModerationModule } from './moderation/moderation.module';
import { AppearanceSettingsModule } from './appearance-settings/appearance-settings.module';
import { FriendsModule } from './friends/friends.module';
import { ThreadsModule } from './threads/threads.module';
import { StorageQuotaModule } from './storage-quota/storage-quota.module';
import { AliasGroupsModule } from './alias-groups/alias-groups.module';
import { CustomEmojiModule } from './custom-emoji/custom-emoji.module';
import { SoundboardModule } from './soundboard/soundboard.module';
import { GifsModule } from './gifs/gifs.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { DebugModule } from './debug/debug.module';
import { MetricsModule } from './metrics/metrics.module';
import { HttpThrottlerGuard } from './throttler/http-throttler.guard';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { JobsModule } from './jobs/jobs.module';

@Module({
  imports: [
    AuthModule,
    HealthModule,
    DatabaseModule,
    InviteModule,
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    // Global BullMQ registration (message-fanout, link-previews queues) —
    // imported once here, exactly like ConfigModule.forRoot's isGlobal
    // pattern above, so feature modules can @InjectQueue/@Processor without
    // importing JobsModule themselves.
    JobsModule,
    RolesModule,
    UserModule,
    CommunityModule,
    MessagesModule,
    ReadReceiptsModule,
    NotificationsModule,
    PushNotificationsModule,
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [ConfigService, REDIS_CLIENT],
      useFactory: (
        configService: ConfigService,
        redis: Redis,
      ): ThrottlerModuleOptions => {
        const isTest = configService.get<string>('NODE_ENV') === 'test';
        // Much higher limits for E2E tests to avoid rate limiting
        const multiplier = isTest ? 100 : 1;
        return {
          throttlers: [
            { name: 'short', ttl: 1000, limit: 20 * multiplier },
            { name: 'medium', ttl: 10000, limit: 100 * multiplier },
            { name: 'long', ttl: 60000, limit: 500 * multiplier },
          ],
          // Redis-backed storage so limits hold across replicas (HPA). Shares
          // the app's Redis client (RedisModule owns its lifecycle). Fails open
          // on Redis outage — see FailOpenThrottlerStorage. Test mode keeps
          // the default in-memory storage.
          ...(isTest
            ? {}
            : {
                storage: new FailOpenThrottlerStorage(
                  new ThrottlerStorageRedisService(redis),
                  { redis },
                ),
              }),
        };
      },
    }),
    ChannelsModule,
    RoomsModule,
    WebsocketModule,
    RedisModule,
    PresenceModule,
    MembershipModule,
    ChannelMembershipModule,
    LivekitModule,
    VoicePresenceModule,
    OnboardingModule,
    DirectMessagesModule,
    FileUploadModule,
    FileModule,
    InstanceModule,
    ModerationModule,
    AppearanceSettingsModule,
    FriendsModule,
    ThreadsModule,
    StorageQuotaModule,
    AliasGroupsModule,
    CustomEmojiModule,
    SoundboardModule,
    GifsModule,
    WebhooksModule,
    ...(process.env.ADMIN_DEBUG_PANEL === 'true' ? [DebugModule] : []),
    // Prometheus metrics (/api/metrics) — opt-in only; when disabled the
    // module isn't imported, so the endpoint does not exist.
    ...(process.env.METRICS_ENABLED === 'true' ? [MetricsModule] : []),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global JwtAuthGuard — all routes require authentication by default.
    // Use @Public() decorator to opt-out specific endpoints.
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // Conditionally provide the (HTTP-only) ThrottlerGuard - skip in test mode
    ...(process.env.NODE_ENV === 'test'
      ? []
      : [
          {
            provide: APP_GUARD,
            useClass: HttpThrottlerGuard,
          },
        ]),
    WebsocketService,
  ],
})
export class AppModule {}
