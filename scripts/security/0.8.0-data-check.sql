-- Read-only check for messages written before the message-target and
-- attachment fixes. The transaction is READ ONLY and rolled back: nothing here
-- can change data. Run: psql -f scripts/security/0.8.0-data-check.sql
--
-- Each row of output is one check: its count and up to 20 ids to look at.
--
-- A) CERTAIN: normal use can't produce these. Treat each as a real bad row.
--    both_targets              Message has a channel AND a DM group. Written by
--                              a mixed send. Readable from both places.
--    no_target                 Message has neither. Written by a target-less
--                              REST send (owner or instance-role user only).
--    notification_both_targets Notification with both targets, from a mixed send.
--    attachment_foreign_upload Attachment whose file was uploaded by someone
--                              other than the message author. The file's name,
--                              type and size show to the message's readers; its
--                              bytes stay gated. Deleting that message used to
--                              delete the file too.
--
-- B) MOVED ROWS: an edit could change a message's target without a trace (no
--    audit log, and editedAt stays null unless spans changed too). These catch
--    the side effects of a move. Normal use shouldn't produce them, so they are
--    strong leads, but they don't say who did it or where the row came from.
--    older_than_channel        Sent before its channel existed.
--    older_than_dm_group       Sent before its DM group existed.
--    thread_context_differs    A reply and its parent are in different places:
--                              one of them was moved.
--    quote_context_differs     A quote points at another place: moved, or a
--                              replyToId set by an edit. The quoted text was
--                              exposed to whoever read this message.
--
-- C) LEADS ONLY, expect false positives. Check each one by hand.
--    author_not_in_dm_group          Moved into the group, OR the author left it.
--    author_not_in_channel_community Moved in, OR the author left or was banned,
--                                    OR an instance owner posting without
--                                    joining the community.
--    author_not_in_private_channel   Moved in, OR the author was removed, OR the
--                                    author has access by role or overwrite
--                                    rather than ChannelMembership.
--
-- D) FILE OWNERSHIP, from uploads and image pointers.
--    CERTAIN, normal use can't produce these:
--    user_file_for_other_user   Avatar or banner uploaded by one user for
--                               another. Unused unless that user points at it.
--    message_file_other_author  File uploaded under someone else's message.
--                               Readers of that message can open it by id.
--    user_image_foreign_file    A profile points at a file that isn't its own
--                               avatar or banner. Exposes the file's id only.
--    community_image_foreign    A community points at a file that isn't its own
--                               image. Before the fix, replacing it deleted
--                               that file.
--    LEAD, expect false positives:
--    community_file_non_member  Community image, emoji or sound uploaded by
--                               someone not in the community: planted, OR they
--                               left, OR an instance owner who never joined. A
--                               member without permission isn't caught here.
--
-- E) ROLES AND MEMBERSHIP, from role assignment without rank or membership checks.
--    CERTAIN, normal use can't produce these:
--    role_holder_not_member     A community role held by someone not in the
--                               community. Their RBAC checks pass, and they
--                               don't show in member lists. Treat as a backdoor.
--    role_holder_banned         A community role held by someone actively banned.
--    instance_row_community_role A community role assigned as an instance role:
--                               its actions apply instance-wide.
--    role_other_community       An assignment whose community isn't the role's.
--    LEADS, expect false positives:
--    role_position_out_of_range A role placed above the minimum position (below
--                               1): someone raised it, or an old manual edit.
--    invite_community_no_right  An invite targeting a community its creator
--                               can't invite to: planted, OR they lost the role
--                               later, OR an Instance Admin created it.
--    alias_member_not_in_community  A former member still in an alias group.
--                               Expected on old data: leaving never removed it.
--
-- CANNOT BE DETECTED:
--    * A moderator who gave themselves a role and is still a member: it looks
--      like any assignment. There's no audit log of role changes, so compare
--      the holders of high roles with who you expect.
--    * An expected role edited or reordered by someone below it. Same reason.
--    * A move into a channel or group the author could post in, when the target
--      is older than the message and the row has no replies or quote. It looks
--      identical to a normal message.
--    * Any move later reversed by a second edit.
--    * A file already deleted through a foreign attachment. The cleanup job
--      removes the file and its rows, leaving nothing to find.
--    * Who read a mixed row or a quoted message. Reads aren't logged.
--    So zero here means no evidence found, not proof that nothing happened.
--
-- F) VOICE, DMS AND PUSH, from the recording, DM and push fixes.
--    egress_room_differs       A recording whose room isn't its channel: started
--                              with another room's name. CERTAIN, look at who.
--    dm_subscriber_not_member  Thread subscription in a DM group the user isn't
--                              in. Harmless after the fix (filtered at send);
--                              shows who kept getting replies before it.
--    push_sub_banned_user      Push subscription of a banned user: they were
--                              still getting previews. The fix deletes on ban.
--    push_endpoint_not_public  Endpoint that isn't https on a host name: never
--                              from a browser. Dropped at the next send.
--    dm_1on1_not_two_members   1:1 DM without exactly two members: someone left
--                              or was deleted. Normal. Before the fix, its last
--                              message was readable by whoever opened a DM
--                              with the member who stayed.

BEGIN TRANSACTION READ ONLY;

WITH flagged(check_name, id) AS (
  SELECT 'both_targets', id FROM "Message"
   WHERE "channelId" IS NOT NULL AND "directMessageGroupId" IS NOT NULL
  UNION ALL
  SELECT 'no_target', id FROM "Message"
   WHERE "channelId" IS NULL AND "directMessageGroupId" IS NULL
  UNION ALL
  SELECT 'notification_both_targets', id FROM "Notification"
   WHERE "channelId" IS NOT NULL AND "directMessageGroupId" IS NOT NULL
  UNION ALL
  SELECT 'attachment_foreign_upload', a.id FROM "MessageAttachment" a
    JOIN "Message" m ON m.id = a."messageId"
    JOIN "File" f ON f.id = a."fileId"
   WHERE f."uploadedById" IS DISTINCT FROM m."authorId"
  UNION ALL
  SELECT 'older_than_channel', m.id FROM "Message" m
    JOIN "Channel" c ON c.id = m."channelId"
   WHERE m."sentAt" < c."createdAt"
  UNION ALL
  SELECT 'older_than_dm_group', m.id FROM "Message" m
    JOIN "DirectMessageGroup" g ON g.id = m."directMessageGroupId"
   WHERE m."sentAt" < g."createdAt"
  UNION ALL
  SELECT 'thread_context_differs', r.id FROM "Message" r
    JOIN "Message" p ON p.id = r."parentMessageId"
   WHERE r."channelId" IS DISTINCT FROM p."channelId"
      OR r."directMessageGroupId" IS DISTINCT FROM p."directMessageGroupId"
  UNION ALL
  SELECT 'quote_context_differs', m.id FROM "Message" m
    JOIN "Message" q ON q.id = m."replyToId"
   WHERE m."channelId" IS DISTINCT FROM q."channelId"
      OR m."directMessageGroupId" IS DISTINCT FROM q."directMessageGroupId"
  UNION ALL
  SELECT 'author_not_in_dm_group', m.id FROM "Message" m
   WHERE m."directMessageGroupId" IS NOT NULL AND m."authorId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "DirectMessageGroupMember" s
                      WHERE s."groupId" = m."directMessageGroupId"
                        AND s."userId" = m."authorId")
  UNION ALL
  SELECT 'author_not_in_channel_community', m.id FROM "Message" m
    JOIN "Channel" c ON c.id = m."channelId"
   WHERE m."authorId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "Membership" s
                      WHERE s."communityId" = c."communityId"
                        AND s."userId" = m."authorId")
  UNION ALL
  SELECT 'author_not_in_private_channel', m.id FROM "Message" m
    JOIN "Channel" c ON c.id = m."channelId"
   WHERE c."isPrivate" AND m."authorId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "ChannelMembership" s
                      WHERE s."channelId" = c.id AND s."userId" = m."authorId")
  UNION ALL
  SELECT 'user_file_for_other_user', id FROM "File"
   WHERE "resourceType" IN ('USER_AVATAR', 'USER_BANNER')
     AND "fileUserId" IS NOT NULL AND "uploadedById" IS NOT NULL
     AND "fileUserId" <> "uploadedById"
  UNION ALL
  SELECT 'message_file_other_author', f.id FROM "File" f
    JOIN "Message" m ON m.id = f."fileMessageId"
   WHERE f."uploadedById" IS DISTINCT FROM m."authorId"
  UNION ALL
  SELECT 'user_image_foreign_file', u.id FROM "User" u
    JOIN "File" f ON f.id = u."avatarUrl"
   WHERE f."resourceType" <> 'USER_AVATAR'
      OR f."uploadedById" IS DISTINCT FROM u.id
  UNION ALL
  SELECT 'user_image_foreign_file', u.id FROM "User" u
    JOIN "File" f ON f.id = u."bannerUrl"
   WHERE f."resourceType" <> 'USER_BANNER'
      OR f."uploadedById" IS DISTINCT FROM u.id
  UNION ALL
  SELECT 'community_image_foreign', c.id FROM "Community" c
    JOIN "File" f ON f.id = c.avatar
   WHERE f."resourceType" <> 'COMMUNITY_AVATAR'
      OR f."fileCommunityId" IS DISTINCT FROM c.id
  UNION ALL
  SELECT 'community_image_foreign', c.id FROM "Community" c
    JOIN "File" f ON f.id = c.banner
   WHERE f."resourceType" <> 'COMMUNITY_BANNER'
      OR f."fileCommunityId" IS DISTINCT FROM c.id
  UNION ALL
  SELECT 'community_file_non_member', f.id FROM "File" f
   WHERE f."fileCommunityId" IS NOT NULL AND f."uploadedById" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "Membership" s
                      WHERE s."communityId" = f."fileCommunityId"
                        AND s."userId" = f."uploadedById")
  UNION ALL
  SELECT 'role_holder_not_member', ur.id FROM "UserRoles" ur
   WHERE ur."communityId" IS NOT NULL AND NOT ur."isInstanceRole"
     AND NOT EXISTS (SELECT 1 FROM "Membership" s
                      WHERE s."communityId" = ur."communityId"
                        AND s."userId" = ur."userId")
  UNION ALL
  SELECT 'role_holder_banned', ur.id FROM "UserRoles" ur
    JOIN "CommunityBan" b ON b."communityId" = ur."communityId"
                         AND b."userId" = ur."userId"
   WHERE b.active AND (b."expiresAt" IS NULL OR b."expiresAt" > now())
  UNION ALL
  SELECT 'instance_row_community_role', ur.id FROM "UserRoles" ur
    JOIN "Role" r ON r.id = ur."roleId"
   WHERE ur."isInstanceRole" AND r."communityId" IS NOT NULL
  UNION ALL
  SELECT 'role_other_community', ur.id FROM "UserRoles" ur
    JOIN "Role" r ON r.id = ur."roleId"
   WHERE NOT ur."isInstanceRole"
     AND ur."communityId" IS DISTINCT FROM r."communityId"
  UNION ALL
  SELECT 'role_position_out_of_range', id FROM "Role"
   WHERE "communityId" IS NOT NULL AND position < 1
  UNION ALL
  SELECT 'invite_community_no_right', d.id
    FROM "InstanceInviteDefaultCommunity" d
    JOIN "InstanceInvite" i ON i.id = d."inviteId"
    JOIN "User" u ON u.id = i."createdById"
   WHERE u.role <> 'OWNER'
     AND NOT EXISTS (SELECT 1 FROM "UserRoles" ur
                       JOIN "Role" r ON r.id = ur."roleId"
                      WHERE ur."userId" = i."createdById"
                        AND ur."communityId" = d."communityId"
                        AND 'CREATE_INVITE' = ANY (r.actions))
  UNION ALL
  SELECT 'alias_member_not_in_community', am.id FROM "AliasGroupMember" am
    JOIN "AliasGroup" g ON g.id = am."aliasGroupId"
   WHERE NOT EXISTS (SELECT 1 FROM "Membership" s
                      WHERE s."communityId" = g."communityId"
                        AND s."userId" = am."userId")
  UNION ALL
  SELECT 'egress_room_differs', e.id FROM "EgressSession" e
   WHERE e."roomName" <> e."channelId"
  UNION ALL
  SELECT 'dm_subscriber_not_member', ts.id FROM "ThreadSubscriber" ts
    JOIN "Message" m ON m.id = ts."parentMessageId"
   WHERE m."directMessageGroupId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "DirectMessageGroupMember" dm
                      WHERE dm."groupId" = m."directMessageGroupId"
                        AND dm."userId" = ts."userId")
  UNION ALL
  SELECT 'push_sub_banned_user', ps.id FROM "PushSubscription" ps
    JOIN "User" u ON u.id = ps."userId"
   WHERE u.banned
  UNION ALL
  SELECT 'push_endpoint_not_public', ps.id FROM "PushSubscription" ps
   WHERE ps.endpoint !~ '^https://[^/:@]*[a-zA-Z-][^/:@]*(:443)?(/|$)'
  UNION ALL
  SELECT 'dm_1on1_not_two_members', g.id FROM "DirectMessageGroup" g
   WHERE NOT g."isGroup"
     AND (SELECT count(*) FROM "DirectMessageGroupMember" dm
           WHERE dm."groupId" = g.id) <> 2
)
SELECT n.check_name, count(f.id) AS count, (array_agg(f.id))[1:20] AS sample_ids
  FROM (VALUES
    ('both_targets'), ('no_target'), ('notification_both_targets'),
    ('attachment_foreign_upload'), ('older_than_channel'),
    ('older_than_dm_group'), ('thread_context_differs'),
    ('quote_context_differs'), ('author_not_in_dm_group'),
    ('author_not_in_channel_community'), ('author_not_in_private_channel'),
    ('user_file_for_other_user'), ('message_file_other_author'),
    ('user_image_foreign_file'), ('community_image_foreign'),
    ('community_file_non_member'), ('role_holder_not_member'),
    ('role_holder_banned'), ('instance_row_community_role'),
    ('role_other_community'), ('role_position_out_of_range'),
    ('invite_community_no_right'), ('alias_member_not_in_community'),
    ('egress_room_differs'), ('dm_subscriber_not_member'),
    ('push_sub_banned_user'), ('push_endpoint_not_public'),
    ('dm_1on1_not_two_members')
  ) AS n(check_name)
  LEFT JOIN flagged f USING (check_name)
 GROUP BY n.check_name
 ORDER BY n.check_name;

ROLLBACK;
