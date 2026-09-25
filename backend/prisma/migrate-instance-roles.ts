/**
 * Migration Script: Instance Admin Role Assignment
 *
 * This script creates the "Instance Admin" role if it doesn't exist
 * and assigns it to all existing OWNER users who don't have it.
 *
 * Run with: npx ts-node prisma/migrate-instance-roles.ts
 * Or via Docker: docker compose run backend npx ts-node prisma/migrate-instance-roles.ts
 */

import { PrismaClient, RbacActions, InstanceRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// Instance Admin role actions (matches DEFAULT_INSTANCE_ADMIN_ROLE in default-roles.config.ts)
const INSTANCE_ADMIN_ACTIONS: RbacActions[] = [
  RbacActions.READ_INSTANCE_SETTINGS,
  RbacActions.UPDATE_INSTANCE_SETTINGS,
  RbacActions.READ_INSTANCE_STATS,
  RbacActions.READ_USER,
  RbacActions.UPDATE_USER,
  RbacActions.BAN_USER,
  RbacActions.DELETE_USER,
  RbacActions.READ_INSTANCE_INVITE,
  RbacActions.CREATE_INSTANCE_INVITE,
  RbacActions.DELETE_INSTANCE_INVITE,
  RbacActions.UPDATE_INSTANCE_INVITE,
];

async function migrateInstanceRoles() {
  console.log('Starting Instance Admin Role migration...\n');

  // Step 1: Create or find the Instance Admin role
  let instanceAdminRole = await prisma.role.findFirst({
    where: { name: 'Instance Admin' },
  });

  if (instanceAdminRole) {
    console.log(`Found existing "Instance Admin" role: ${instanceAdminRole.id}`);

    // Update actions if they've changed
    const currentActions = new Set(instanceAdminRole.actions);
    const expectedActions = new Set(INSTANCE_ADMIN_ACTIONS);
    const needsUpdate =
      currentActions.size !== expectedActions.size ||
      INSTANCE_ADMIN_ACTIONS.some((a) => !currentActions.has(a));

    if (needsUpdate) {
      instanceAdminRole = await prisma.role.update({
        where: { id: instanceAdminRole.id },
        data: { actions: INSTANCE_ADMIN_ACTIONS },
      });
      console.log('Updated Instance Admin role with latest actions');
    }
  } else {
    instanceAdminRole = await prisma.role.create({
      data: {
        name: 'Instance Admin',
        actions: INSTANCE_ADMIN_ACTIONS,
      },
    });
    console.log(`Created new "Instance Admin" role: ${instanceAdminRole.id}`);
  }

  // Step 2: Find all OWNER users
  const ownerUsers = await prisma.user.findMany({
    where: { role: InstanceRole.OWNER },
    select: { id: true, username: true },
  });

  console.log(`\nFound ${ownerUsers.length} OWNER user(s)`);

  // Step 3: Check and assign the role to each OWNER user
  let assigned = 0;
  let skipped = 0;

  for (const user of ownerUsers) {
    // Check if already assigned
    const existingAssignment = await prisma.userRoles.findFirst({
      where: {
        userId: user.id,
        roleId: instanceAdminRole.id,
        isInstanceRole: true,
      },
    });

    if (existingAssignment) {
      console.log(`  - ${user.username}: Already has Instance Admin role (skipped)`);
      skipped++;
      continue;
    }

    // Assign the role
    await prisma.userRoles.create({
      data: {
        userId: user.id,
        roleId: instanceAdminRole.id,
        isInstanceRole: true,
        communityId: null,
      },
    });

    console.log(`  - ${user.username}: Assigned Instance Admin role`);
    assigned++;
  }

  console.log(`\nMigration complete!`);
  console.log(`  - Assigned: ${assigned}`);
  console.log(`  - Skipped (already assigned): ${skipped}`);
  console.log(`  - Total OWNER users: ${ownerUsers.length}`);
}

migrateInstanceRoles()
  .then(async () => {
    await prisma.$disconnect();
    console.log('\nDatabase connection closed.');
    process.exit(0);
  })
  .catch(async (e) => {
    console.error('\nMigration failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
