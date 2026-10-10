import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiNoContentResponse } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '@/types';
import { ReportJoinFailureDto } from './dto/report-join-failure.dto';
import { JoinFailureThrottleGuard } from './join-failure-throttle.guard';

/**
 * Client-side voice diagnostics. Join failures happen in the browser (ICE,
 * UDP blocked, permissions), where the server never sees them; this lets
 * admins find them in the server log. Logged only, never stored.
 */
@Controller('voice/diagnostics')
export class VoiceDiagnosticsController {
  private readonly logger = new Logger(VoiceDiagnosticsController.name);

  @Post('join-failure')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JoinFailureThrottleGuard)
  @ApiNoContentResponse({ description: 'Logged' })
  reportJoinFailure(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ReportJoinFailureDto,
  ): void {
    this.logger.warn(
      `Voice join failed for user ${req.user.id}: ${JSON.stringify({
        errorClass: dto.errorClass,
        message: dto.message,
        durationMs: dto.durationMs,
        candidateTypes: dto.candidateTypes,
        platform: dto.platform,
        os: dto.os,
        appVersion: dto.appVersion,
        channelId: dto.isDm ? undefined : dto.channelId,
        isDm: dto.isDm,
      })}`,
    );
  }
}
