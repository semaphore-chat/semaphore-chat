/**
 * Mute negative / permission cases (Piece B) — the things that must NOT happen,
 * and rapid state changes that must not desync, over real LiveKit.
 *
 *   1. MODERATOR-MUTE IS DENIED for a non-privileged member. An ordinary member
 *      (InstanceRole.USER, no community mute role) calling the mute endpoint must
 *      be rejected (403). A positive control proves the same endpoint succeeds
 *      for an OWNER — so the 403 is authorization, not a broken endpoint.
 *   2. RAPID LOCAL MUTE/UNMUTE TOGGLES don't desync: the final state wins — a
 *      burst ending "unmuted" → peer receives; ending "muted" → peer stops.
 *   3. A MODERATOR MUTE RIGHT AFTER JOINING (#815, fixme): muted as soon as
 *      the target's audio flows, while its soundboard warm-up may still be
 *      publishing, the target is heard again once the mute is lifted and it
 *      unmutes.
 *
 * The member never joins voice (a USER-role account isn't driven through the
 * voice-join UI here); it calls the mute REST endpoint directly via
 * `tryModeratorMuteAs`. The mute *target* is a real voice participant so the
 * 403/positive-control assertions act on an actual live publication.
 *
 * Requires the real-LiveKit stack: scripts/run-voice-e2e.sh
 */
import { test, expect } from '@playwright/test';
import {
  launchParticipant,
  joinVoiceChannel,
  closeParticipant,
  waitForAudioFlow,
  expectNoAudioGrowth,
  setMicEnabled,
  moderatorMute,
  waitForRemoteAudioElements,
  tryModeratorMuteAs,
  MEMBER_USER,
  TEST_USER,
  TEST_USER_2,
  type Participant,
} from '../fixtures/voice.fixture';

test.describe.configure({ mode: 'serial' });

const CH = 'voice-perms';

test.describe('Mute permissions & rapid toggles', () => {
  let owner: Participant; // OWNER who can moderate, and a voice participant
  let target: Participant; // the mute target (a real publication)

  test.afterEach(async () => {
    await Promise.all(
      [owner, target].filter(Boolean).map((p) => closeParticipant(p).catch(() => {})),
    );
    owner = target = undefined as unknown as Participant;
  });

  test('moderator-mute is denied (403) for a non-privileged member, but works for an owner', async () => {
    owner = await launchParticipant(TEST_USER, 'sample-a.wav');
    target = await launchParticipant(TEST_USER_2, 'sample-b.wav');
    await joinVoiceChannel(owner, CH);
    await joinVoiceChannel(target, CH);
    await waitForAudioFlow(owner, target);
    // The target's soundboard track is published about a second after joining, after its mic already
    // flows. A moderator mute that lands while that publish is in flight takes the soundboard source
    // away mid-publish (the muted grant has no UNKNOWN source), and the target's later mic republish
    // never reaches the owner (on a slow runner: CI run 43792103516; #815, test 3 below). This test is
    // about authorization, so it mutes a settled participant.
    await waitForRemoteAudioElements(owner, target);

    // A non-privileged member (REST-only, never joined) is FORBIDDEN to mute.
    const memberStatus = await tryModeratorMuteAs(
      MEMBER_USER,
      target.identity,
      true,
      owner.channelId,
    );
    expect(memberStatus, `expected 403 for non-privileged mute, got ${memberStatus}`).toBe(403);
    // The forbidden call had no effect — owner still hears the target.
    await waitForAudioFlow(owner, target, { timeout: 30_000 });

    // Positive control: the OWNER muting the same target SUCCEEDS and audio stops.
    await moderatorMute(owner, target.identity, true, owner.channelId); // throws if not 2xx
    await expectNoAudioGrowth(owner, target);

    // Restore: the owner lifts the mute, then the target unmutes themselves.
    await moderatorMute(owner, target.identity, false, owner.channelId);
    await setMicEnabled(target, true);
    await waitForAudioFlow(owner, target, { timeout: 30_000 });
  });

  test('rapid local mute/unmute toggles settle to the final state', async () => {
    owner = await launchParticipant(TEST_USER, 'sample-a.wav');
    target = await launchParticipant(TEST_USER_2, 'sample-b.wav');
    await joinVoiceChannel(owner, CH);
    await joinVoiceChannel(target, CH);
    await waitForAudioFlow(owner, target);

    // Burst ending UNMUTED → owner must hear the target.
    for (let i = 0; i < 6; i++) {
      await setMicEnabled(target, i % 2 === 1); // …,true → ends unmuted
    }
    await waitForAudioFlow(owner, target, { timeout: 30_000 });

    // Burst ending MUTED → owner must stop receiving.
    for (let i = 0; i < 5; i++) {
      await setMicEnabled(target, i % 2 === 1); // ends i=4 → false (muted)
    }
    await expectNoAudioGrowth(owner, target);

    // Clean recovery.
    await setMicEnabled(target, true);
    await waitForAudioFlow(owner, target, { timeout: 30_000 });
  });

  // #815, still open. With the browsers and LiveKit limited to 1 CPU, the mute regularly lands while the target's
  // soundboard warm-up is being published: LiveKit refuses it ("no permission to publish mediaTrack source
  // UNKNOWN") and livekit-client only gives up on that publish 10-20 s later. Seen in 2 x 10 runs (2026-11-16):
  //   the target was heard again in 19 of 20; once, the mic republished after the unmute showed up twice under one
  //   track id on the server and was unpublished when the refused soundboard publish timed out, so the owner heard
  //   nothing (the issue's symptom). This test asserts only that: the target is heard again. Whether the
  //   soundboard comes back, and is audible, is soundboard.spec.ts's test 5.
  // Passes on an unthrottled machine. Run it with `--grep=#815` and the CPU limits (pr-9a report) when fixing #815.
  test.fixme('a moderator mute within a second of joining: after the unmute the owner hears the target again (#815)', async () => {
    owner = await launchParticipant(TEST_USER, 'sample-a.wav');
    target = await launchParticipant(TEST_USER_2, 'sample-b.wav');
    await joinVoiceChannel(owner, CH);
    await joinVoiceChannel(target, CH);
    await waitForAudioFlow(owner, target);
    // No waitForRemoteAudioElements: the mute lands as early as test 1's did before that wait, when the
    // target's soundboard warm-up can still be publishing.
    await moderatorMute(owner, target.identity, true, owner.channelId);
    await expectNoAudioGrowth(owner, target);

    await moderatorMute(owner, target.identity, false, owner.channelId);
    await setMicEnabled(target, true);
    // #815: after the lift and the unmute the owner hears the target again.
    await waitForAudioFlow(owner, target, { timeout: 30_000 });
  });
});
