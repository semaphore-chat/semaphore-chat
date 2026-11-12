import {
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { MembershipService } from './membership.service';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { AuthenticatedRequest } from '@/types';
import { AcceptInviteResponseDto } from '@/invite/dto/accept-invite-response.dto';

/**
 * Joining an invite with an existing account.
 *
 * This lives in the membership module because it needs both services (the
 * invite code and the membership-creation path). Declaring the existing
 * InviteController's module with a dependency on MembershipModule would be
 * circular (Membership -> Community -> Auth -> User -> Invite).
 */
@Controller('invite')
@UseGuards(JwtAuthGuard)
export class AcceptInviteController {
  constructor(private readonly membershipService: MembershipService) {}

  @Post(':code/accept')
  @HttpCode(200)
  // Same per-caller throttle as registration: a public code, worth guessing
  // only at brute-force rates.
  @Throttle({ short: { limit: 3, ttl: 1000 }, long: { limit: 10, ttl: 60000 } })
  @ApiOperation({ operationId: 'inviteControllerAcceptInvite' })
  @ApiOkResponse({ type: AcceptInviteResponseDto })
  async acceptInvite(
    @Req() req: AuthenticatedRequest,
    @Param('code') code: string,
  ): Promise<AcceptInviteResponseDto> {
    return this.membershipService.acceptInvite(code, req.user.id);
  }
}
