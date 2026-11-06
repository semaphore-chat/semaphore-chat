import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DatabaseService } from '@/database/database.service';
import { UserEntity } from '@/user/dto/user-response.dto';
import { RbacResourceType } from '@/auth/rbac-resource.decorator';
import { InstanceRolesService } from '@/roles/instance-roles.service';
import { PermissionsService } from '@/roles/permissions.service';
import { PublicInviteDto } from './dto/public-invite.dto';
import {
  InstanceInvite,
  InstanceInviteDefaultCommunity,
  InstanceInviteUsage,
  Prisma,
  RbacActions,
} from '@prisma/client';

export type InstanceInviteWithRelations = InstanceInvite & {
  defaultCommunities: InstanceInviteDefaultCommunity[];
  usages: InstanceInviteUsage[];
};

@Injectable()
export class InviteService {
  private readonly logger = new Logger(InviteService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly permissionsService: PermissionsService,
    private readonly instanceRolesService: InstanceRolesService,
  ) {}

  /**
   * An invite joins whoever redeems it to its communities, so its creator needs
   * the right to invite to each of them, or instance-wide authority. A community
   * that doesn't exist answers like one you can't invite to.
   */
  private async assertMayInviteTo(
    creator: UserEntity,
    communityIds: string[],
  ): Promise<void> {
    if (communityIds.length === 0) return;
    if (await this.instanceRolesService.hasFullInstanceAuthority(creator)) {
      return;
    }
    for (const communityId of communityIds) {
      const allowed =
        await this.permissionsService.verifyActionsForUserAndResource(
          creator.id,
          communityId,
          RbacResourceType.COMMUNITY,
          [RbacActions.CREATE_INVITE],
        );
      if (!allowed) {
        throw new ForbiddenException(
          `You don't have permission to invite to community ${communityId}`,
        );
      }
    }
  }

  async createInvite(
    creator: UserEntity,
    maxUses?: number,
    validUntil?: Date,
    communityIds: string[] = [],
  ): Promise<InstanceInviteWithRelations> {
    await this.assertMayInviteTo(creator, communityIds);

    // generate a short code for the invite
    let shortCode = this.generateInviteCode();
    // Check if the short code already exists
    while (
      await this.databaseService.instanceInvite.findFirst({
        where: { code: shortCode },
      })
    ) {
      // If it does, generate a new one
      this.logger.warn(`Short code ${shortCode} collision! Generating new one`);
      shortCode = this.generateInviteCode();
    }

    // Logic to create an invite for a user to join an instance
    return this.databaseService.instanceInvite.create({
      data: {
        code: shortCode,
        createdById: creator.id,
        maxUses,
        validUntil,
        ...(communityIds.length > 0
          ? {
              defaultCommunities: {
                create: communityIds.map((communityId) => ({ communityId })),
              },
            }
          : {}),
      },
      include: {
        defaultCommunities: true,
        usages: true,
      },
    });
  }

  async validateInviteCode(
    inviteCode: string,
  ): Promise<InstanceInviteWithRelations | null> {
    const invite = await this.databaseService.instanceInvite.findUnique({
      where: { code: inviteCode },
      include: {
        defaultCommunities: true,
        usages: true,
      },
    });
    if (!invite) return null;
    const now = new Date();

    // Validation conditions
    if (
      invite.disabled ||
      (invite.validUntil && now > invite.validUntil) ||
      (invite.maxUses !== null && invite.uses >= invite.maxUses)
    ) {
      return null;
    }
    return invite;
  }

  async redeemInviteWithTx(
    tx: Prisma.TransactionClient,
    inviteCode: string,
    userId: string,
  ): Promise<InstanceInviteWithRelations | null> {
    // Use a transaction for safety
    const invite = await tx.instanceInvite.findUnique({
      where: { code: inviteCode },
      include: {
        defaultCommunities: true,
      },
    });

    if (!invite) {
      this.logger.warn(`Invalid invite code: ${inviteCode}`);
      return null;
    }

    const now = new Date();
    if (
      invite.disabled ||
      (invite.validUntil && now > invite.validUntil) ||
      (invite.maxUses !== null && invite.uses >= invite.maxUses)
    ) {
      this.logger.warn(`Invalid or already used invite: ${invite.code}`);
      return null;
    }

    // Check if user has already used this invite via the junction table
    const existingUsage = await tx.instanceInviteUsage.findUnique({
      where: {
        inviteId_userId: {
          inviteId: invite.id,
          userId,
        },
      },
    });

    if (existingUsage) {
      this.logger.warn(`Invalid or already used invite: ${invite.code}`);
      return null;
    }

    // Record the usage in the junction table
    await tx.instanceInviteUsage.create({
      data: {
        inviteId: invite.id,
        userId,
      },
    });

    // Update uses count and disabled status
    const updated = await tx.instanceInvite.update({
      where: { code: inviteCode },
      data: {
        uses: { increment: 1 },
        disabled: invite.maxUses !== null && invite.uses + 1 >= invite.maxUses,
      },
      include: {
        defaultCommunities: true,
        usages: true,
      },
    });

    return updated;
  }

  async getInvites(user: UserEntity): Promise<InstanceInviteWithRelations[]> {
    return this.databaseService.instanceInvite.findMany({
      where: { createdById: user.id },
      include: {
        createdBy: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
        defaultCommunities: true,
        usages: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * What the join screen shows, for a code that can still be used. Anyone can
   * ask, so no ids, no redeemers and no target communities.
   */
  async getPublicInvite(code: string): Promise<PublicInviteDto | null> {
    const invite = await this.databaseService.instanceInvite.findUnique({
      where: { code },
      select: {
        code: true,
        uses: true,
        maxUses: true,
        validUntil: true,
        disabled: true,
        createdBy: { select: { username: true } },
      },
    });
    if (
      !invite ||
      invite.disabled ||
      (invite.validUntil && new Date() > invite.validUntil) ||
      (invite.maxUses !== null && invite.uses >= invite.maxUses)
    ) {
      return null;
    }
    return invite;
  }

  async getInviteByCode(
    code: string,
  ): Promise<InstanceInviteWithRelations | null> {
    return this.databaseService.instanceInvite.findUnique({
      where: { code },
      include: {
        createdBy: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
        defaultCommunities: true,
        usages: true,
      },
    });
  }

  async deleteInvite(user: UserEntity, code: string): Promise<void> {
    const invite = await this.databaseService.instanceInvite.findUnique({
      where: { code },
    });

    if (!invite) {
      throw new NotFoundException('Invite not found');
    }

    // Only allow the creator to delete the invite (admins bypass via RBAC)
    if (invite.createdById !== user.id) {
      throw new ForbiddenException('Unauthorized to delete this invite');
    }

    await this.databaseService.instanceInvite.delete({
      where: { code },
    });
  }

  private generateInviteCode(length: number = 12) {
    return randomBytes(length).toString('base64url').slice(0, length);
  }
}
