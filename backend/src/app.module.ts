import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
import {
  ThrottlerGuard,
  ThrottlerModule,
  ThrottlerModuleOptions,
} from '@nestjs/throttler';
import { ChannelsModule } from './channels/channels.module';
import { MessagesModule } from './messages/messages.module';
import { RoomsModule } from './rooms/rooms.module';
import { WebsocketService } from './websocket/websocket.service';
import { WebsocketModule } from './websocket/websocket.module';
import { RedisModule } from './redis/redis.module';
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
import { DebugModule } from './debug/debug.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';

@Module({
  imports: [
    AuthModule,
    HealthModule,
    DatabaseModule,
    InviteModule,
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    RolesModule,
    UserModule,
    CommunityModule,
    MessagesModule,
    ReadReceiptsModule,
    NotificationsModule,
    PushNotificationsModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService): ThrottlerModuleOptions => {
        const isTest = configService.get<string>('NODE_ENV') === 'test';
        // Much higher limits for E2E tests to avoid rate limiting
        const multiplier = isTest ? 100 : 1;
        return {
          throttlers: [
            {
              name: 'short',
              ttl: 1000,
              limit: 20 * multiplier,
            },
            {
              name: 'medium',
              ttl: 10000,
              limit: 100 * multiplier,
            },
            {
              name: 'long',
              ttl: 60000,
              limit: 500 * multiplier,
            },
          ],
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
    ...(process.env.ADMIN_DEBUG_PANEL === 'true' ? [DebugModule] : []),
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
    // Conditionally provide ThrottlerGuard - skip in test mode
    ...(process.env.NODE_ENV === 'test'
      ? []
      : [
          {
            provide: APP_GUARD,
            useClass: ThrottlerGuard,
          },
        ]),
    WebsocketService,
  ],
})
export class AppModule {}
