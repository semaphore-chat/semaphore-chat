/**
 * Mute matrix — local mute vs moderator (server) mute.
 *
 * Two distinct mute paths the app builds on LiveKit, both asserted by real audio
 * flow through real LiveKit (no human listener):
 *   - LOCAL mute:     a user mutes their OWN mic → peers stop receiving them.
 *   - MODERATOR mute: an admin mutes ANOTHER participant via the backend
 *                     (POST /livekit/channels/:id/mute-participant →
 *                      RoomServiceClient.mutePublishedTrack) → peers stop
 *                     receiving the muted user.
 *
 * "Stops receiving" is asserted as inbound audio bytes no longer growing
 * (totalAudioEnergy is cumulative and can't decrease, so we assert no-growth).
 *
 * Requires the real-LiveKit stack: scripts/run-voice-e2e.sh
 */
import { test } from '@playwright/test';
import {
  launchParticipant,
  joinVoiceChannel,
  closeParticipant,
  waitForAudioFlow,
  expectNoAudioGrowth,
  setMicEnabled,
  moderatorMute,
  ADMIN_USER,
  TEST_USER,
  TEST_USER_2,
  type Participant,
} from '../fixtures/voice.fixture';

test.describe.configure({ mode: 'serial' });

test.describe('Mute matrix — local mute vs moderator mute', () => {
  let a: Participant; // testuser
  let b: Participant; // testuser2
  let admin: Participant; // moderator (InstanceRole.OWNER → bypasses community RBAC)

  test.beforeAll(async () => {
    a = await launchParticipant(TEST_USER, 'sample-a.wav');
    b = await launchParticipant(TEST_USER_2, 'sample-b.wav');
    admin = await launchParticipant(ADMIN_USER, 'sample-c.wav');
    await joinVoiceChannel(a, 'voice-mute');
    await joinVoiceChannel(b, 'voice-mute');
    await joinVoiceChannel(admin, 'voice-mute');
  });

  test.afterAll(async () => {
    await Promise.all([a, b, admin].filter(Boolean).map(closeParticipant));
  });

  test('baseline: A and B hear each other', async () => {
    await waitForAudioFlow(b, a);
    await waitForAudioFlow(a, b);
  });

  test('local mute: when A mutes, B stops receiving A; unmute restores it', async () => {
    await setMicEnabled(a, false);
    await expectNoAudioGrowth(b, a);

    await setMicEnabled(a, true);
    await waitForAudioFlow(b, a, { timeout: 30_000 });
  });

  test('moderator mute: admin mutes B server-side → A stops receiving B', async () => {
    await moderatorMute(admin, b.identity, true, admin.channelId);

    // The user-facing guarantee is that A stops RECEIVING B's audio. We assert on
    // actual inbound data flow rather than `RemoteTrackPublication.isMuted`: a
    // server-side mute via RoomServiceClient.mutePublishedTrack stops the media
    // (inbound bytes drop to RTCP-keepalive levels) but does NOT reliably flip
    // the remote subscriber's `isMuted` flag in this LiveKit version. Data flow
    // is the truth; the flag is incidental.
    await expectNoAudioGrowth(a, b);

    // B can't undo it: the microphone isn't theirs to publish until it's lifted.
    await setMicEnabled(b, true).catch(() => {});
    await expectNoAudioGrowth(a, b);

    // A moderator lifts the mute but doesn't turn B's mic back on (LiveKit won't
    // force-unmute, by design: no mic without consent). B unmutes themselves.
    await moderatorMute(admin, b.identity, false, admin.channelId);
    await setMicEnabled(b, true);
    await waitForAudioFlow(a, b, { timeout: 30_000 });
  });
});
