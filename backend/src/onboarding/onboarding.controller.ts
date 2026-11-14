import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { OnboardingService } from './onboarding.service';
import {
  SetupInstanceDto,
  OnboardingStatusDto,
} from './dto/setup-instance.dto';
import { Public } from '@/auth/public.decorator';
import { SetupResponseDto } from './dto/setup-response.dto';
import { Throttle } from '@nestjs/throttler';

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get('status')
  @Public()
  @ApiOkResponse({ type: OnboardingStatusDto })
  async getStatus(): Promise<OnboardingStatusDto> {
    return this.onboardingService.getStatus();
  }

  @Post('setup')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 2, ttl: 1000 }, long: { limit: 5, ttl: 60000 } })
  @ApiOkResponse({ type: SetupResponseDto })
  async setupInstance(
    @Body() dto: SetupInstanceDto,
  ): Promise<SetupResponseDto> {
    if (!dto.setupToken?.trim()) {
      throw new BadRequestException('Setup token is required');
    }

    const result = await this.onboardingService.completeSetup(
      dto,
      dto.setupToken,
    );

    return {
      success: true,
      message: 'Instance setup completed successfully',
      adminUserId: result.adminUser.id,
      defaultCommunityId: result.defaultCommunity?.id,
    };
  }
}
