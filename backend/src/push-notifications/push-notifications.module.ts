import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DatabaseModule } from '@/database/database.module';
import { PushNotificationsService } from './push-notifications.service';
import { PushNotificationsController } from './push-notifications.controller';
import {
  PUSH_PRIVATE_HOSTS,
  parsePushPrivateHosts,
} from './push-private-hosts';

@Module({
  imports: [ConfigModule, DatabaseModule],
  providers: [
    PushNotificationsService,
    {
      // Read once at boot. Env validation already refused a bad value; this
      // throws too, so nothing starts with a half-read allowlist.
      provide: PUSH_PRIVATE_HOSTS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const { hosts, errors } = parsePushPrivateHosts(
          config.get<string>('PUSH_PRIVATE_HOSTS'),
        );
        if (errors.length > 0) throw new Error(errors.join('; '));
        return hosts;
      },
    },
  ],
  controllers: [PushNotificationsController],
  exports: [PushNotificationsService],
})
export class PushNotificationsModule {}
