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
import { ErrorCode } from '@semaphore-chat/shared';
import {
  InstanceInvite,
  InstanceInviteDefaultCommunity,
  InstanceInviteUsage,
  InstanceRole,
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
   * The action on the resource, with the instance owner above it as above
   * every RBAC check (the guard's own bypass).
   */
  private async may(
    user: UserEntity,
    action: RbacActions,
    resourceType: RbacResourceType,
    resourceId?: string,
  ): Promise<boolean> {
    if (user.role === InstanceRole.OWNER) return true;
    return this.permissionsService.verifyActionsForUserAndResource(
      user.id,
      resourceId,
      resourceType,
      [action],
    );
  }

  /**
   * An invite joins whoever redeems it to its communities. With communities
   * named, the creator needs to invite to each of them (the community's own
   * CREATE_INVITE) or instance-wide authority; with none named it is an
   * instance invite, which needs CREATE_INSTANCE_INVITE (#685). A community
   * that doesn't exist answers like one you can't invite to.
   */
  private async assertMayInvite(
    creator: UserEntity,
    communityIds: string[],
  ): Promise<void> {
    if (communityIds.length === 0) {
      if (
        !(await this.may(
          creator,
          RbacActions.CREATE_INSTANCE_INVITE,
          RbacResourceType.INSTANCE,
        ))
      ) {
        throw new ForbiddenException(
          "You don't have permission to create instance invites",
        );
      }
      return;
    }
    const denied = await this.firstCommunityNotInvitableTo(
      creator,
      communityIds,
    );
    if (denied !== undefined) {
      throw new ForbiddenException(
        `You don't have permission to invite to community ${denied}`,
      );
    }
  }

  /**
   * The first of these communities the user may not invite to (full instance
   * authority may invite to all), or undefined when they may invite to every
   * one. The create check and the filtered invite list both use this, so the
   * two rules cannot drift.
   */
  private async firstCommunityNotInvitableTo(
    user: UserEntity,
    communityIds: string[],
  ): Promise<string | undefined> {
    if (await this.instanceRolesService.hasFullInstanceAuthority(user)) {
      return undefined;
    }
    for (const communityId of communityIds) {
      const allowed = await this.may(
        user,
        RbacActions.CREATE_INVITE,
        RbacResourceType.COMMUNITY,
        communityId,
      );
      if (!allowed) return communityId;
    }
    return undefined;
  }

  async createInvite(
    creator: UserEntity,
    maxUses?: number,
    validUntil?: Date,
    communityIds: string[] = [],
  ): Promise<InstanceInviteWithRelations> {
    await this.assertMayInvite(creator, communityIds);

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

  /**
   * Lock the invite row until the transaction ends, so concurrent redemptions
   * of one code run one after another: without it, two transactions both read
   * `uses < maxUses` and both pass the limit check below.
   */
  private async lockInvite(
    tx: Prisma.TransactionClient,
    inviteCode: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "InstanceInvite" WHERE "code" = ${inviteCode} FOR UPDATE`;
  }

  /**
   * Spend a use of the invite for an existing account, atomically.
   * - `redeemed`: a use was consumed now.
   * - `already_used`: the invite is still usable and this user spent a use on
   *   it earlier; nothing more is consumed.
   * - `unusable`: unknown code, disabled, expired or out of uses. This holds
   *   for someone who used it before too: a past use is not a standing pass
   *   back into the invite's communities (e.g. after being kicked) once the
   *   invite has been disabled, has expired or is used up.
   */
  async redeemForExistingUser(
    tx: Prisma.TransactionClient,
    inviteCode: string,
    userId: string,
  ): Promise<'redeemed' | 'already_used' | 'unusable'> {
    await this.lockInvite(tx, inviteCode);
    const invite = await tx.instanceInvite.findUnique({
      where: { code: inviteCode },
      select: {
        id: true,
        disabled: true,
        validUntil: true,
        uses: true,
        maxUses: true,
      },
    });
    if (!invite) return 'unusable';
    if (
      invite.disabled ||
      (invite.validUntil && new Date() > invite.validUntil) ||
      (invite.maxUses !== null && invite.uses >= invite.maxUses)
    ) {
      return 'unusable';
    }
    const existingUsage = await tx.instanceInviteUsage.findUnique({
      where: { inviteId_userId: { inviteId: invite.id, userId } },
    });
    if (existingUsage) return 'already_used';
    const redeemed = await this.redeemInviteWithTx(tx, inviteCode, userId);
    return redeemed ? 'redeemed' : 'unusable';
  }

  async redeemInviteWithTx(
    tx: Prisma.TransactionClient,
    inviteCode: string,
    userId: string,
  ): Promise<InstanceInviteWithRelations | null> {
    await this.lockInvite(tx, inviteCode);
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

  /**
   * Instance readers see the invites they created, as before. Given a
   * community, a caller with that community's CREATE_INVITE sees the invites
   * that include it, whoever created them, as long as they could create the
   * same invite themselves (#685).
   */
  async getInvites(
    user: UserEntity,
    communityId?: string,
  ): Promise<InstanceInviteWithRelations[]> {
    const include = {
      createdBy: {
        select: {
          id: true,
          username: true,
          displayName: true,
        },
      },
      defaultCommunities: true,
      usages: true,
    } as const;

    if (communityId === undefined) {
      const instanceReader = await this.may(
        user,
        RbacActions.READ_INSTANCE_INVITE,
        RbacResourceType.INSTANCE,
      );
      if (!instanceReader) {
        throw new ForbiddenException(
          "You don't have permission to view instance invites",
        );
      }
      return this.databaseService.instanceInvite.findMany({
        where: { createdById: user.id },
        include,
        orderBy: { createdAt: 'desc' },
      });
    }

    // The caller must be able to create an invite for this community, and
    // sees only the invites they could create themselves: a code joins its
    // redeemer to every community it names, so an invite that also reaches a
    // community the caller can't invite to stays hidden.
    if (
      (await this.firstCommunityNotInvitableTo(user, [communityId])) !==
      undefined
    ) {
      throw new ForbiddenException(
        "You don't have permission to view this community's invites",
      );
    }

    const invites = await this.databaseService.instanceInvite.findMany({
      where: { defaultCommunities: { some: { communityId } } },
      include,
      orderBy: { createdAt: 'desc' },
    });
    const visible: InstanceInviteWithRelations[] = [];
    for (const invite of invites) {
      const denied = await this.firstCommunityNotInvitableTo(
        user,
        invite.defaultCommunities.map((target) => target.communityId),
      );
      if (denied === undefined) visible.push(invite);
    }
    return visible;
  }

  /**
   * What the join screen shows, for a code that can still be used. Anyone can
   * ask, so no ids, no redeemers and no target communities.
   *
   * Every unusable code answers 404 with its own reason, so the join screen can
   * say why and a generated client never has to decode an empty body.
   */
  async getPublicInvite(code: string): Promise<PublicInviteDto> {
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
    if (!invite) {
      throw new NotFoundException('This invite link is invalid.', {
        description: 'Not Found',
        errorCode: ErrorCode.INVITE_NOT_FOUND,
      });
    }
    // Expiry and exhaustion before `disabled`: redemption also disables an
    // invite once its last use is spent, and the more specific reason helps.
    if (invite.validUntil && new Date() > invite.validUntil) {
      throw new NotFoundException('This invite has expired.', {
        description: 'Not Found',
        errorCode: ErrorCode.INVITE_EXPIRED,
      });
    }
    if (invite.maxUses !== null && invite.uses >= invite.maxUses) {
      throw new NotFoundException(
        'This invite has reached its maximum number of uses.',
        {
          description: 'Not Found',
          errorCode: ErrorCode.INVITE_EXHAUSTED,
        },
      );
    }
    if (invite.disabled) {
      throw new NotFoundException('This invite has been disabled.', {
        description: 'Not Found',
        errorCode: ErrorCode.INVITE_DISABLED,
      });
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

  /**
   * Deleting: the creator, a holder of the instance delete action, or someone
   * who may delete invites in every community the invite names (#685).
   */
  async deleteInvite(user: UserEntity, code: string): Promise<void> {
    const invite = await this.databaseService.instanceInvite.findUnique({
      where: { code },
      include: { defaultCommunities: true },
    });

    if (!invite) {
      throw new NotFoundException('Invite not found');
    }

    if (invite.createdById !== user.id) {
      const mayDeleteInstance = await this.may(
        user,
        RbacActions.DELETE_INSTANCE_INVITE,
        RbacResourceType.INSTANCE,
      );
      const communityIds = invite.defaultCommunities.map(
        (target) => target.communityId,
      );
      const mayDeleteCommunityInvites =
        communityIds.length > 0 &&
        (
          await Promise.all(
            communityIds.map((communityId) =>
              this.may(
                user,
                RbacActions.DELETE_INVITE,
                RbacResourceType.COMMUNITY,
                communityId,
              ),
            ),
          )
        ).every(Boolean);
      if (!mayDeleteInstance && !mayDeleteCommunityInvites) {
        throw new ForbiddenException('Unauthorized to delete this invite');
      }
    }

    await this.databaseService.instanceInvite.delete({
      where: { code },
    });
  }

  private generateInviteCode(length: number = 12) {
    return randomBytes(length).toString('base64url').slice(0, length);
  }
}
