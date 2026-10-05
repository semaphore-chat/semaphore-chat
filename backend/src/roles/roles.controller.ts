import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  HttpCode,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { ChannelAccessService } from './channel-access.service';
import { CommunityRolesService } from './community-roles.service';
import { InstanceRolesService } from './instance-roles.service';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { RbacGuard } from '@/auth/rbac.guard';
import { RequiredActions } from '@/auth/rbac-action.decorator';
import { RbacActions } from '@prisma/client';
import {
  RbacResource,
  RbacResourceType,
  ResourceIdSource,
} from '@/auth/rbac-resource.decorator';

import { UserRolesResponseDto, RoleDto } from './dto/user-roles-response.dto';
import { RoleUserDto } from './dto/role-users-response.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { ReorderRolesDto } from './dto/reorder-roles.dto';
import { AssignRoleDto } from './dto/assign-role.dto';
import { AssignInstanceRoleDto } from './dto/assign-instance-role.dto';
import { CommunityRolesResponseDto } from './dto/community-roles-response.dto';
import { AuthenticatedRequest } from '@/types';

@Controller('roles')
@UseGuards(JwtAuthGuard)
export class RolesController {
  constructor(
    private readonly communityRolesService: CommunityRolesService,
    private readonly instanceRolesService: InstanceRolesService,
    private readonly channelAccessService: ChannelAccessService,
  ) {}

  @Get('my/community/:communityId')
  async getMyRolesForCommunity(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<UserRolesResponseDto> {
    return this.communityRolesService.getUserRolesForCommunity(
      req.user.id,
      communityId,
    );
  }

  @Get('my/channel/:channelId')
  async getMyRolesForChannel(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<UserRolesResponseDto> {
    // A channel the caller can't see answers exactly like a missing one
    // (empty roles), so this can't be used to probe for hidden channels.
    if (
      !(await this.channelAccessService.canViewChannel(req.user.id, channelId))
    ) {
      return {
        userId: req.user.id,
        resourceId: channelId,
        resourceType: 'CHANNEL',
        roles: [],
      };
    }
    return this.communityRolesService.getUserRolesForChannel(
      req.user.id,
      channelId,
    );
  }

  @Get('my/instance')
  async getMyInstanceRoles(
    @Req() req: AuthenticatedRequest,
  ): Promise<UserRolesResponseDto> {
    return this.instanceRolesService.getUserInstanceRoles(req.user.id);
  }

  @Get('user/:userId/community/:communityId')
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.READ_MEMBER)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  async getUserRolesForCommunity(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('communityId', ParseUUIDPipe) communityId: string,
  ): Promise<UserRolesResponseDto> {
    return this.communityRolesService.getUserRolesForCommunity(
      userId,
      communityId,
    );
  }

  @Get('user/:userId/channel/:channelId')
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.READ_MEMBER)
  @RbacResource({
    type: RbacResourceType.CHANNEL,
    idKey: 'channelId',
    source: ResourceIdSource.PARAM,
  })
  async getUserRolesForChannel(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<UserRolesResponseDto> {
    return this.communityRolesService.getUserRolesForChannel(userId, channelId);
  }

  @Get('user/:userId/instance')
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.READ_USER)
  @RbacResource({ type: RbacResourceType.INSTANCE })
  async getUserInstanceRoles(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<UserRolesResponseDto> {
    return this.instanceRolesService.getUserInstanceRoles(userId);
  }

  // ===== ROLE MANAGEMENT ENDPOINTS =====

  @Get('community/:communityId')
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.READ_ROLE)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  async getCommunityRoles(
    @Param('communityId', ParseUUIDPipe) communityId: string,
  ): Promise<CommunityRolesResponseDto> {
    return this.communityRolesService.getCommunityRoles(communityId);
  }

  @Patch('community/:communityId/reorder')
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.UPDATE_ROLE)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  @ApiOkResponse({ type: [RoleDto] })
  async reorderRoles(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Body() dto: ReorderRolesDto,
  ): Promise<RoleDto[]> {
    return this.communityRolesService.reorderRoles(communityId, dto.roleIds);
  }

  @Post('community/:communityId/reset-defaults')
  @HttpCode(200)
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.UPDATE_ROLE)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  @ApiOkResponse({ type: CommunityRolesResponseDto })
  async resetDefaultCommunityRoles(
    @Param('communityId', ParseUUIDPipe) communityId: string,
  ): Promise<CommunityRolesResponseDto> {
    return this.communityRolesService.resetDefaultCommunityRoles(communityId);
  }

  @Post('community/:communityId')
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.CREATE_ROLE)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  async createCommunityRole(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Body() createRoleDto: CreateRoleDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<RoleDto> {
    return this.communityRolesService.createCommunityRole(
      communityId,
      createRoleDto,
      req.user.id,
      req.user.role,
    );
  }

  // communityId is required in the route so the RbacGuard can resolve
  // community-scoped permissions before the handler runs (roleId alone
  // would require a DB lookup inside the guard to find the community).
  @Put('community/:communityId/:roleId')
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.UPDATE_ROLE)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  async updateRole(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() updateRoleDto: UpdateRoleDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<RoleDto> {
    return this.communityRolesService.updateRole(
      roleId,
      communityId,
      updateRoleDto,
      req.user.id,
      req.user.role,
    );
  }

  @Delete('community/:communityId/:roleId')
  @HttpCode(204)
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.DELETE_ROLE)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  async deleteRole(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ): Promise<void> {
    return this.communityRolesService.deleteRole(roleId, communityId);
  }

  // ===== USER-ROLE ASSIGNMENT ENDPOINTS =====

  @Post('community/:communityId/assign')
  @HttpCode(204)
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.UPDATE_MEMBER)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  async assignRoleToUser(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Body() assignRoleDto: AssignRoleDto,
  ): Promise<void> {
    return this.communityRolesService.assignUserToCommunityRole(
      assignRoleDto.userId,
      communityId,
      assignRoleDto.roleId,
    );
  }

  @Delete('community/:communityId/users/:userId/roles/:roleId')
  @HttpCode(204)
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.UPDATE_MEMBER)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  async removeRoleFromUser(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ): Promise<void> {
    return this.communityRolesService.removeUserFromCommunityRole(
      userId,
      communityId,
      roleId,
    );
  }

  @Get('community/:communityId/:roleId/users')
  @ApiOkResponse({ type: [RoleUserDto] })
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.READ_ROLE)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  async getUsersForRole(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ): Promise<RoleUserDto[]> {
    return this.communityRolesService.getUsersForRole(roleId, communityId);
  }

  // ===== INSTANCE ROLE MANAGEMENT ENDPOINTS =====

  /**
   * Get all instance-level roles
   */
  @Get('instance/all')
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.READ_INSTANCE_SETTINGS)
  @RbacResource({ type: RbacResourceType.INSTANCE })
  async getInstanceRoles(): Promise<RoleDto[]> {
    return this.instanceRolesService.getInstanceRoles();
  }

  /**
   * Create a new instance role
   */
  @Post('instance')
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.UPDATE_INSTANCE_SETTINGS)
  @RbacResource({ type: RbacResourceType.INSTANCE })
  async createInstanceRole(
    @Body() createRoleDto: CreateRoleDto,
  ): Promise<RoleDto> {
    return this.instanceRolesService.createInstanceRole(
      createRoleDto.name,
      createRoleDto.actions,
    );
  }

  /**
   * Update an instance role
   */
  @Put('instance/:roleId')
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.UPDATE_INSTANCE_SETTINGS)
  @RbacResource({ type: RbacResourceType.INSTANCE })
  async updateInstanceRole(
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() updateRoleDto: UpdateRoleDto,
  ): Promise<RoleDto> {
    return this.instanceRolesService.updateInstanceRole(roleId, updateRoleDto);
  }

  /**
   * Delete an instance role
   */
  @Delete('instance/:roleId')
  @HttpCode(204)
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.UPDATE_INSTANCE_SETTINGS)
  @RbacResource({ type: RbacResourceType.INSTANCE })
  async deleteInstanceRole(
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ): Promise<void> {
    return this.instanceRolesService.deleteInstanceRole(roleId);
  }

  /**
   * Assign an instance role to a user
   */
  @Post('instance/:roleId/assign')
  @HttpCode(204)
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.UPDATE_USER)
  @RbacResource({ type: RbacResourceType.INSTANCE })
  async assignInstanceRole(
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: AssignInstanceRoleDto,
  ): Promise<void> {
    return this.instanceRolesService.assignUserToInstanceRole(
      dto.userId,
      roleId,
    );
  }

  /**
   * Remove an instance role from a user
   */
  @Delete('instance/:roleId/users/:userId')
  @HttpCode(204)
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.UPDATE_USER)
  @RbacResource({ type: RbacResourceType.INSTANCE })
  async removeInstanceRole(
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.instanceRolesService.removeUserFromInstanceRole(userId, roleId);
  }

  /**
   * Get users assigned to an instance role
   */
  @Get('instance/:roleId/users')
  @ApiOkResponse({ type: [RoleUserDto] })
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.READ_USER)
  @RbacResource({ type: RbacResourceType.INSTANCE })
  async getInstanceRoleUsers(
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ): Promise<RoleUserDto[]> {
    return this.instanceRolesService.getInstanceRoleUsers(roleId);
  }
}
