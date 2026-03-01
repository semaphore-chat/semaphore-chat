/**
 * ============================================================
 *  DEVELOPMENT ONLY — Seed Data
 * ============================================================
 *  This script creates test users (admin / user-0 … user-99),
 *  roles, a default community, and a #general channel.
 *
 *  It must NEVER run in production.
 * ============================================================
 */

if (process.env.NODE_ENV === 'production') {
  console.error(
    'ERROR: seed.ts must not be run in production. Aborting.',
  );
  process.exit(1);
}

import { PrismaClient, RbacActions } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  DEFAULT_MEMBER_ROLE,
  DEFAULT_INSTANCE_ADMIN_ROLE,
  DEFAULT_COMMUNITY_CREATOR_ROLE,
  DEFAULT_USER_MANAGER_ROLE,
  DEFAULT_INVITE_MANAGER_ROLE,
} from '../src/roles/default-roles.config';
const prisma = new PrismaClient();
async function main() {
  const admin = await prisma.user.upsert({
    where: { email: 'admin@admin.fake' },
    update: {},
    create: {
      email: 'admin@admin.fake',
      username: 'admin',
      displayName: 'Admin',
      role: 'OWNER',
      hashedPassword: bcrypt.hashSync('admin', 10),
      verified: true,
    },
  });

  for (let i = 0; i < 100; i++) {
    const username = `user-${i}`;
    await prisma.user.upsert({
      where: { email: `${username}@fake.com` },
      update: {},
      create: {
        email: `${username}@fake.com`,
        username,
        displayName: username.charAt(0).toUpperCase() + username.slice(1),
        role: 'USER',
        hashedPassword: bcrypt.hashSync('password', 10),
        verified: true,
      },
    });
  }
  console.log({ admin });

  const adminRole = await prisma.role.findFirst({
    where: { name: 'admin', communityId: null },
  }) ?? await prisma.role.create({
    data: {
      name: 'admin',
      actions: [
        RbacActions.DELETE_MESSAGE,
        RbacActions.DELETE_CHANNEL,
        RbacActions.DELETE_COMMUNITY,
        RbacActions.DELETE_INVITE,
        RbacActions.DELETE_USER,
        RbacActions.DELETE_ROLE,
        RbacActions.DELETE_ALIAS_GROUP,
        RbacActions.DELETE_ALIAS_GROUP_MEMBER,
        RbacActions.DELETE_INSTANCE_INVITE,
        RbacActions.DELETE_MEMBER,
        RbacActions.DELETE_REACTION,
        RbacActions.CREATE_MESSAGE,
        RbacActions.CREATE_CHANNEL,
        RbacActions.CREATE_COMMUNITY,
        RbacActions.CREATE_INVITE,

        RbacActions.CREATE_ROLE,
        RbacActions.CREATE_ALIAS_GROUP,
        RbacActions.CREATE_ALIAS_GROUP_MEMBER,
        RbacActions.CREATE_INSTANCE_INVITE,
        RbacActions.CREATE_MEMBER,
        RbacActions.CREATE_REACTION,
        RbacActions.READ_MESSAGE,
        RbacActions.READ_CHANNEL,
        RbacActions.READ_COMMUNITY,
        RbacActions.READ_USER,
        RbacActions.READ_ROLE,
        RbacActions.READ_ALIAS_GROUP,
        RbacActions.READ_ALIAS_GROUP_MEMBER,
        RbacActions.READ_INSTANCE_INVITE,
        RbacActions.READ_MEMBER,
      ],
    },
  });

  console.log({ adminRole });

  const modRole = await prisma.role.findFirst({
    where: { name: 'moderator', communityId: null },
  }) ?? await prisma.role.create({
    data: {
      name: 'moderator',
      actions: [
        RbacActions.DELETE_MESSAGE,
        RbacActions.DELETE_CHANNEL,
        RbacActions.DELETE_ALIAS_GROUP,
        RbacActions.DELETE_ALIAS_GROUP_MEMBER,
        RbacActions.DELETE_MEMBER,
        RbacActions.DELETE_REACTION,
        RbacActions.CREATE_MESSAGE,
        RbacActions.CREATE_CHANNEL,
        RbacActions.CREATE_ALIAS_GROUP,
        RbacActions.CREATE_ALIAS_GROUP_MEMBER,
        RbacActions.CREATE_MEMBER,
        RbacActions.CREATE_REACTION,
        RbacActions.READ_MESSAGE,
        RbacActions.READ_CHANNEL,
        RbacActions.READ_COMMUNITY,
        RbacActions.READ_USER,
        RbacActions.READ_ROLE,
        RbacActions.READ_ALIAS_GROUP,
        RbacActions.READ_ALIAS_GROUP_MEMBER,
        RbacActions.READ_MEMBER,
      ],
    },
  });
  console.log({ modRole });

  // Create default instance-level roles
  const instanceAdminRole = await prisma.role.findFirst({
    where: { name: DEFAULT_INSTANCE_ADMIN_ROLE.name, communityId: null },
  }) ?? await prisma.role.create({
    data: {
      name: DEFAULT_INSTANCE_ADMIN_ROLE.name,
      actions: DEFAULT_INSTANCE_ADMIN_ROLE.actions,
      isDefault: true,
    },
  });
  console.log({ instanceAdminRole });

  const communityCreatorRole = await prisma.role.findFirst({
    where: { name: DEFAULT_COMMUNITY_CREATOR_ROLE.name, communityId: null },
  }) ?? await prisma.role.create({
    data: {
      name: DEFAULT_COMMUNITY_CREATOR_ROLE.name,
      actions: DEFAULT_COMMUNITY_CREATOR_ROLE.actions,
      isDefault: true,
    },
  });
  console.log({ communityCreatorRole });

  const userManagerRole = await prisma.role.findFirst({
    where: { name: DEFAULT_USER_MANAGER_ROLE.name, communityId: null },
  }) ?? await prisma.role.create({
    data: {
      name: DEFAULT_USER_MANAGER_ROLE.name,
      actions: DEFAULT_USER_MANAGER_ROLE.actions,
      isDefault: true,
    },
  });
  console.log({ userManagerRole });

  const inviteManagerRole = await prisma.role.findFirst({
    where: { name: DEFAULT_INVITE_MANAGER_ROLE.name, communityId: null },
  }) ?? await prisma.role.create({
    data: {
      name: DEFAULT_INVITE_MANAGER_ROLE.name,
      actions: DEFAULT_INVITE_MANAGER_ROLE.actions,
      isDefault: true,
    },
  });
  console.log({ inviteManagerRole });

  // Assign Instance Admin role to the admin user
  const adminInstanceRole = await prisma.userRoles.findFirst({
    where: { userId: admin.id, roleId: instanceAdminRole.id, isInstanceRole: true },
  }) ?? await prisma.userRoles.create({
    data: {
      userId: admin.id,
      roleId: instanceAdminRole.id,
      isInstanceRole: true,
    },
  });
  console.log({ adminInstanceRole });

  const community = await prisma.community.upsert({
    where: { name: 'default' },
    create: {
      name: 'default',
      description: 'This is a default test community',
    },
    update: {},
  });
  console.log({ community });

  // Create community-specific roles
  const communityAdminRole = await prisma.role.findFirst({
    where: { name: 'Community Admin', communityId: community.id },
  }) ?? await prisma.role.create({
    data: {
      name: 'Community Admin',
      communityId: community.id,
      isDefault: true,
      actions: [
        RbacActions.UPDATE_COMMUNITY,
        RbacActions.DELETE_COMMUNITY,
        RbacActions.READ_COMMUNITY,
        RbacActions.CREATE_CHANNEL,
        RbacActions.UPDATE_CHANNEL,
        RbacActions.DELETE_CHANNEL,
        RbacActions.READ_CHANNEL,
        RbacActions.CREATE_MEMBER,
        RbacActions.UPDATE_MEMBER,
        RbacActions.DELETE_MEMBER,
        RbacActions.READ_MEMBER,
        RbacActions.CREATE_MESSAGE,
        RbacActions.DELETE_MESSAGE,
        RbacActions.READ_MESSAGE,
        RbacActions.CREATE_ROLE,
        RbacActions.UPDATE_ROLE,
        RbacActions.DELETE_ROLE,
        RbacActions.READ_ROLE,
        RbacActions.CREATE_INVITE,
        RbacActions.DELETE_INVITE,
        RbacActions.READ_INSTANCE_INVITE,
        RbacActions.CREATE_ALIAS_GROUP,
        RbacActions.UPDATE_ALIAS_GROUP,
        RbacActions.DELETE_ALIAS_GROUP,
        RbacActions.READ_ALIAS_GROUP,
        RbacActions.CREATE_ALIAS_GROUP_MEMBER,
        RbacActions.DELETE_ALIAS_GROUP_MEMBER,
        RbacActions.READ_ALIAS_GROUP_MEMBER,
        RbacActions.CREATE_REACTION,
        RbacActions.DELETE_REACTION,
      ],
    },
  });
  console.log({ communityAdminRole });

  const communityModeratorRole = await prisma.role.findFirst({
    where: { name: 'Moderator', communityId: community.id },
  }) ?? await prisma.role.create({
    data: {
      name: 'Moderator',
      communityId: community.id,
      isDefault: true,
      actions: [
        RbacActions.READ_COMMUNITY,
        RbacActions.READ_CHANNEL,
        RbacActions.READ_MEMBER,
        RbacActions.READ_MESSAGE,
        RbacActions.READ_ROLE,
        RbacActions.CREATE_MESSAGE,
        RbacActions.DELETE_MESSAGE,
        RbacActions.CREATE_CHANNEL,
        RbacActions.UPDATE_CHANNEL,
        RbacActions.CREATE_MEMBER,
        RbacActions.UPDATE_MEMBER,
        RbacActions.CREATE_REACTION,
        RbacActions.DELETE_REACTION,
        RbacActions.READ_ALIAS_GROUP,
        RbacActions.READ_ALIAS_GROUP_MEMBER,
      ],
    },
  });
  console.log({ communityModeratorRole });

  const communityMemberRole = await prisma.role.findFirst({
    where: { name: DEFAULT_MEMBER_ROLE.name, communityId: community.id },
  }) ?? await prisma.role.create({
    data: {
      name: DEFAULT_MEMBER_ROLE.name,
      communityId: community.id,
      isDefault: true,
      actions: DEFAULT_MEMBER_ROLE.actions,
    },
  });
  console.log({ communityMemberRole });

  const member = await prisma.membership.upsert({
    where: {
      userId_communityId: {
        userId: admin.id,
        communityId: community.id,
      },
    },
    create: {
      userId: admin.id,
      communityId: community.id,
    },
    update: {},
  });
  console.log({ member });

  // Assign admin user to the community admin role
  const adminUserRole = await prisma.userRoles.findFirst({
    where: { userId: admin.id, communityId: community.id, roleId: communityAdminRole.id },
  }) ?? await prisma.userRoles.create({
    data: {
      userId: admin.id,
      communityId: community.id,
      roleId: communityAdminRole.id,
      isInstanceRole: false,
    },
  });
  console.log({ adminUserRole });

  const channel = await prisma.channel.upsert({
    where: { communityId_name: { communityId: community.id, name: 'general' } },
    create: {
      name: 'general',
      communityId: community.id,
    },
    update: {},
  });
  console.log({ channel });

  // Add user-0 to the community to test Member role assignment
  const user0 = await prisma.user.findUnique({
    where: { username: 'user-0' },
  });

  if (user0) {
    const user0Member = await prisma.membership.upsert({
      where: {
        userId_communityId: {
          userId: user0.id,
          communityId: community.id,
        },
      },
      create: {
        userId: user0.id,
        communityId: community.id,
      },
      update: {},
    });
    console.log({ user0Member });

    // Assign Member role to user-0
    const user0UserRole = await prisma.userRoles.findFirst({
      where: { userId: user0.id, communityId: community.id, roleId: communityMemberRole.id },
    }) ?? await prisma.userRoles.create({
      data: {
        userId: user0.id,
        communityId: community.id,
        roleId: communityMemberRole.id,
        isInstanceRole: false,
      },
    });
    console.log({ user0UserRole });
  }
}
main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
