/**
 * Soundboard — remote audibility through real LiveKit (#292 / PR #406).
 *
 * The soundboard publishes a WebAudio-sourced track as Track.Source.Unknown
 * NAMED 'soundboard'; with autoSubscribe:false this only works if
 * useTrackSubscription auto-subscribes it by name and AudioRenderer renders it.
 * None of that is provable in unit tests, so this spec drives two real browsers
 * into a real LiveKit room and asserts:
 *
 *   1. warmup: A's soundboard track is published + subscribed on B BEFORE the
 *      first clip is triggered (the eager-publish fix for the first-clip race);
 *   2. the FIRST clip, triggered through the real SoundboardButton UI, carries
 *      actual signal to B (inbound totalAudioEnergy accrues — the warmed track
 *      is silent, so energy growth == the clip was audible);
 *   3. a second clip also plays (stop-and-restart path);
 *   4. B's mic path still works afterwards (no regression from the extra
 *      audio publication);
 *   5. after a moderator mute of B is lifted and B unmutes, a clip B plays is
 *      audible on A again: the mute unpublished (and LiveKit stopped) B's
 *      soundboard track, and the warm-up must republish a live one, not the
 *      ended track (peers would get an element that carries nothing).
 *
 * Seeding: the community's sound is created at test time via the real APIs
 * (multipart /file-upload with a synthesized 1.6s sine-tone WAV, then
 * POST /soundboard/community/:id). testuser is InstanceRole.OWNER, which
 * bypasses community RBAC for the create.
 *
 * Requires the real-LiveKit stack: scripts/run-voice-e2e.sh soundboard
 */
import { test, expect } from '@playwright/test';
import {
  launchParticipant,
  joinVoiceChannel,
  closeParticipant,
  waitForAudioFlow,
  getSoundboardTrackState,
  getSoundboardInbound,
  moderatorMute,
  expectNoAudioGrowth,
  setMicEnabled,
  TEST_USER,
  TEST_USER_2,
  type Participant,
} from '../fixtures/voice.fixture';
import { API_BASE } from '../fixtures/auth.fixture';

test.describe.configure({ mode: 'serial' });

/** Synthesize a 16-bit PCM mono WAV of a sine tone (RIFF/WAVE, no deps). */
function makeToneWav(durationSec = 1.6, freq = 440, sampleRate = 24000): Buffer {
  const numSamples = Math.floor(durationSec * sampleRate);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.8 * 32767);
    buf.writeInt16LE(v, 44 + i * 2);
  }
  return buf;
}

test.describe('Soundboard — clip is audible to remote participants', () => {
  let a: Participant; // testuser — triggers the sound
  let b: Participant; // testuser2 — must HEAR the sound
  // Unique per run so re-runs never hit the @@unique([communityId, name]) 409.
  const soundName = `e2e-tone-${Date.now()}`;

  test.beforeAll(async () => {
    a = await launchParticipant(TEST_USER, 'sample-a.wav');
    b = await launchParticipant(TEST_USER_2, 'sample-b.wav');

    // --- Seed the soundboard sound via the real APIs (as A, an OWNER). ---
    const auth = { Authorization: `Bearer ${a.accessToken}` };

    const communitiesRes = await a.context.request.get(`${API_BASE}/community`, {
      headers: auth,
    });
    expect(communitiesRes.ok(), 'GET /community failed').toBeTruthy();
    const communities = (await communitiesRes.json()) as Array<{ id: string; name: string }>;
    const community = communities.find((c) => c.name === 'Test Community');
    expect(community, 'seeded Test Community not found').toBeTruthy();

    const uploadRes = await a.context.request.post(`${API_BASE}/file-upload`, {
      headers: auth,
      multipart: {
        file: {
          name: 'e2e-tone.wav',
          mimeType: 'audio/wav',
          buffer: makeToneWav(),
        },
        resourceType: 'SOUNDBOARD_SOUND',
        resourceId: community!.id,
      },
    });
    expect(
      uploadRes.ok(),
      `file-upload failed: ${uploadRes.status()} ${await uploadRes.text()}`,
    ).toBeTruthy();
    const uploaded = (await uploadRes.json()) as { id: string };

    const createRes = await a.context.request.post(
      `${API_BASE}/soundboard/community/${community!.id}`,
      {
        headers: auth,
        data: { name: soundName, emoji: '🔊', fileId: uploaded.id },
      },
    );
    expect(
      createRes.ok(),
      `soundboard create failed: ${createRes.status()} ${await createRes.text()}`,
    ).toBeTruthy();

    // --- Both users into the dedicated voice channel. ---
    await joinVoiceChannel(a, 'voice-soundboard');
    await joinVoiceChannel(b, 'voice-soundboard');
  });

  test.afterAll(async () => {
    await Promise.all([a, b].filter(Boolean).map(closeParticipant));
  });

  test('baseline: A and B hear each other over mic', async () => {
    await waitForAudioFlow(b, a);
    await waitForAudioFlow(a, b);
  });

  test('warmup: soundboard track is published and subscribed BEFORE the first clip', async () => {
    // Eager publish on SoundboardButton mount + name-based auto-subscribe in
    // useTrackSubscription: B must already be subscribed to A's soundboard
    // track without anyone having clicked anything.
    await expect
      .poll(
        async () => {
          const s = await getSoundboardTrackState(b, a.identity);
          return s.published && s.subscribed && s.hasTrack;
        },
        {
          timeout: 20_000,
          message:
            "B never subscribed to A's warmed-up soundboard track ",
        },
      )
      .toBe(true);
  });

  test('FIRST clip triggered via the SoundboardButton UI is audible on B', async () => {
    // Baseline: warmed-up track carries silence → ~zero accumulated energy.
    const before = await getSoundboardInbound(b, a.identity);
    const beforeEnergy = before?.totalAudioEnergy ?? 0;
    const beforeBytes = before?.bytesReceived ?? 0;

    // Drive the REAL UI on A: open the soundboard popover, click the sound.
    await a.page.getByRole('button', { name: 'Open soundboard' }).click();
    const soundButton = a.page.getByRole('button', { name: soundName });
    await expect(soundButton).toBeVisible({ timeout: 10_000 });
    await soundButton.click();

    // The FIRST clip must carry real signal to B: totalAudioEnergy accrues only
    // for non-silent samples, so an inaudible/clipped-to-nothing first play
    // fails this. (0.05 ≈ 1/10th of the tone's total energy — well above float
    // noise, robust to the clip being partially consumed before sampling.)
    await expect
      .poll(
        async () => {
          const s = await getSoundboardInbound(b, a.identity);
          if (!s) return false;
          const energyGrew = s.totalAudioEnergy - beforeEnergy > 0.05;
          const bytesGrew = s.bytesReceived - beforeBytes > 1_000;
          return energyGrew && bytesGrew;
        },
        {
          timeout: 15_000,
          message: `first soundboard clip carried no audible signal ${a.name} → ${b.name}`,
        },
      )
      .toBe(true);
  });

  test('second clip also plays (stop-and-restart path)', async () => {
    const before = await getSoundboardInbound(b, a.identity);
    const beforeEnergy = before?.totalAudioEnergy ?? 0;

    // Popover stays open after a click; re-open if it auto-closed.
    const soundButton = a.page.getByRole('button', { name: soundName });
    if (!(await soundButton.isVisible().catch(() => false))) {
      await a.page.getByRole('button', { name: 'Open soundboard' }).click();
      await expect(soundButton).toBeVisible({ timeout: 10_000 });
    }
    await soundButton.click();

    await expect
      .poll(
        async () => {
          const s = await getSoundboardInbound(b, a.identity);
          return (s?.totalAudioEnergy ?? 0) - beforeEnergy > 0.05;
        },
        { timeout: 15_000, message: 'second soundboard clip carried no signal' },
      )
      .toBe(true);
  });

  test("B's mic still reaches A after soundboard use (no regression)", async () => {
    await waitForAudioFlow(a, b, { timeout: 30_000 });
    await waitForAudioFlow(b, a, { timeout: 30_000 });
  });

  test("after a moderator mute of B is lifted, a clip B plays is audible on A", async () => {
    // A (an OWNER) mutes B: the grant loses the mic and the soundboard, the server unpublishes both.
    await moderatorMute(a, b.identity, true, a.channelId);
    await expectNoAudioGrowth(a, b);
    await expect
      .poll(async () => (await getSoundboardTrackState(a, b.identity)).published, {
        timeout: 15_000,
        message: "the mute never took B's soundboard track down",
      })
      .toBe(false);

    // Lifted, and B unmutes: the mic first, then B's warm-up republishes the soundboard (a new, live track).
    await moderatorMute(a, b.identity, false, a.channelId);
    await setMicEnabled(b, true);
    await waitForAudioFlow(a, b, { timeout: 30_000 });
    await expect
      .poll(
        async () => {
          const st = await getSoundboardTrackState(a, b.identity);
          return st.published && st.subscribed && st.hasTrack;
        },
        { timeout: 20_000, message: "B's soundboard track never came back on A after the lift" },
      )
      .toBe(true);

    const before = await getSoundboardInbound(a, b.identity);
    const beforeEnergy = before?.totalAudioEnergy ?? 0;
    const beforeBytes = before?.bytesReceived ?? 0;
    const soundButton = b.page.getByRole('button', { name: soundName });
    if (!(await soundButton.isVisible().catch(() => false))) {
      await b.page.getByRole('button', { name: 'Open soundboard' }).click();
      await expect(soundButton).toBeVisible({ timeout: 10_000 });
    }
    await soundButton.click();

    // Audio, not an element count: A's inbound audio on B's soundboard track carries the clip's energy.
    await expect
      .poll(
        async () => {
          const st = await getSoundboardInbound(a, b.identity);
          if (!st) return false;
          return st.totalAudioEnergy - beforeEnergy > 0.05 && st.bytesReceived - beforeBytes > 1_000;
        },
        { timeout: 15_000, message: `a clip ${b.name} played after the lifted mute carried no signal to ${a.name}` },
      )
      .toBe(true);
  });
});
