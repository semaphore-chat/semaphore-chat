/**
 * Screen-share QUALITY, end to end against real LiveKit.
 *
 * Before this, every screen share went out at livekit-client's default
 * `screenShareEncoding` (h1080fps15: 2.5 Mbps, 15 fps) whatever the user
 * picked. This proves, on the real publish path (publishScreenShare via the
 * __lkSetScreenShare test hook) and a real SFU:
 *   - the top simulcast layer is negotiated at the chosen frame rate (60) and
 *     a bitrate above the old 2.5 Mbps cap, with lower layers under it;
 *   - the encoder actually sends the top layer above the old 15 fps cap;
 *   - a full-quality viewer receives the full capture size;
 *   - a constrained viewer (setVideoQuality LOW, what adaptiveStream / a weak
 *     downlink do) gets a LOWER layer instead of stalling, and dynacast turns
 *     the lower layer on for it; going back to HIGH restores the full size.
 *
 * Requires the real-LiveKit stack: scripts/run-voice-e2e.sh
 */
import { test, expect } from '@playwright/test';
import {
  launchParticipant,
  joinVoiceChannel,
  closeParticipant,
  startScreenShare,
  stopScreenShare,
  watchScreenShareOf,
  waitForVideoFlow,
  getInboundVideoStats,
  getScreenShareSender,
  setScreenShareQuality,
  getSubscriptionState,
  TEST_USER,
  TEST_USER_2,
  type Participant,
  type ScreenShareSenderStats,
} from '../fixtures/voice.fixture';

/** LiveKit's old default for every screen share: ScreenSharePresets.h1080fps15. */
const OLD_CAP_BITRATE = 2_500_000;
const OLD_CAP_FPS = 15;

test.describe.configure({ mode: 'serial' });

test.describe('Screen share quality over real LiveKit', () => {
  let sharer: Participant;
  let viewer: Participant;

  test.beforeAll(async () => {
    sharer = await launchParticipant(TEST_USER, 'sample-a.wav');
    viewer = await launchParticipant(TEST_USER_2, 'sample-b.wav');
    await joinVoiceChannel(sharer, 'voice-video');
    await joinVoiceChannel(viewer, 'voice-video');
  });

  test.afterAll(async () => {
    await Promise.all([sharer, viewer].filter(Boolean).map(closeParticipant));
  });

  test('1080p60: top layer at 60 fps above the old cap, lower layers for weak viewers', async () => {
    const started = await startScreenShare(sharer, { resolution: '1080p', fps: 60 });
    test.skip(!started, 'Headless Chromium screen capture is unavailable in this env.');

    await expect
      .poll(
        async () => (await getSubscriptionState(viewer, sharer.identity))?.screenShare.published ?? false,
        { timeout: 15_000, message: 'screenshare publication never propagated' },
      )
      .toBe(true);
    await watchScreenShareOf(viewer, sharer.identity);
    await waitForVideoFlow(viewer, sharer, 'screenshare');

    // --- Negotiated encodings (deterministic, independent of the fake source).
    const sender: ScreenShareSenderStats = await getScreenShareSender(sharer);
    test.info().annotations.push({ type: 'screenshare sender', description: JSON.stringify(sender) });
    process.stdout.write(`[screenshare-quality] sender: ${JSON.stringify(sender)}\n`);
    expect(sender.published).toBe(true);
    expect(sender.contentHint).toBe('motion');
    expect(sender.captureSettings?.width ?? 0).toBeGreaterThan(0);

    // Simulcast: more than one layer, ordered low → high.
    expect(sender.encodings.length).toBeGreaterThanOrEqual(2);
    const top = sender.encodings[sender.encodings.length - 1];
    const lower = sender.encodings.slice(0, -1);
    expect(top.maxFramerate).toBe(60);
    expect(top.maxBitrate ?? 0).toBeGreaterThan(OLD_CAP_BITRATE);
    expect(top.scaleResolutionDownBy ?? 1).toBe(1);
    for (const layer of lower) {
      // Only the top layer is uncapped: lower layers are smaller and cheaper.
      expect(layer.scaleResolutionDownBy ?? 1).toBeGreaterThan(1);
      expect(layer.maxBitrate ?? 0).toBeLessThan(top.maxBitrate ?? 0);
      expect(layer.maxFramerate ?? 0).toBeLessThanOrEqual(30);
    }

    // --- What is actually encoded: the top layer runs above the old 15 fps cap.
    await expect
      .poll(
        async () => {
          const s = await getScreenShareSender(sharer);
          const f = s.outbound.find((o) => o.rid === top.rid) ?? s.outbound[0];
          return f?.framesPerSecond ?? 0;
        },
        {
          timeout: 20_000,
          message: `top screen-share layer never exceeded the old ${OLD_CAP_FPS} fps cap`,
        },
      )
      .toBeGreaterThan(OLD_CAP_FPS);

    // --- A full-quality viewer receives the full capture size.
    const captureWidth = sender.captureSettings!.width!;
    await expect
      .poll(async () => (await getInboundVideoStats(viewer, sharer.identity))?.frameWidth ?? 0, {
        timeout: 20_000,
        message: 'viewer never received the top (full-size) layer',
      })
      .toBe(captureWidth);
    await expect
      .poll(async () => (await getInboundVideoStats(viewer, sharer.identity))?.framesPerSecond ?? 0, {
        timeout: 20_000,
        message: `viewer never received the share above ${OLD_CAP_FPS} fps`,
      })
      .toBeGreaterThan(OLD_CAP_FPS);
  });

  test('a constrained viewer gets a lower layer instead of stalling, then the top one again', async () => {
    const sender = await getScreenShareSender(sharer);
    test.skip(!sender.published, 'No screen share published (capture unavailable).');
    const captureWidth = sender.captureSettings!.width!;

    expect(await setScreenShareQuality(viewer, sharer.identity, 'low')).toBe(true);

    // Dynacast turns the low layer on for this subscriber...
    await expect
      .poll(
        async () => {
          const s = await getScreenShareSender(sharer);
          return s.encodings.filter((e) => e.active).length;
        },
        { timeout: 20_000, message: 'no lower layer became active for the LOW subscriber' },
      )
      .toBeGreaterThanOrEqual(1);

    // ...and the viewer switches to it: smaller frames, still flowing.
    await expect
      .poll(async () => (await getInboundVideoStats(viewer, sharer.identity))?.frameWidth ?? 0, {
        timeout: 20_000,
        message: 'constrained viewer never switched to a lower layer',
      })
      .toBeLessThan(captureWidth);
    await waitForVideoFlow(viewer, sharer, 'screenshare');
    const low = await getInboundVideoStats(viewer, sharer.identity);
    test.info().annotations.push({ type: 'LOW inbound', description: JSON.stringify(low) });
    process.stdout.write(`[screenshare-quality] LOW inbound: ${JSON.stringify(low)}\n`);

    // Back to HIGH: the full size returns.
    await setScreenShareQuality(viewer, sharer.identity, 'high');
    await expect
      .poll(async () => (await getInboundVideoStats(viewer, sharer.identity))?.frameWidth ?? 0, {
        timeout: 20_000,
        message: 'viewer never returned to the top layer',
      })
      .toBe(captureWidth);

    await stopScreenShare(sharer);
  });
});
