# The showcase demo data, and keeping it consistent

Every screenshot and every video scene shows **one moment**: Tuesday 22 Sep 2026, 9:04 PM in America/New_York. The main community is **"Couch Co-op"**, a group of friends who play a fictional co-op game, **Deep Rift**, on Friday nights. Alex (`alexk`, the viewer) is also in **"Lumen Studio"**, the small product team he works at, whose afternoon is still there (#dev, the release group DM). Viewers compare screenshots side by side, so a detail that disagrees between two of them, like a person in two voice channels, a badge on the conversation you're reading, or a bell count that doesn't add up, makes the whole set look fake. Most review findings so far have been continuity problems.

## Tone

Couch Co-op should read like a real group chat: understated, mostly logistics, dry, mostly lowercase, few emoji. Don't add jokes, catchphrases or extra emoji. The game is fictional: no real game, studio or trademark anywhere (the site is `deeprift.gg`, clips are on `clips.deeprift.gg`). The marketing copy around the media (captions, alt text, the README and the Tour page) stays neutral product copy.

## Where it lives

- **`frontend/src/stories/fixtures/showcase.ts`** holds the data:
  - the people (`PERSONAS`, each with a stable `key` used in the file, e.g. `U.marcus`, and a `username`/`displayName` that is their handle, e.g. `dropbear`), plus Alex `me` (username and display name `alexk`, id `me`);
  - communities: Couch Co-op `c-couch` (first in the rail), Lumen Studio `c-lumen`, plus `c-trail` and `c-synth`;
  - Couch Co-op's channels (`showcaseChannels`: `cc-general`, `cc-clips`, `cc-lfg`, `cc-memes`, and the voice channels `vc-squad` "Squad Up" and `vc-afk` "AFK"), and Lumen Studio's (`lumenChannels`: `ch-announcements`, `ch-general`, `ch-dev`, `ch-design`, `ch-random`, `vc-lounge`, `vc-standup`);
  - messages, the Friday thread in #general (`SHOWCASE_THREAD_PARENT_ID`), Lumen's release thread in #dev, DMs (`dm-priya` with pri, the Lumen group `dm-launch` "Launch crew", and three 1:1s);
  - notifications, roles, memberships, voice presence, who is online (`SHOWCASE_ONLINE_IDS`) and unread counts.

  It also exports the helpers `at('21:04', daysAgo)`, `showcaseWithRead`, `showcaseWithMeInVoice`, `showcaseSquadCrew` and `showcasePaths`.
- **`showcaseArt.ts`** holds the artwork, all hand-written SVG generated locally with no network access:
  - illustrated avatars (`illustratedAvatarSvg`, with a `look` per persona; each person keeps the same avatar in every community);
  - community icons and banners (the couch glyph is Couch Co-op's);
  - image attachments (gracie's Deep Rift pit screenshot, Lumen's mock-ups);
  - link-preview cards (the Deep Rift 6.2 patch notes, Lumen's pull request).

  Each piece is registered with `registerShowcaseFile(id, svg)` and served through the `/api/file/:id` MSW handler.
- **`showcaseGifs.ts`** holds the GIFs (see gotcha 36): drawn on a canvas and encoded in the page, served from a fictional GIF host, and returned by the mocked GIF search. Never use GIFs from a real provider.
- **`showcaseStory.ts`** is the "server" behind the stories:
  - `defineShowcase`;
  - the socket that acks sends and pushes events;
  - the fake LiveKit room;
  - `LiveState`, which keeps unread counts, notifications and DM previews consistent while a recording runs;
  - presence (from `SHOWCASE_ONLINE_IDS`), GIF search turned on, and `window.__showcase`.

## Names

Display names are per user: the backend has no per-community nicknames. So everyone goes by their handle in every community, Lumen Studio included: Alex `alexk`, Marcus `dropbear`, Aiko `aiko`, Grace `gracie`, Priya `pri`, Kwame `kwam3`, Samira `Samira`, Tomás `tomatillo`, Chloé `chlo`, Noah `noahbody`, Zara `zara`, Diego `Diego` and Mateo `mateo` (Lumen only). Usernames are the lowercase handles. `window.__showcase` refers to people by username (`pri`, `dropbear`, `samira`, ...).

## Rules that keep it believable

- **Time.** Every timestamp comes from `at('HH:MM', daysAgo)` and must be at or before 9:04 PM today. Messages sent during a recording are stamped with the frozen clock, so they show 9:04 PM. Keep a conversation's times in order, and keep messages that refer to each other in agreement. #general's transcript (8:02 to 8:23 PM) and its Friday thread are fixed wording and order.
- **Online and voice.** `online` on a persona decides presence; `status` is only the text under a name (most people don't set one: dropbear "back at 9", pri "downloading 40gb update", gracie "work tomorrow 😐"). Offline: Diego, noahbody, zara, mateo. Only online people can be in voice, and each person is in at most one voice channel:
  - Squad Up (`showcaseSquadCrew`): dropbear, pri.
  - AFK: kwam3.
  - Lumen's Lounge and Standup are empty (it's 9 PM).

  Alex joins with `showcaseWithMeInVoice(channelId, scenario, joinedAt)`, which adds him after the people already there, and never replaces them. Voice participants in a story (`voice.remotes`) must be exactly that channel's people. Speakers in a scene (`conversation([...])`) must be people in the room.
- **The tour's story line.** Alex is in Couch Co-op #general. He sends "ok i'm on at 8:45 friday", +1s the 😂 on gracie's screenshot and opens the Friday thread. He opens pri's DM, replies "yeah i saw", and she asks "you getting on?". On his phone he answers with an "ok" GIF from the GIF picker. Then he's in Squad Up with dropbear and pri, and it ends in #general in the light theme, still in voice (`ChatLightSquad`). A new scene or shot has to fit into that line, or clearly stand alone.
- **Lumen Studio shots.** `chat-light-desktop` (#dev, light theme), `community-settings-desktop`, `community-roles-desktop` and `dms-accent-desktop` ("Launch crew") show Alex's work community, so the media also shows the app used by a team.
- **Unread badges.** They are set with `withUnread(scenario, contextId, count, mentions)` at the end of `showcase.ts`, and mean "the newest N messages of that context are unread": #clips 2, #lfg 1, Lumen #general 4, #design 3 (1 mention), #announcements 1, pri's DM 3, Launch crew 3 (1 mention). A story that opens a conversation must start from `showcaseWithRead(contextId)`, so there is no badge on what you're reading and its notifications are marked read.
- **Notifications** are built from real messages with `notification(type, messageId, read)`, which throws if the message doesn't exist. Follow what the backend does (`notifications.service.ts`):
  - one `DIRECT_MESSAGE` per DM message; a mention inside a DM is still `DIRECT_MESSAGE`;
  - `USER_MENTION` for a channel mention;
  - `THREAD_REPLY` for a watched thread (the Friday thread's is read: Alex replied after it).

  Keep the list sorted newest first, as the API returns it. The bell count is the number of unread notifications. It must equal the unread DM messages plus the unread mentions (3 for pri, 3 for Launch crew and 1 in #design, which makes 7), and it must match the DM and channel badges.
- **Roles.** Every community has the default Community Admin, Moderator and Member roles (default role names can't be changed). The creator (listed first in a community's members) is its Community Admin: Samira in Couch Co-op, Alex in Lumen Studio. Couch Co-op adds one custom role, "mods" (dropbear, gracie); Lumen adds Release Manager and Designer. Assign roles in `membershipsByCommunity`. The member list reads them from `/api/roles/user/:id/community/:id` (gotcha 16).
- **Reactions** list real user ids (`react('😂', U.aiko, U.priya)`). A reaction count shown in a screenshot is the length of that list.
- **Names and text.** Use no lorem ipsum, no "reply #N", and no "SIMULATED" (the pipeline rejects all three). Each person's name, avatar and role should be the same everywhere, and nobody should appear twice in a list.
- **Layout.** The sizes of the pit screenshot and the GIFs decide where the top edge of #general falls in `chat-desktop` and `chat-phone` (gotcha 35). Adding or resizing anything in #general means checking both again.

## Checking a data change

Change the data, then regenerate everything it touches. A change to `showcase.ts` affects every story, so run the full pipeline (all steps). Then review everything `changed-media.sh` lists ([review.md](review.md)): usually most screenshots, and always the videos, because they were re-recorded. Type-check and lint the stories in Docker:

```bash
scripts/test-stack.sh <ticket> run-frontend pnpm run type-check
scripts/test-stack.sh <ticket> run-frontend pnpm exec eslint src/stories/fixtures/showcase.ts src/stories/fixtures/showcaseGifs.ts src/stories/tour/Tour.stories.tsx
```
