/**
 * E2E Test Database Seed Script
 *
 * Seeds the test database with users, communities, channels, and messages
 * for E2E testing. Run with: npx ts-node prisma/seed-e2e.ts
 */

import { PrismaClient, InstanceRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const SALT_ROUNDS = 10;

// Test users that match the E2E fixtures
const TEST_USERS = [
  {
    username: 'testuser',
    email: 'testuser@test.local',
    password: 'Test123!@#',
    displayName: 'Test User',
    role: InstanceRole.OWNER, // OWNER role to allow community creation in E2E tests
  },
  {
    username: 'testuser2',
    email: 'testuser2@test.local',
    password: 'Test123!@#',
    displayName: 'Test User 2',
    role: InstanceRole.OWNER, // OWNER role to allow community creation in E2E tests
  },
  {
    username: 'admin',
    email: 'admin@test.local',
    password: 'Admin123!@#',
    displayName: 'Admin User',
    role: InstanceRole.OWNER,
  },
  {
    // Non-privileged member: InstanceRole.USER does NOT bypass community RBAC
    // (rbac.guard.ts only short-circuits for OWNER), and this user gets no
    // community role granting MUTE_PARTICIPANT — used to assert moderator-mute
    // is DENIED (403) for an ordinary member (REST-only, never drives the UI).
    username: 'member',
    email: 'member@test.local',
    password: 'Member123!@#',
    displayName: 'Member User',
    role: InstanceRole.USER,
  },
  {
    // 4th OWNER so the all-pairs matrix spec has four UI-capable participants.
    username: 'testuser3',
    email: 'testuser3@test.local',
    password: 'Test123!@#',
    displayName: 'Test User 3',
    role: InstanceRole.OWNER,
  },
];

// Test communities
const TEST_COMMUNITIES = [
  {
    name: 'Test Community',
    description: 'A community for E2E testing',
    channels: [
      { name: 'general', type: 'TEXT' },
      { name: 'random', type: 'TEXT' },
      { name: 'voice-chat', type: 'VOICE' },
      // Dedicated VOICE channels so each voice E2E spec gets its OWN LiveKit
      // room — heavy multi-participant specs (reconnect, mute, screenshare)
      // would otherwise contaminate each other's server-side room state.
      { name: 'voice-reconnect', type: 'VOICE' },
      { name: 'voice-mute', type: 'VOICE' },
      { name: 'voice-video', type: 'VOICE' },
      { name: 'voice-edge', type: 'VOICE' },
      { name: 'voice-matrix', type: 'VOICE' },
      { name: 'voice-perms', type: 'VOICE' },
      { name: 'voice-soundboard', type: 'VOICE' },
    ],
  },
  {
    name: 'Second Community',
    description: 'Another test community',
    channels: [
      { name: 'welcome', type: 'TEXT' },
      { name: 'announcements', type: 'TEXT' },
    ],
  },
];

// Instance invite code for registration
const TEST_INVITE_CODE = 'test-invite';

async function main() {
  console.log('🌱 Seeding E2E test database...\n');

  // Clean existing data
  console.log('🧹 Cleaning existing data...');
  await prisma.message.deleteMany({});
  await prisma.channelMembership.deleteMany({});
  await prisma.channel.deleteMany({});
  await prisma.membership.deleteMany({});
  await prisma.directMessageGroupMember.deleteMany({});
  await prisma.directMessageGroup.deleteMany({});
  await prisma.community.deleteMany({});
  await prisma.refreshToken.deleteMany({});
  await prisma.instanceInvite.deleteMany({});
  await prisma.user.deleteMany({});

  // Create instance invite code
  console.log('🎟️  Creating instance invite code...');
  await prisma.instanceInvite.create({
    data: {
      code: TEST_INVITE_CODE,
      maxUses: 1000,
      uses: 0,
      validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
    },
  });

  // Create users
  console.log('👥 Creating test users...');
  const users: Record<string, string> = {};

  for (const userData of TEST_USERS) {
    const hashedPassword = await bcrypt.hash(userData.password, SALT_ROUNDS);
    const user = await prisma.user.create({
      data: {
        username: userData.username,
        email: userData.email,
        hashedPassword: hashedPassword,
        displayName: userData.displayName,
        role: userData.role,
      },
    });
    users[userData.username] = user.id;
    console.log(`   ✓ Created user: ${userData.username}`);
  }

  // Create communities with channels
  console.log('\n🏠 Creating test communities...');

  for (const communityData of TEST_COMMUNITIES) {
    // Create community
    const community = await prisma.community.create({
      data: {
        name: communityData.name,
        description: communityData.description,
      },
    });
    console.log(`   ✓ Created community: ${communityData.name}`);

    // Add all users as members
    for (const [username, userId] of Object.entries(users)) {
      await prisma.membership.create({
        data: {
          userId,
          communityId: community.id,
        },
      });
    }
    console.log(`     → Added ${Object.keys(users).length} members`);

    // Create channels
    for (const channelData of communityData.channels) {
      const channel = await prisma.channel.create({
        data: {
          name: channelData.name,
          type: channelData.type as 'TEXT' | 'VOICE',
          communityId: community.id,
        },
      });
      console.log(`     → Created channel: #${channelData.name} (${channelData.type})`);

      // Add some sample messages to text channels
      if (channelData.type === 'TEXT' && channelData.name === 'general') {
        const messages = [
          { userId: users['testuser'], content: 'Welcome to the test community!' },
          { userId: users['testuser2'], content: 'Hello everyone! 👋' },
          { userId: users['admin'], content: 'This is a seeded message for E2E tests.' },
        ];

        for (const msg of messages) {
          await prisma.message.create({
            data: {
              channelId: channel.id,
              authorId: msg.userId,
              spans: {
                create: [
                  {
                    position: 0,
                    type: 'PLAINTEXT',
                    text: msg.content,
                  },
                ],
              },
              searchText: msg.content,
            },
          });
        }
        console.log(`       → Added ${messages.length} sample messages`);
      }
    }
  }

  // Create a DM group between test users
  console.log('\n💬 Creating test DM group...');
  const dmGroup = await prisma.directMessageGroup.create({
    data: {
      isGroup: false,
    },
  });

  // Add members to the DM group
  await prisma.directMessageGroupMember.createMany({
    data: [
      { groupId: dmGroup.id, userId: users['testuser'] },
      { groupId: dmGroup.id, userId: users['testuser2'] },
    ],
  });
  console.log('   ✓ Created DM group between testuser and testuser2');

  console.log('\n✅ E2E database seeding complete!\n');
  console.log('Test credentials:');
  console.log('─────────────────');
  for (const user of TEST_USERS) {
    console.log(`  ${user.username}: ${user.password}`);
  }
  console.log(`\nInvite code: ${TEST_INVITE_CODE}`);
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
