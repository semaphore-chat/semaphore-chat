import {
  Injectable,
  ConflictException,
  Logger,
  Inject,
  OnApplicationBootstrap,
} from '@nestjs/common';
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
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { SetupInstanceDto } from './dto/setup-instance.dto';

/**
 * Transaction-scoped Postgres advisory lock key for first-run setup.
 * Arbitrary but stable: two concurrent setups must serialize on this key.
 */
const SETUP_ADVISORY_LOCK_KEY = 73_150_001;

/**
 * REQUIRE_SETUP_TOKEN (default on): the setup token is never returned by the
 * public status endpoint. The backend logs it and the operator pastes it into
 * the setup wizard. `false` keeps the old flow, where the wizard receives it.
 */
function isSetupTokenRequired(): boolean {
  return process.env.REQUIRE_SETUP_TOKEN?.trim().toLowerCase() !== 'false';
}

/** SETUP_TOKEN: an operator-chosen token for unattended installs. */
function configuredSetupToken(): string | undefined {
  return process.env.SETUP_TOKEN?.trim() || undefined;
}

/** Constant-time string comparison (hashing first equalises the lengths). */
function tokensMatch(a: string, b: string): boolean {
  const hash = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(a), hash(b));
}

@Injectable()
export class OnboardingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OnboardingService.name);
  private readonly SETUP_TOKEN_KEY = 'onboarding:setup-token';

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
   * While the instance needs setup, print the setup token on every boot (from
   * every replica: they share one token in Redis), so a restart never leaves
   * the operator without it. Nothing is logged once setup is done.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      if (!isSetupTokenRequired() || !(await this.needsSetup())) {
        return;
      }
      if (configuredSetupToken()) {
        this.logger.warn(
          'Instance needs setup. Enter the SETUP_TOKEN you configured in the setup wizard.',
        );
        return;
      }
      const { token } = await this.ensureSetupToken();
      this.logSetupToken(token);
    } catch (error) {
      this.logger.warn(
        `Could not check whether the instance needs setup: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** One greppable line; the wizard hint tells operators to grep for it. */
  private logSetupToken(token: string): void {
    this.logger.warn(
      `Instance needs setup; paste this into the setup wizard. Setup token: ${token}`,
    );
  }

  /**
   * The token the setup must present: SETUP_TOKEN if set, else the one in
   * Redis (null if none was made yet).
   */
  private async getActiveSetupToken(): Promise<string | null> {
    return (
      configuredSetupToken() ?? (await this.redis.get(this.SETUP_TOKEN_KEY))
    );
  }

  /**
   * Return the setup token, creating it in Redis if absent. Stored without
   * expiry (the operator may read the log hours later) and with NX, so
   * replicas racing on first boot all end up with the same token.
   */
  private async ensureSetupToken(): Promise<{
    token: string;
    created: boolean;
  }> {
    const configured = configuredSetupToken();
    if (configured) {
      return { token: configured, created: false };
    }

    const existing = await this.redis.get(this.SETUP_TOKEN_KEY);
    if (existing) {
      // Drop a TTL left by older versions, which expired tokens after 15 min
      await this.redis.persist(this.SETUP_TOKEN_KEY);
      return { token: existing, created: false };
    }

    const candidate = randomUUID();
    const created =
      (await this.redis.set(this.SETUP_TOKEN_KEY, candidate, 'NX')) === 'OK';
    if (created) {
      return { token: candidate, created: true };
    }
    // Another replica stored one first
    const winner = await this.redis.get(this.SETUP_TOKEN_KEY);
    return { token: winner ?? candidate, created: false };
  }

  /**
   * Get the setup token, creating it if needed. A newly created token is
   * logged (e.g. after Redis lost the old one), so the latest log line always
   * holds the live token.
   */
  async generateSetupToken(): Promise<string> {
    if (!(await this.needsSetup())) {
      throw new ConflictException('Instance setup is not needed');
    }

    const { token, created } = await this.ensureSetupToken();
    if (created) {
      if (isSetupTokenRequired()) {
        this.logSetupToken(token);
      } else {
        this.logger.log('Generated new setup token for onboarding');
      }
    }
    return token;
  }

  /**
   * Validate the setup token (surrounding whitespace from a paste is ignored)
   */
  async validateSetupToken(token: string): Promise<boolean> {
    const presented = token?.trim();
    if (!presented) {
      return false;
    }
    const expected = await this.getActiveSetupToken();
    if (!expected) {
      return false;
    }
    return tokensMatch(presented, expected);
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
      // $executeRaw: pg_advisory_xact_lock returns `void`, which the Prisma 7
      // driver adapter cannot deserialize as a $queryRaw result (500).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SETUP_ADVISORY_LOCK_KEY}::bigint)`;
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

      // 6. Create a permanent instance invite for future users
      await tx.instanceInvite.create({
        data: {
          code: `welcome-${randomUUID().slice(0, 8)}`,
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
    setupTokenRequired: boolean;
    setupToken?: string;
  }> {
    const needsSetup = await this.needsSetup();
    const userCount = await this.databaseService.user.count();
    const setupTokenRequired = isSetupTokenRequired();

    const result = {
      needsSetup,
      hasUsers: userCount > 0,
      setupTokenRequired,
    };

    if (needsSetup) {
      // Make sure a token exists (and is logged) for the wizard to check
      const setupToken = await this.generateSetupToken();
      // Only the opt-out (REQUIRE_SETUP_TOKEN=false) hands it to the caller
      if (!setupTokenRequired) {
        return { ...result, setupToken };
      }
    }

    return result;
  }
}
