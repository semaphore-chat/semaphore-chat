# The showcase demo data, and keeping it consistent

Every screenshot and every video scene shows **one moment in one team's day**: Tuesday 22 Sep 2026, 3:42 PM in America/New_York, at "Lumen Studio", a small product team shipping a release. Viewers compare screenshots side by side, so a detail that disagrees between two of them, like a person in two voice channels, a badge on the conversation you're reading, or a bell count that doesn't add up, makes the whole set look fake. Most review findings so far have been continuity problems.

## Where it lives

- **`frontend/src/stories/fixtures/showcase.ts`** holds the data:
  - the people (`PERSONAS`, plus Alex Kim `me` with username `alex`, id `me`);
  - communities: Lumen Studio `c-lumen`, plus `c-trail` and `c-synth`, which appear in the rail;
  - channels (`showcaseChannels`: `ch-announcements`, `ch-general`, `ch-dev`, `ch-design`, `ch-random`, and the voice channels `vc-lounge` and `vc-standup`);
  - messages, the release thread (`SHOWCASE_THREAD_PARENT_ID`), DMs (`dm-priya`, and the group `dm-launch` "Launch crew");
  - notifications, roles, memberships, voice presence and unread counts.

  It also exports the helpers `at('15:42', daysAgo)`, `showcaseWithRead`, `showcaseWithMeInVoice`, `showcaseLoungeCrew`, `showcaseStandupCrew` and `showcasePaths`.
- **`showcaseArt.ts`** holds the artwork, all hand-written SVG generated locally with no network access:
  - illustrated avatars (`illustratedAvatarSvg`, with a `look` per persona);
  - community icons and banners;
  - image attachments;
  - the PR link-preview card.

  Each piece is registered with `registerShowcaseFile(id, svg)` and served through the `/api/file/:id` MSW handler.
- **`showcaseStory.ts`** is the "server" behind the stories:
  - `defineShowcase`;
  - the socket that acks sends and pushes events;
  - the fake LiveKit room;
  - `LiveState`, which keeps unread counts, notifications and DM previews consistent while a recording runs;
  - `window.__showcase`.

## Rules that keep it believable

- **Time.** Every timestamp comes from `at('HH:MM', daysAgo)` and must be at or before 3:42 PM today. Messages sent during a recording are stamped with the frozen clock, so they show 3:42 PM. Keep a conversation's times in order, and keep messages that refer to each other in agreement, e.g. "CI is green" comes after "merging as soon as CI is green".
- **Online and voice.** Someone is online if and only if their persona has a `status` (Noah and Mateo are offline). Only online people can be in voice, and each person is in at most one voice channel:
  - Lounge (`showcaseLoungeCrew`): Priya, Diego, Chloé.
  - Standup (`showcaseStandupCrew`): Samira, Marcus, Aiko.

  Alex joins with `showcaseWithMeInVoice(channelId, scenario, joinedAt)`, which adds him after the people already there, and never replaces them. Voice participants in a story (`voice.remotes`) must be exactly that channel's people. Speakers in a scene (`conversation([...])`) must be people in the room.
- **The tour's story line.** Alex is in #dev. He sends "Merged!", reads Priya's DM and replies, then joins the Lounge. On his phone he posts "On my way to standup" (Aiko: "See you there!"). He ends in Standup, in the light theme (`ChatLightStandup`). A new scene or shot has to fit into that line, or clearly stand alone.
- **Unread badges.** They are set with `withUnread(scenario, contextId, count, mentions)` at the end of `showcase.ts`, and mean "the newest N messages of that context are unread". A story that opens a conversation must start from `showcaseWithRead(contextId)`, so there is no badge on what you're reading and its notifications are marked read.
- **Notifications** are built from real messages with `notification(type, messageId, read)`, which throws if the message doesn't exist. Follow what the backend does (`notifications.service.ts`):
  - one `DIRECT_MESSAGE` per DM message; a mention inside a DM is still `DIRECT_MESSAGE`;
  - `USER_MENTION` for a channel mention;
  - `THREAD_REPLY` for a watched thread.

  Keep the list sorted newest first, as the API returns it. The bell count is the number of unread notifications. It must equal the unread DM messages plus the unread mentions (currently 2 for Priya, 3 for Launch crew and 1 in #design, which makes 6), and it must match the DM and channel badges.
- **Roles.** Every community has the default Community Admin, Moderator and Member roles. Lumen adds the custom Release Manager and Designer roles. The creator (listed first in a community's members) is its Community Admin. Assign roles in `membershipsByCommunity`. The member list reads them from `/api/roles/user/:id/community/:id` (gotcha 16).
- **Reactions** list real user ids (`react('🎉', U.priya, U.aiko)`). A reaction count shown in a screenshot is the length of that list.
- **Names and text.** Use no lorem ipsum, no "reply #N", and no "SIMULATED" (the pipeline rejects all three). Each person's name, avatar and role should be the same everywhere, and nobody should appear twice in a list.

## Checking a data change

Change the data, then regenerate everything it touches. A change to `showcase.ts` affects every story, so run the full pipeline (all steps). Then review everything `changed-media.sh` lists ([review.md](review.md)): usually most screenshots, and always the videos, because they were re-recorded. Type-check and lint the stories in Docker:

```bash
docker compose run --rm frontend pnpm run type-check
docker compose run --rm frontend pnpm exec eslint src/stories/fixtures/showcase.ts src/stories/tour/Tour.stories.tsx
```
