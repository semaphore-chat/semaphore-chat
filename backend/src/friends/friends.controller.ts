import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Req,
  UseGuards,
  UseInterceptors,
  ClassSerializerInterceptor,
} from '@nestjs/common';
import { ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';
import { FriendsService } from './friends.service';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { AuthenticatedRequest } from '@/types';
import {
  FriendshipDto,
  PendingRequestsDto,
  FriendshipStatusDto,
  FriendListItemDto,
} from './dto/friends-response.dto';
import { UserEntity } from '@/user/dto/user-response.dto';
import { SuccessResponseDto } from '@/common/dto/common-response.dto';

@Controller('friends')
@UseGuards(JwtAuthGuard)
@UseInterceptors(ClassSerializerInterceptor)
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  /**
   * Get all friends for the current user
   */
  @Get()
  @ApiOkResponse({ type: [FriendListItemDto] })
  async getFriends(
    @Req() req: AuthenticatedRequest,
  ): Promise<FriendListItemDto[]> {
    const friends = await this.friendsService.getFriends(req.user.id);
    return friends.map(
      (friend) => new FriendListItemDto(friend.friendshipId, friend.user),
    );
  }

  /**
   * Get pending friend requests (sent and received)
   */
  @Get('requests')
  @ApiOkResponse({ type: PendingRequestsDto })
  async getPendingRequests(
    @Req() req: AuthenticatedRequest,
  ): Promise<PendingRequestsDto> {
    const result = await this.friendsService.getPendingRequests(req.user.id);
    return {
      sent: result.sent.map((f) => ({
        ...f,
        userA: new UserEntity(f.userA),
        userB: new UserEntity(f.userB),
      })),
      received: result.received.map((f) => ({
        ...f,
        userA: new UserEntity(f.userA),
        userB: new UserEntity(f.userB),
      })),
    };
  }

  /**
   * Get friendship status with a specific user
   */
  @Get('status/:userId')
  @ApiOkResponse({ type: FriendshipStatusDto })
  async getFriendshipStatus(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
  ): Promise<FriendshipStatusDto> {
    return this.friendsService.getFriendshipStatus(req.user.id, userId);
  }

  /**
   * Send a friend request to a user
   */
  @Post('request/:userId')
  @ApiCreatedResponse({ type: FriendshipDto })
  async sendFriendRequest(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
  ): Promise<FriendshipDto> {
    return this.friendsService.sendFriendRequest(req.user.id, userId);
  }

  /**
   * Accept a friend request
   */
  @Post('accept/:id')
  @ApiCreatedResponse({ type: FriendshipDto })
  async acceptFriendRequest(
    @Req() req: AuthenticatedRequest,
    @Param('id') friendshipId: string,
  ): Promise<FriendshipDto> {
    return this.friendsService.acceptFriendRequest(req.user.id, friendshipId);
  }

  /**
   * Decline a friend request
   */
  @Delete('decline/:id')
  @ApiOkResponse({ type: SuccessResponseDto })
  async declineFriendRequest(
    @Req() req: AuthenticatedRequest,
    @Param('id') friendshipId: string,
  ): Promise<{ success: boolean }> {
    await this.friendsService.declineFriendRequest(req.user.id, friendshipId);
    return { success: true };
  }

  /**
   * Cancel a sent friend request
   */
  @Delete('cancel/:id')
  @ApiOkResponse({ type: SuccessResponseDto })
  async cancelFriendRequest(
    @Req() req: AuthenticatedRequest,
    @Param('id') friendshipId: string,
  ): Promise<{ success: boolean }> {
    await this.friendsService.cancelFriendRequest(req.user.id, friendshipId);
    return { success: true };
  }

  /**
   * Remove a friend (unfriend)
   */
  @Delete(':id')
  @ApiOkResponse({ type: SuccessResponseDto })
  async removeFriend(
    @Req() req: AuthenticatedRequest,
    @Param('id') friendshipId: string,
  ): Promise<{ success: boolean }> {
    await this.friendsService.removeFriend(req.user.id, friendshipId);
    return { success: true };
  }
}
