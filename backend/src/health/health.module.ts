import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { RedisModule } from '@/redis/redis.module';
import { DatabaseModule } from '@/database/database.module';

@Module({
  imports: [RedisModule, DatabaseModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
