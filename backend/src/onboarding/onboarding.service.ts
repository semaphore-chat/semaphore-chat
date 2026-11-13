import { Injectable, ConflictException, Logger, Inject } from '@nestjs/common';
import { DatabaseService } from '@/database/database.service';
import { REDIS_CLIENT } from '@/redis/redis.constants';
import Redis from 'ioredis';
import { CommunityRolesService } from '@/roles/community-roles.service';
import { InstanceRolesService } from '@/roles/instance-roles.service';
import {
  EpochBump,
  PermissionsCacheService,
} from '@/roles/permissions-cache.service';
import { InstanceRole, Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { generateInviteCode } from '@/invite/invite-code.util';
import { SetupInstanceDto } from './dto/setup-instance.dto';

/**
 * Transaction-scoped Postgres advisory lock key for first-run setup.
 * Arbitrary but stable: two concurrent setups must serialize on this key.
 */
const SETUP_ADVISORY_LOCK_KEY = 73_150_001;

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);
  private readonly SETUP_TOKEN_KEY = 'onboarding:setup-token';
  private readonly SETUP_TOKEN_TTL = 900; // 15 minutes

  constructor(
    private readonly databaseService: DatabaseService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly communityRolesService: CommunityRolesService,
    private readonly instanceRolesService: InstanceRolesService,
    private readonly permissionsCacheService: PermissionsCacheService,
  ) {}

  /**
   * Check if the instance needs initial setup
   * Returns true if there are no users AND no active instance invites
   */
  async needsSetup(): Promise<boolean> {
    return this.isSetupNeeded(this.databaseService);
  }

  /**
   * `needsSetup` against a transaction client, so the same check can be
   * repeated under the setup lock.
   */
  private async isSetupNeeded(
    db: Prisma.TransactionClient | DatabaseService,
  ): Promise<boolean> {
    const userCount = await db.user.count();

    if (userCount > 0) {
      return false;
    }

    // Also check if there are any active instance invites
    // If someone manually created invites, we shouldn't override that
    const activeInvites = await db.instanceInvite.count({
      where: {
        disabled: false,
      },
    });

    return activeInvites === 0;
  }

  /**
   * Get existing setup token from Redis if it exists
   */
  private async getExistingSetupToken(): Promise<string | null> {
    return this.redis.get(this.SETUP_TOKEN_KEY);
  }

  /**
   * Generate a temporary setup token for the onboarding process
   * Returns existing token if one is already present in Redis
   */
  async generateSetupToken(): Promise<string> {
    if (!(await this.needsSetup())) {
      throw new ConflictException('Instance setup is not needed');
    }

    // Check if token already exists
    const existingToken = await this.getExistingSetupToken();
    if (existingToken) {
      this.logger.log('Returning existing setup token from Redis');
      return existingToken;
    }

    // Generate new token only if none exists
    const setupToken = randomUUID();
    await this.redis.set(
      this.SETUP_TOKEN_KEY,
      setupToken,
      'EX',
      this.SETUP_TOKEN_TTL,
    );
    this.logger.log(
      'Generated new setup token for onboarding (stored in Redis)',
    );
    return setupToken;
  }

  /**
   * Validate the setup token
   */
  async validateSetupToken(token: string): Promise<boolean> {
    const storedToken = await this.redis.get(this.SETUP_TOKEN_KEY);
    if (!storedToken) {
      return false;
    }

    return storedToken === token;
  }

  /**
   * Complete the instance setup process
   */
  async completeSetup(
    dto: SetupInstanceDto,
    setupToken: string,
  ): Promise<{
    // Raw Prisma User row (NOT wrapped in UserEntity / new UserEntity()) —
    // matches what tx.user.create() actually returns below. Only `.id` is
    // ever read from this by the caller (OnboardingController), so the
    // missing UserEntity wrap/exclusion never reaches an HTTP response;
    // typing it as UserEntity here would misleadingly imply a
    // sanitization step that isn't happening. Not changed — see Task 3
    // report.
    adminUser: User;
    defaultCommunity: { id: string; name: string } | null;
  }> {
    // Validate setup token
    if (!(await this.validateSetupToken(setupToken))) {
      throw new ConflictException('Invalid setup token');
    }

    // Double-check that setup is still needed
    if (!(await this.needsSetup())) {
      throw new ConflictException('Instance setup is no longer needed');
    }

    // Epoch bumps from the tx-nested role mutations below are collected here
    // and executed only after the transaction commits (see
    // PermissionsCacheService — bumping pre-commit races concurrent readers).
    const pendingBumps: EpochBump[] = [];

    const result = await this.databaseService.$transaction(async (tx) => {
      // The token and needsSetup checks above happen before the transaction;
      // two concurrent submits can both pass them. Serialize on a
      // transaction-scoped advisory lock and repeat the check with the lock
      // held, so only one submit can create the owner.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${SETUP_ADVISORY_LOCK_KEY}::bigint)`;
      if (!(await this.isSetupNeeded(tx))) {
        throw new ConflictException('Instance setup is no longer needed');
      }

      // 1. Save the instance name and description from the wizard
      const existingSettings = await tx.instanceSettings.findFirst();
      const instanceSettings = {
        name: dto.instanceName,
        description: dto.instanceDescription ?? null,
      };
      if (existingSettings) {
        await tx.instanceSettings.update({
          where: { id: existingSettings.id },
          data: instanceSettings,
        });
      } else {
        await tx.instanceSettings.create({ data: instanceSettings });
      }

      // 2. Create admin user
      const hashedPassword = await bcrypt.hash(dto.adminPassword, 10);
      const adminUser = await tx.user.create({
        data: {
          username: dto.adminUsername.toLowerCase(),
          displayName: dto.adminUsername.toLowerCase(),
          email: dto.adminEmail,
          hashedPassword,
          verified: true, // First user is auto-verified
          role: InstanceRole.OWNER,
        },
      });

      this.logger.log(`Created admin user: ${adminUser.username}`);

      // 3. Create default community if requested
      let defaultCommunity: { id: string; name: string } | null = null;
      if (dto.createDefaultCommunity !== false) {
        const communityName = dto.defaultCommunityName || 'General';

        defaultCommunity = await tx.community.create({
          data: {
            name: communityName,
            description:
              dto.instanceDescription || `Welcome to ${dto.instanceName}!`,
          },
        });

        // Add admin user to the community
        await tx.membership.create({
          data: {
            userId: adminUser.id,
            communityId: defaultCommunity.id,
          },
        });

        // Create default channels
        const generalChannel = await tx.channel.create({
          data: {
            name: 'general',
            communityId: defaultCommunity.id,
            type: 'TEXT',
          },
        });

        const announcementsChannel = await tx.channel.create({
          data: {
            name: 'announcements',
            communityId: defaultCommunity.id,
            type: 'TEXT',
          },
        });

        const voiceChannel = await tx.channel.create({
          data: {
            name: 'voice-chat',
            communityId: defaultCommunity.id,
            type: 'VOICE',
          },
        });

        // Add admin to all channels
        await tx.channelMembership.createMany({
          data: [
            { userId: adminUser.id, channelId: generalChannel.id },
            { userId: adminUser.id, channelId: announcementsChannel.id },
            { userId: adminUser.id, channelId: voiceChannel.id },
          ],
        });

        // Create default roles for the community
        const adminRoleId =
          await this.communityRolesService.createDefaultCommunityRoles(
            defaultCommunity.id,
            tx,
            pendingBumps,
          );

        // Assign the admin user to the Community Admin role
        await this.communityRolesService.assignUserToCommunityRole(
          adminUser.id,
          defaultCommunity.id,
          adminRoleId,
          tx,
          pendingBumps,
        );

        this.logger.log(
          `Created default roles and assigned admin to Community Admin role`,
        );

        // Create welcome message
        await tx.message.create({
          data: {
            channelId: generalChannel.id,
            authorId: adminUser.id,
            spans: {
              create: [
                {
                  position: 0,
                  type: 'PLAINTEXT',
                  text: `Welcome to ${dto.instanceName}! 🎉\n\nThis is your new Semaphore Chat instance. You can start by:\n• Inviting other users to join\n• Creating more communities and channels\n• Customizing your community settings\n\nEnjoy your new chat platform!`,
                },
              ],
            },
          },
        });

        this.logger.log(
          `Created default community: ${communityName} with channels`,
        );
      }

      // 4. Create default instance admin role and assign to OWNER
      const instanceAdminRoleId =
        await this.instanceRolesService.createDefaultInstanceRole(
          tx,
          pendingBumps,
        );
      await this.instanceRolesService.assignUserToInstanceRole(
        adminUser.id,
        instanceAdminRoleId,
        tx,
        pendingBumps,
      );
      this.logger.log(
        `Created default instance admin role and assigned to OWNER user`,
      );

      // 5. Create default Community Creator role (available for assignment to users)
      await this.instanceRolesService.createDefaultCommunityCreatorRole(
        tx,
        pendingBumps,
      );
      this.logger.log(`Created default Community Creator role`);

      // 6. Create a permanent instance invite for future users. Same code
      // shape as any other invite (12 URL-safe base64 chars, 72 bits).
      await tx.instanceInvite.create({
        data: {
          code: generateInviteCode(),
          createdById: adminUser.id,
          defaultCommunities: defaultCommunity
            ? { create: [{ communityId: defaultCommunity.id }] }
            : undefined,
          maxUses: null, // Unlimited uses
          validUntil: null, // Never expires
          disabled: false,
        },
      });

      this.logger.log('Instance setup transaction completed');

      return {
        adminUser,
        defaultCommunity,
      };
    });

    // Transaction committed — flush the deferred epoch bumps. On rollback
    // this line is never reached, which is correct (nothing changed in the
    // DB). executeBumps never throws (fail-open, logged).
    await this.permissionsCacheService.executeBumps(pendingBumps);

    // Clear the setup token from Redis after successful transaction
    await this.redis.del(this.SETUP_TOKEN_KEY);
    this.logger.log('Instance setup completed successfully, token cleared');

    return result;
  }

  /**
   * Get the current onboarding status
   */
  async getStatus(): Promise<{
    needsSetup: boolean;
    hasUsers: boolean;
    setupToken?: string;
  }> {
    const needsSetup = await this.needsSetup();
    const userCount = await this.databaseService.user.count();

    const result = {
      needsSetup,
      hasUsers: userCount > 0,
    };

    // Generate setup token if needed
    if (needsSetup) {
      const setupToken = await this.generateSetupToken();
      return { ...result, setupToken };
    }

    return result;
  }
}
