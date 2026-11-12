import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse, ApiCreatedResponse, ApiQuery } from '@nestjs/swagger';
import { InviteService } from './invite.service';
import { RbacActions } from '@prisma/client';
import { CreateInviteDto } from './dto/create-invite.dto';
import { InviteResponseDto } from './dto/invite-response.dto';
import { PublicInviteDto } from './dto/public-invite.dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { Public } from '@/auth/public.decorator';
import { RbacGuard } from '@/auth/rbac.guard';
import { RequiredActions } from '@/auth/rbac-action.decorator';
import { RbacResource, RbacResourceType } from '@/auth/rbac-resource.decorator';
import { AuthenticatedRequest } from '@/types';

@Controller('invite')
export class InviteController {
  constructor(private readonly inviteService: InviteService) {}

  // The service decides: the community's own CREATE_INVITE in every community
  // the invite names, or instance invite authority (#685).
  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiCreatedResponse({ type: InviteResponseDto })
  async createInvite(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateInviteDto,
  ): Promise<InviteResponseDto> {
    return this.inviteService.createInvite(
      req.user,
      dto.maxUses,
      dto.validUntil,
      dto.communityIds,
    );
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiQuery({
    name: 'communityId',
    required: false,
    description: 'Only the invites that include this community',
  })
  @ApiOkResponse({ type: [InviteResponseDto] })
  async getInvites(
    @Req() req: AuthenticatedRequest,
    @Query('communityId') communityId?: string,
  ): Promise<InviteResponseDto[]> {
    return this.inviteService.getInvites(req.user, communityId);
  }

  @Get('public/:code')
  @Public()
  @Throttle({ short: { limit: 5, ttl: 1000 }, long: { limit: 20, ttl: 60000 } })
  @ApiOkResponse({ type: PublicInviteDto })
  async getPublicInvite(@Param('code') code: string): Promise<PublicInviteDto> {
    return this.inviteService.getPublicInvite(code);
  }

  @Get(':code')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequiredActions(RbacActions.READ_INSTANCE_INVITE)
  @RbacResource({ type: RbacResourceType.INSTANCE })
  @ApiOkResponse({ type: InviteResponseDto })
  async getInvite(
    @Param('code') code: string,
  ): Promise<InviteResponseDto | null> {
    return this.inviteService.getInviteByCode(code);
  }

  @Delete(':code')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async deleteInvite(
    @Req() req: AuthenticatedRequest,
    @Param('code') code: string,
  ): Promise<void> {
    return this.inviteService.deleteInvite(req.user, code);
  }
}
