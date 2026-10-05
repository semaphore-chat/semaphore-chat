# Channel permissions, read-only and announcement channels: design

Status: **proposal for owner review**. No code has been written.
Date: 2026-10-04. Branch: `design/channel-permissions`.

## Goal

Let a community admin make, without touching a permission matrix:

- an **announcement** channel: everyone reads, only chosen roles post;
- a **read-only** channel (same mechanism, different label);
- a **mods-only** channel: only chosen roles can see it;
- a channel where **@everyone can't attach files**.

Advanced admins get a per-channel allow/deny editor underneath.

## 1. Current state

| Piece | Where | What it does today |
|---|---|---|
| Roles | `backend/prisma/schema.prisma` `Role` (`actions RbacActions[]`, `position`, `isDefault`), `UserRoles` | A role is a flat list of actions. Community roles have a `communityId`; instance roles have `isInstanceRole`. Seeded community roles: Community Admin, Moderator, Member (`backend/src/roles/default-roles.config.ts`). There is **no implicit @everyone**: "Member" is an ordinary role that new members get. |
| Guard | `backend/src/auth/rbac.guard.ts` | Reads `@RequiredActions` + `@RbacResource`. Instance `OWNER` returns `true` before any check. Everything else goes to `PermissionsService`. |
| Resolver | `backend/src/roles/permissions.service.ts` `verifyActionsForUserAndResource` | Resolves resource to a community (CHANNEL → `channel.communityId`, MESSAGE → `message.channel`), then checks `required ⊆ ∪(role.actions)` for the user's community roles. **The only per-channel logic is `isPrivate`**: a private channel needs a `ChannelMembership` row, otherwise `false`. Nothing else differs per channel. |
| Cache | `backend/src/roles/permissions-cache.service.ts` | Redis cache of the flattened community action list per user, keyed by user and community epochs (`rbac:actions:{user}:{community}:{userEpoch}:{communityEpoch}`), TTL 300 s, fail-open. Channel and private-membership lookups are uncached DB queries. Kick, ban and leave bump the user epoch (`membership.service.ts:335`, `moderation.service.ts:184,358`). |
| Channel-scoped guards | `messages.controller/gateway` (CREATE_MESSAGE, READ_MESSAGE, CREATE/DELETE_REACTION), `threads.*` (CREATE_MESSAGE, READ_MESSAGE on MESSAGE), `moderation.controller` (PIN/UNPIN, DELETE_ANY_MESSAGE on MESSAGE), `voice-presence.*`, `livekit.controller` (JOIN_CHANNEL, MUTE_PARTICIPANT), `channels.controller` (READ/UPDATE/DELETE_CHANNEL), `webhooks.controller` (UPDATE_CHANNEL) | All of these already pass a CHANNEL or MESSAGE resource, so a per-channel resolver plugs in without touching decorators. |
| Private visibility, outside the guard | `rooms/rooms.service.ts:39,55`, `rooms/room-subscription.handler.ts:66,207`, `messages/messages.service.ts:743` (mentionable channels), `notifications/notifications.service.ts:167-357`, `file/file-access/strategies/{message-attachment,replay-clip}.strategy.ts`, `link-previews/link-preview.utils.ts`, `read-receipts.service.ts`, `livekit/{clip-library,livekit-replay}.service.ts` | About ten places hand-roll `isPrivate ? ChannelMembership : everyone`. Any new visibility rule has to replace all of them. |
| Channel list | `channels.service.ts:121` `findAll` | Returns **every** channel, private ones included; the sidebar shows a lock (`ChannelRow.tsx:210`). Private channel names are visible to all members. |
| Timeout | `messages.gateway.ts:103` | Only checked on channel `SEND_MESSAGE`. Thread replies (`threads.gateway.ts`) and reactions skip it. Slowmode has no bypass. |
| Attachments | `file-upload` `POST` has no RBAC; `CreateMessageDto.attachments: string[]` links the uploaded files | There is no attach action. A no-attachments rule has to be enforced when the message is created, not at upload. |
| LiveKit | `livekit/livekit.service.ts:89` | The token always grants `canPublish: true`. There is no speak, video or screen-share permission. |
| Frontend gating | `features/roles/useUserPermissions.ts`, `hooks/useComposerAvailability.ts`, `hooks/useMessagePermissions.ts`, `features/roles/RoleBasedComponents.tsx` | Per channel, `GET /roles/my/channel/:id` returns **community** roles (`community-roles.service.ts:89`: "In the future, you might want to add channel-specific roles"), and the client intersects their actions. The composer already has a `no-permission` state. |
| Real time | `shared/src/events/server-events.enum.ts` `ROLE_*`, `CHANNEL_UPDATED`; `frontend/src/socket-hub/handlers/roleHandlers.ts` | Role events invalidate community-role and membership queries, **but not `rolesControllerGetMyRolesForChannel`**, so the composer's channel permissions go stale after a role change (an existing bug). |
| Categories | none | The sidebar groups by type only ("Text Channels" / "Voice Channels"). No category model, so no inheritance is needed now. |

## 2. Options

| | (A) Discord-style overwrites | (B) Channel modes as flags | (C) Channel-scoped roles |
|---|---|---|---|
| What | Per channel, allow/deny action lists per target (everyone, role, member), applied on top of community roles | `Channel.mode` enum (NORMAL, READ_ONLY, ANNOUNCEMENT, MODS_ONLY) plus `postRoleIds` / `viewRoleIds` columns, special-cased in the resolver | Roles get an optional `channelId`; assigning one adds actions in that channel only |
| Covers the 4 goals | Yes, plus anything later (no reactions, no video, voice stage) | The 4 goals only; every new need adds a column and resolver branch | Can grant, can't **remove** (no deny), so it can't make announcements without stripping CREATE_MESSAGE from Member everywhere |
| Admin UX | Matrix is powerful but intimidating | Simple radio buttons | Role sprawl ("Announcements-poster" roles per channel) |
| Effort | Medium (engine ~3 d) | Low (~2 d) | Medium, and a dead end |
| Risk | Resolution order must be exact and well tested | Low now; rewrite later | Low |

## 3. Recommendation

**(A) as the engine, with (B)'s presets as the default UI.** Presets are a *view* over overwrites: choosing "Announcement" writes a known set of overwrites, and the UI detects which preset an overwrite set matches (or shows "Custom"). Normal admins only see the preset picker plus a "who can post / who can see" role picker. "Advanced" opens the matrix.

Why: (B) alone covers today's list but each new request ("no video in #lobby", "only Verified can react") adds a column and a resolver branch. (A) costs about one extra day and is the model Discord users already understand. The resolver already funnels every channel check through one function, so the engine change is local. The expensive part is visibility (section 6.3), and any option that adds role-based visibility pays that cost.

## 4. Resolution algorithm

Inputs: user `U`, channel `C` (a MESSAGE resource resolves to its channel first), required actions `R`.

1. **Instance OWNER**: allow. This bypass stays in `RbacGuard`, and only covers the instance OWNER. Instance admin roles carry no community actions and get no bypass.
2. **Community membership** (new explicit check): `U` must have a `Membership` in `C.communityId`; otherwise deny. Today a non-member simply has no roles; with EVERYONE/MEMBER allows, a missing check would let non-members in. Banned users have no membership, so a ban always wins.
3. **Base** `B = ∪ actions of U's community roles` (cached, as today).
4. If `R` contains only **community-scoped** actions (table in 6.5), return `R ⊆ B`. Overwrites never touch community-scoped actions.
5. **Channel overwrites**, in this order (allow wins at the same level, the later level wins):
   1. implicit private rule: if `C.isPrivate`, `B −= {READ_CHANNEL}`; if `U` has a `ChannelMembership` in `C`, `B ∪= {READ_CHANNEL}` (section 9);
   2. EVERYONE overwrite: `B = (B − deny) ∪ allow`;
   3. ROLE overwrites for every role `U` holds: `B = (B − ∪deny) ∪ ∪allow`; any role's allow beats any role's deny;
   4. MEMBER overwrite for `U` (phase 5): `B = (B − deny) ∪ allow`.
6. **View gate**: if `READ_CHANNEL ∉ B`, then `B = ∅` for this channel. Can't see it, can't do anything in it.
7. **Timeout mask** (recommended, open question 6): if `U` has an active `CommunityTimeout`, remove the participation actions `{CREATE_MESSAGE, ATTACH_FILES, CREATE_REACTION, SPEAK, VIDEO, SCREEN_SHARE}`. Only look up the timeout when `R` contains one of them.
8. Return `R ⊆ B`.

**Worked example.** In #announcements: EVERYONE deny `[CREATE_MESSAGE, ATTACH_FILES]`; Moderator allow `[CREATE_MESSAGE, ATTACH_FILES]`.

| User | Roles | After base | After EVERYONE | After ROLE | Can post |
|---|---|---|---|---|---|
| Alice | Member | has CREATE_MESSAGE | removed | no allow | **no** (composer is read-only) |
| Bob | Member, Moderator | has it | removed | Moderator allow re-adds | **yes** |
| Carol | Member, Moderator, "Quiet" (deny CREATE_MESSAGE here) | has it | removed | Moderator allow beats Quiet deny | **yes** (Discord semantics) |
| Dina | Community Admin | has it | removed | no allow on Admin | **no**, unless the preset also allowed Admin (it does by default, see 7.1) |
| Eve | Moderator, timed out | has it | removed | re-added | **no** (timeout mask) |
| Owner | anything | n/a | n/a | n/a | **yes** (step 1) |

Dina's row is the main gotcha: no community-level "administrator" bypasses overwrites. The design handles it in two ways. First, the preset role picker pre-selects every role that holds `MANAGE_CHANNEL_PERMISSIONS`. Second, managing overwrites is community-scoped, so an admin who locked themselves out can always fix it from settings. Whether to add an `ADMINISTRATOR` action is open question 2.

## 5. Data model

```prisma
enum OverwriteTarget { EVERYONE ROLE MEMBER }
enum ChannelPreset   { NORMAL READ_ONLY ANNOUNCEMENT MODS_ONLY CUSTOM }

model ChannelPermissionOverwrite {
  id         String          @id @default(uuid())
  channelId  String
  targetType OverwriteTarget
  roleId     String?          // set iff ROLE
  userId     String?          // set iff MEMBER
  allow      RbacActions[]    @default([])
  deny       RbacActions[]    @default([])
  createdAt  DateTime         @default(now())
  updatedAt  DateTime         @updatedAt
  channel Channel @relation(fields: [channelId], references: [id], onDelete: Cascade)
  role    Role?   @relation(fields: [roleId],    references: [id], onDelete: Cascade)
  user    User?   @relation(fields: [userId],    references: [id], onDelete: Cascade)
  @@index([channelId])
  @@index([roleId])
  @@index([userId])
}

// Channel gains:
//   preset      ChannelPreset @default(NORMAL)  -- display label only, never used for enforcement
//   overwrites  ChannelPermissionOverwrite[]
```

Migration sketch (two migrations, because Postgres can't use a new enum value in the transaction that adds it):

1. `ALTER TYPE "RbacActions" ADD VALUE 'ATTACH_FILES'` (and in phase 4 `SPEAK`, `VIDEO`, `SCREEN_SHARE`; plus `MANAGE_CHANNEL_PERMISSIONS`).
2. Create the table and enums. Add hand-written SQL:
   - partial unique indexes: `(channelId) WHERE targetType='EVERYONE'`, `(channelId, roleId) WHERE targetType='ROLE'`, `(channelId, userId) WHERE targetType='MEMBER'`;
   - `CHECK` that the target columns match `targetType`;
   - `CHECK (NOT (allow && deny))`.
3. **Backfill, so nobody loses anything:** `UPDATE "Role" SET actions = array_append(actions,'ATTACH_FILES') WHERE 'CREATE_MESSAGE' = ANY(actions) AND NOT 'ATTACH_FILES' = ANY(actions)`. Do the same for SPEAK/VIDEO/SCREEN_SHARE from `JOIN_CHANNEL`, and give `MANAGE_CHANNEL_PERMISSIONS` to roles holding `UPDATE_COMMUNITY`. Update `default-roles.config.ts` to match.
4. Existing channels get no rows: `preset = NORMAL`, and private channels keep `isPrivate` and `ChannelMembership` unchanged.

App-level invariant (validated in the service, since SQL can't check it): `role.communityId = channel.communityId`.

## 6. Backend changes

### 6.1 Resolver and guard
- `RbacGuard`: no change. The decorators already carry the resources.
- `PermissionsService.verifyActionsForUserAndResource`: the CHANNEL and MESSAGE branches stop at "resolve community" and call a new `resolveChannelActions(userId, channel)` that implements section 4.
- Extend the existing (uncached) `channel.findUnique` to `select { communityId, isPrivate, overwrites: { select: { targetType, roleId, userId, allow, deny } } }`. That is one indexed join, with no new cache layer and no new invalidation, so overwrites are always fresh.
- The cached community entry changes from `RbacActions[]` to `{ roleIds: string[], actions: RbacActions[], isMember: true }`, because step 5.3 needs role ids. This needs a key-version bump (`rbac:v2:actions:...`) so old entries are ignored. Epochs are unchanged: membership changes already bump the user epoch.
- Add a pure function `computeChannelActions(base, roleIds, isPrivate, hasChannelMembership, overwrites, timedOut)` in `roles/channel-permissions.util.ts`. The guard, the "me" endpoint and the bulk visibility code all call it, which keeps them consistent.
- Enforcement that decorators can't express:
  - `messages.service.create` (and edit, if attachments can be added on edit) checks `ATTACH_FILES` when `attachments.length > 0`;
  - the message gateway's timeout check moves into step 7.

### 6.2 Cache and invalidation
- Overwrites: none needed (read fresh with the channel row).
- Role definition, assignment or membership changes: the existing epochs already cover them.
- Optional later step, if metrics show the join matters: cache `rbac:chow:{channelId}:{channelEpoch}`, bumped by overwrite writes and `isPrivate` changes.

### 6.3 Visibility (the hard part, phase 3)
Add one `ChannelAccessService`:
- `visibleChannelIds(userId, communityId)`: one query for the community's channels with their overwrites, plus the user's cached roles, then `computeChannelActions` for each channel.
- `viewerIds(channelId)`: community members with their role ids, evaluated in memory. The notifications service already bails on large communities.

Then replace every hand-rolled `isPrivate` branch listed in section 1 with these calls: rooms join/sync, notifications recipients, mentionable channels, file-access strategies, link previews, read receipts, clips and replays. `findAll` returns only visible channels. The server returns these lists **already filtered**, so the client never has to hide anything itself.

**Socket room sync is security-critical.** Channel broadcasts go to `RoomName.channel(id)`. When overwrites change, or a role or membership change affects view, recompute the viewers and `joinSocketsToRoom`/`leave` the affected users' sockets. Otherwise a user who lost view keeps receiving messages.

### 6.4 WebSocket events
- New `CHANNEL_PERMISSIONS_UPDATED { communityId, channelId }` sent to the community room. Clients invalidate the effective-permissions query and the channel list. If the user can no longer see the open channel, the client navigates to the community's default channel.
- Fix the existing gap: the `ROLE_*` handlers also invalidate the effective-permissions query.
- Voice: when SPEAK/VIDEO/SCREEN_SHARE change for a connected participant, call LiveKit `updateParticipant(room, identity, { canPublishSources })`. When view or JOIN is lost, call `removeParticipant`.

### 6.5 Scope of actions

| Channel-scoped (overwritable) | Community-only (never overwritable) |
|---|---|
| READ_CHANNEL (view), READ_MESSAGE (history), CREATE_MESSAGE, **ATTACH_FILES**, CREATE_REACTION, PIN_MESSAGE, UNPIN_MESSAGE, DELETE_ANY_MESSAGE, JOIN_CHANNEL, **SPEAK**, **VIDEO**, **SCREEN_SHARE**, MUTE_PARTICIPANT, CAPTURE_REPLAY, READ_SOUNDBOARD_SOUND | Everything else: community settings, CREATE/UPDATE/DELETE_CHANNEL, **MANAGE_CHANNEL_PERMISSIONS**, roles, members, invites, ban, kick, timeout, logs, emoji, alias groups, soundboard management, all instance actions, DELETE_MESSAGE (own messages) |

Bold marks new actions. Keeping UPDATE_CHANNEL and MANAGE_CHANNEL_PERMISSIONS community-only means managers always see every channel in settings, so nobody can lock themselves out.

### 6.6 API (regenerate the OpenAPI client afterwards)

| Endpoint | Guard | Body / response |
|---|---|---|
| `GET /channels/:id/overwrites` | MANAGE_CHANNEL_PERMISSIONS (CHANNEL) | `ChannelOverwritesDto { preset, overwrites: OverwriteDto[] }` |
| `PUT /channels/:id/overwrites` | same | `ReplaceOverwritesDto { preset, overwrites[] }`. Replaces the whole set in one transaction, so a preset applies atomically. Validation: actions ⊆ channel-scoped set; no action in both allow and deny; roles belong to the community; **the actor can only allow or deny actions they hold themselves** (anti-escalation); READ_CHANNEL rejected until phase 3; MEMBER rejected until phase 5. Emits `CHANNEL_PERMISSIONS_UPDATED` and a mod-log entry. |
| `GET /communities/:id/channel-permissions/me` | membership | `Record<channelId, RbacActions[]>`: the effective set for every visible channel, one request for the sidebar, composer and voice controls |
| `GET /channels/:id/permissions/me` | READ_CHANNEL | `{ channelId, actions }`. Replaces `GET /roles/my/channel/:id` for gating; the old endpoint stays for role badges. |

`OverwriteDto` uses `@ApiProperty({ enum: RbacActionsValues, isArray: true })` and an `OverwriteTargetValues` const array (per the CLAUDE.md Swagger rules).

## 7. Frontend changes

### 7.1 Channel settings (`EditChannelDialog` gets a "Permissions" tab)
- **Preset cards**: Normal · Read-only · Announcement · Mods only. Under the chosen card, a role multi-select: "Who can post" (read-only, announcement) or "Who can see" (mods only). It pre-selects every role with MANAGE_CHANNEL_PERMISSIONS.
- **Toggle**: "Members can attach files". This writes or removes an EVERYONE deny on ATTACH_FILES and works with any preset.
- **What each preset writes**:
  - Read-only: EVERYONE deny `[CREATE_MESSAGE, ATTACH_FILES, CREATE_REACTION]`, chosen roles allow the same.
  - Announcement: EVERYONE deny `[CREATE_MESSAGE, ATTACH_FILES]` (reactions stay allowed), chosen roles allow the same.
  - Mods only: EVERYONE deny `[READ_CHANNEL]`, chosen roles allow `[READ_CHANNEL]` (phase 3).
- **Advanced**: Discord-style. Targets on the left (Everyone, roles, later members), and a tri-state switch (inherit / allow / deny) per action, grouped Text / Voice / Moderation. On phones it is one target per screen. Editing in Advanced sets `preset = CUSTOM`. A pure function `detectPreset(overwrites)` maps back to a card where possible.
- Stories: each preset, custom, loading, error, a long role list, phone width, and the read-only view for non-managers.

### 7.2 Effective permissions everywhere
- `useChannelPermissions(channelId)` reads from the bulk `me` query: `{ can(action), isLoading }`. It keeps the OWNER bypass and the fail-open-while-loading behavior of today's hooks.
- `useComposerAvailability` uses it, and adds a `read-only` state ("Only Moderators can post in #announcements"; the role names come from a `postingRoleNames` field on the per-channel `me` response). The attach button, drag-drop and paste upload are disabled without ATTACH_FILES.
- `useMessagePermissions`: reactions, pin and delete-any go per channel.
- Sidebar: a megaphone icon for ANNOUNCEMENT, a lock for private and mods-only. Channels you can't see are not returned.
- Voice: the join button is disabled without JOIN_CHANNEL. The mic, camera and screen-share buttons are disabled, with a tooltip, without SPEAK/VIDEO/SCREEN_SHARE.
- A socket-hub handler for `CHANNEL_PERMISSIONS_UPDATED` invalidates the queries, so the composer flips without a reload.

## 8. Announcement channels

The Announcement preset plus a megaphone icon covers it. The only real difference from read-only is that members can still react. Two possible extras:
- **Thread replies under announcements**, which needs a new `SEND_IN_THREADS` action, because threads check CREATE_MESSAGE on the parent message (open question 5);
- a "notify all" default for the channel, through the existing `ChannelNotificationOverride` defaults.

**Skip follow/crosspost.** It only matters across servers, and a self-hosted instance rarely federates.

## 9. Existing private channels

**Keep `ChannelMembership`, and treat it as the per-member view grant.** `isPrivate` becomes an implicit EVERYONE deny on READ_CHANNEL, and a membership row becomes an implicit member allow (step 5.1). Role allows on READ_CHANNEL then extend a private channel to whole roles: "private" and "mods only" become the same mechanism.

Why not convert rows to MEMBER overwrites: about ten call sites, the member-picker UI (`PrivateChannelMembership.tsx`), the `CHANNEL_MEMBERSHIP_*` events and the e2e tests all depend on the table. Converting would duplicate the data and buy nothing in v1. They could converge later, once phase 5 member overwrites exist. Behavior change: under phase 3, non-members stop seeing private channel names (open question 1).

## 10. Testing, rollout, risks, open questions

### Testing
- **Backend unit tests**: table-driven tests for `computeChannelActions` covering every row of the worked example. Also: non-member with an EVERYONE allow (must deny), private + role allow, private + membership + EVERYONE deny on CREATE, timeout mask, OWNER bypass, community-scoped actions unaffected. Plus anti-escalation validation, and the cache v2 shape and fallback.
- **Backend e2e**: announcement post rejected over both WS `SEND_MESSAGE` and HTTP; attachments rejected; reaction allowed; thread reply follows the rules; after an overwrite change, the next request reflects it. Phase 3: a user who loses view leaves the socket room (assert no `NEW_MESSAGE` arrives), notifications skip non-viewers, the attachment URL returns 403.
- **Migration test**: the backfill gives ATTACH_FILES to every role with CREATE_MESSAGE.
- **Frontend**: hook tests; composer `read-only` state; the round trip `detectPreset(applyPreset(x)) === x`; the socket handler invalidates; stories and ui-pr-review for the settings tab.
- **Playwright**: an admin applies Announcement, and a member's open composer flips to read-only live.

### Phased rollout

| Phase | Ships | Effort |
|---|---|---|
| 1. Engine | Schema, migrations and backfill, `computeChannelActions`, guard integration, ATTACH_FILES enforcement, `PUT/GET overwrites` (no READ_CHANNEL, no MEMBER), `me` endpoints, WS event, tests | ~3–4 days |
| 2. UI | Permissions tab with presets and attachment toggle, `useChannelPermissions`, composer read-only, megaphone icon, handler, stories | ~3 days |
| 3. Visibility | `ChannelAccessService`, migrate the ~10 `isPrivate` call sites, room sync, filtered channel list, Mods-only preset | ~3–4 days, highest risk |
| 4. Voice | SPEAK/VIDEO/SCREEN_SHARE, LiveKit `canPublishSources`, live `updateParticipant` | ~2 days |
| 5. Advanced | Matrix editor, MEMBER overwrites, SEND_IN_THREADS, optional ADMINISTRATOR | ~2–3 days |

Phases 1 and 2 (~1.5 weeks) deliver announcement, read-only and no-attachments channels. Until phase 3, a "mods only" channel can still be made the existing way (a private channel with a member list).

### Risks
- **Performance**: each channel check gains one indexed join and an in-memory merge, with no extra round trip. Bulk visibility is O(channels) or O(members) in memory per call. Add a metric on resolver latency, and only add the `chow` cache if needed.
- **Security**:
  - non-member grants (prevented by step 2);
  - socket room drift after losing view (phase 3 must leave rooms);
  - the guard and bulk visibility disagreeing (prevented by a single pure function);
  - privilege escalation through overwrites (anti-escalation rule, managing is community-only);
  - a missed backfill silently removing attach from everyone (migration test).
- **UX**: admins lock their own role out of posting. Mitigated by preset defaults and a warning in the advanced editor when the actor's own roles lose CREATE_MESSAGE.
- **Old Electron clients**: they show the composer, and the server rejects the send (today's fail-open behavior, so acceptable).

### Open questions for the owner
1. Hide channels you can't see from the channel list? Today private channel names are visible to every member with a lock. Recommended: hide.
2. Add a community `ADMINISTRATOR` action that bypasses overwrites, like Discord? Recommended: not in v1.
3. Per-member overwrites: phase 5, or never (private-channel membership already covers per-user view)?
4. A new `MANAGE_CHANNEL_PERMISSIONS` action (Admin only by default), or reuse `UPDATE_CHANNEL`, which Moderators also have by default? Recommended: new action.
5. Should announcements allow thread replies? This needs `SEND_IN_THREADS`.
6. Move the timeout check into the resolver as a mask? That also blocks reactions, thread replies and speaking, which today ignore timeouts.
7. Is it intended that webhooks keep posting into read-only and announcement channels (bots, feeds)? Recommended: yes.
8. Categories don't exist. If they come later, add category-level overwrites with Discord-style "sync" inheritance. OK to leave out of scope?
