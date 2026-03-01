# Database Schema

Kraken uses **PostgreSQL** with **Prisma ORM**. Schema changes use Prisma Migrate (`prisma migrate dev` to create migrations, `prisma migrate deploy` to apply).

---

## Core Models

### User

```prisma
model User {
  id             String       @id @default(uuid())
  username       String       @unique
  email          String?      @unique
  verified       Boolean      @default(false)
  hashedPassword String
  role           InstanceRole @default(USER)
  displayName    String?
  avatarUrl      String?
  lastSeen       DateTime?
  createdAt      DateTime     @default(now())

  memberships                       Membership[]
  UserRoles                         UserRoles[]
  RefreshToken                      RefreshToken[]
  ChannelMembership                 ChannelMembership[]
  directMessageGroupMemberships     DirectMessageGroupMember[]
  friendshipsA                      Friendship[] @relation("FriendshipA")
  friendshipsB                      Friendship[] @relation("FriendshipB")
}
```

### Community

```prisma
model Community {
  id          String       @id @default(uuid())
  name        String       @unique
  description String?
  avatar      String?
  banner      String?
  createdAt   DateTime     @default(now())

  memberships Membership[]
  channels    Channel[]
  UserRoles   UserRoles[]
}
```

### Channel

```prisma
model Channel {
  id          String      @id @default(uuid())
  name        String
  communityId String
  type        ChannelType @default(TEXT)
  isPrivate   Boolean     @default(false)
  createdAt   DateTime    @default(now())

  community         Community?          @relation(fields: [communityId], references: [id], onDelete: Cascade)
  Message           Message[]
  ChannelMembership ChannelMembership[]

  @@unique([communityId, name])
}

enum ChannelType {
  TEXT
  VOICE
}
```

### Message

Messages use a **span-based rich text system** and support both channel and DM contexts.

```prisma
model Message {
  id                   String       @id @default(uuid())
  channelId            String?
  directMessageGroupId String?
  authorId             String
  spans                Json         @default("[]")
  attachments          Json         @default("[]")
  reactions            Json         @default("[]")
  sentAt               DateTime     @default(now())
  editedAt             DateTime?
  deletedAt            DateTime?

  channel            Channel?            @relation(fields: [channelId], references: [id], onDelete: Cascade)
  directMessageGroup DirectMessageGroup? @relation(fields: [directMessageGroupId], references: [id], onDelete: Cascade)
}
```

#### Span System (Rich Text)

Spans are stored as a JSON array. Each span object has the following shape:

```typescript
interface Span {
  type: "PLAINTEXT" | "USER_MENTION" | "SPECIAL_MENTION" | "CHANNEL_MENTION" | "COMMUNITY_MENTION" | "ALIAS_MENTION";
  text?: string;
  userId?: string;       // USER_MENTION
  specialKind?: string;  // SPECIAL_MENTION: "here", "everyone", "mods"
  channelId?: string;    // CHANNEL_MENTION
  communityId?: string;  // COMMUNITY_MENTION
  aliasId?: string;      // ALIAS_MENTION
}
```

#### JSON Column Types

Attachments and reactions are stored as JSON arrays:

```typescript
interface Attachment {
  url: string;
  filename: string;
  filetype: string;
  size: number;
}

interface Reaction {
  emoji: string;
  userIds: string[];
}
```

---

## Membership & Access Control

### Membership (Community)

```prisma
model Membership {
  id          String   @id @default(uuid())
  userId      String
  communityId String
  joinedAt    DateTime @default(now())

  user      User      @relation(fields: [userId], references: [id])
  community Community @relation(fields: [communityId], references: [id])

  @@unique([userId, communityId])
}
```

### ChannelMembership (Private Channels)

```prisma
model ChannelMembership {
  id        String   @id @default(uuid())
  userId    String
  channelId String
  joinedAt  DateTime @default(now())
  addedBy   String?

  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  channel Channel @relation(fields: [channelId], references: [id], onDelete: Cascade)

  @@unique([userId, channelId])
}
```

### RBAC System

```prisma
model Role {
  id        String        @id @default(uuid())
  name      String        @unique
  actions   RbacActions[] @default([])
  createdAt DateTime      @default(now())

  UserRoles UserRoles[]
}

model UserRoles {
  id             String     @id @default(uuid())
  userId         String
  communityId    String?    // Null for instance-level roles
  roleId         String
  isInstanceRole Boolean    @default(false)

  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  community Community? @relation(fields: [communityId], references: [id], onDelete: Cascade)
  role      Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)

  @@unique([userId, communityId, roleId])
}
```

---

## Direct Messaging

```prisma
model DirectMessageGroup {
  id        String                     @id @default(uuid())
  name      String?                    // Optional, for group DMs
  isGroup   Boolean                    @default(false)
  createdAt DateTime                   @default(now())

  members  DirectMessageGroupMember[]
  messages Message[]                   @relation("DirectMessageGroupMessages")
}

model DirectMessageGroupMember {
  id       String             @id @default(uuid())
  groupId  String
  userId   String
  joinedAt DateTime           @default(now())

  group DirectMessageGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  user  User               @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([groupId, userId])
}
```

---

## Social Features

### Friendship

```prisma
model Friendship {
  id        String           @id @default(uuid())
  userAId   String
  userBId   String
  status    FriendshipStatus @default(PENDING)
  createdAt DateTime         @default(now())

  userA User @relation("FriendshipA", fields: [userAId], references: [id], onDelete: Cascade)
  userB User @relation("FriendshipB", fields: [userBId], references: [id], onDelete: Cascade)

  @@unique([userAId, userBId])
}

enum FriendshipStatus {
  PENDING
  ACCEPTED
  BLOCKED
}
```

### Alias Groups (Mention Groups)

```prisma
model AliasGroup {
  id          String             @id @default(uuid())
  name        String
  communityId String
  members     AliasGroupMember[]
  createdAt   DateTime           @default(now())

  @@unique([communityId, name])
}
```

---

## Relationships Diagram

```
User ──────┐
    │      ├── Membership ────────── Community
    │      ├── UserRoles ─────────── Role
    │      ├── ChannelMembership ─── Channel ── Community
    │      ├── DM Group Member ───── DirectMessageGroup ── Message
    │      └── Friendship (bidirectional)
    │
    └── Message ── Channel ── Community
```

---

## Query Patterns

### Get User's Communities

```typescript
const userCommunities = await prisma.membership.findMany({
  where: { userId },
  include: { community: { include: { channels: true } } },
});
```

### Paginated Messages

```typescript
const messages = await prisma.message.findMany({
  where: { channelId, deletedAt: null },
  orderBy: { sentAt: 'desc' },
  take: 50,
  skip: offset,
});
```

### Check User Permissions

```typescript
const userRoles = await prisma.userRoles.findMany({
  where: {
    userId,
    OR: [
      { communityId: null, isInstanceRole: true },
      { communityId },
    ],
  },
  include: { role: true },
});
```

---

## Schema Management

- **Development**: `prisma migrate dev` creates and applies migrations
- **Production**: `prisma migrate deploy` applies pending migrations; back up before major changes
- **Indexing**: Prisma auto-creates indexes for `@unique` and `@@unique` constraints; compound indexes on `Message.channelId + sentAt` and `Membership.userId + communityId` are critical for performance
