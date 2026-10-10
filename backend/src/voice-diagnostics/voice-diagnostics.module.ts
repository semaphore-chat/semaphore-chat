import { Module } from '@nestjs/common';
import { VoiceDiagnosticsController } from './voice-diagnostics.controller';
import { JoinFailureThrottleGuard } from './join-failure-throttle.guard';

@Module({
  controllers: [VoiceDiagnosticsController],
  providers: [JoinFailureThrottleGuard],
})
export class VoiceDiagnosticsModule {}
