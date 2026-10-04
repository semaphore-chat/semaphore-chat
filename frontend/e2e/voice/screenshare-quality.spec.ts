/**
 * Screen-share QUALITY, end to end against real LiveKit.
 *
 * Before this, every screen share went out at livekit-client's default
 * `screenShareEncoding` (h1080fps15: 2.5 Mbps, 15 fps) whatever the user
 * picked. This proves, on the real publish path (publishScreenShare via the
 * __lkSetScreenShare test hook) and a real SFU:
 *   - the top simulcast layer is negotiated at the chosen frame rate (60) and
 *     a bitrate above the old 2.5 Mbps cap, with lower layers under it;
 *   - a grid tile requests (and gets) less than the full capture
 *     (adaptiveStream), while a focused (spotlight) share REQUESTS the
 *     full-size top layer, even in a view smaller than the share;
 *   - a constrained viewer (setVideoQuality LOW, what adaptiveStream / a weak
 *     downlink do) switches to the quarter-size layer instead of stalling, and
 *     dynacast turns that layer on for it; lifting the cap requests the full
 *     size again.
 *
 * Hard vs soft: everything above is what OUR code controls and is asserted.
 * Whether the SFU actually FORWARDS the top layer (and the measured fps) also
 * depends on its bandwidth estimate for the subscriber ramping up to ~9 Mbps,
 * and on the CPU-bound fake capture; on a loaded runner that can take longer
 * than any fixed window. Those are soft checks: a miss after 45 s is recorded
 * as a `warning:` annotation (with the observed layer and stats), not a failure.
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
  getScreenShareRequest,
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

/** Record a value in the report and the log. */
function note(type: string, value: unknown): void {
  const description = typeof value === 'string' ? value : JSON.stringify(value);
  test.info().annotations.push({ type, description });
  process.stdout.write(`[screenshare-quality] ${type}: ${description}\n`);
}

/** A non-failing check: recorded as a warning annotation. */
function warn(type: string, value: unknown): void {
  note(`warning: ${type}`, value);
}

/** Polls `check` until true or `timeoutMs`; never throws on timeout. */
async function softPoll(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  try {
    await expect.poll(check, { timeout: timeoutMs }).toBe(true);
    return true;
  } catch {
    return false;
  }
}

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
    note('sender', sender);
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

    // --- In a grid tile, adaptiveStream sizes the request to the element:
    // the viewer asks for (and so gets) less than the full capture.
    const captureWidth = sender.captureSettings!.width!;
    const captureHeight = sender.captureSettings!.height!;
    await expect
      .poll(async () => (await getScreenShareRequest(viewer, sharer.identity))?.requestedWidth ?? 0, {
        timeout: 15_000,
        message: 'a grid tile should request less than the full capture',
      })
      .toBeGreaterThan(0);
    const gridRequest = await getScreenShareRequest(viewer, sharer.identity);
    note('grid request', gridRequest);
    expect(gridRequest?.pixelDensity).toBeUndefined();
    expect(gridRequest?.requestedWidth ?? 0).toBeLessThan(captureWidth);
    await expect
      .poll(async () => (await getInboundVideoStats(viewer, sharer.identity))?.frameWidth ?? 0, {
        timeout: 20_000,
        message: 'a grid tile should receive a lower layer than the full capture',
      })
      .toBeLessThan(captureWidth);

    // --- Focused (spotlight). HARD: the viewer REQUESTS the top layer, i.e. a
    // size at or above the capture. The 1280x720 browser window is smaller
    // than the 1920x1080 share, so without the focus boost
    // (screenShareViewQuality.ts) the request would be the spotlight
    // element's size and the SFU would pick the half-size layer.
    await viewer.page.locator('video').first().click();
    await expect
      .poll(async () => (await getScreenShareRequest(viewer, sharer.identity))?.pixelDensity, {
        timeout: 10_000,
        message: 'focus boost never applied to the spotlighted share',
      })
      .toBe(4);
    await expect
      .poll(
        async () => {
          const r = await getScreenShareRequest(viewer, sharer.identity);
          return (r?.requestedWidth ?? 0) >= captureWidth && (r?.requestedHeight ?? 0) >= captureHeight;
        },
        { timeout: 10_000, message: 'focused viewer does not request the full-size top layer' },
      )
      .toBe(true);
    note('focused request', await getScreenShareRequest(viewer, sharer.identity));

    // SOFT: actually RECEIVING the 9 Mbps top layer also needs the SFU's
    // bandwidth estimate for this subscriber to ramp up to it, which on a
    // loaded CI runner can take longer than any fixed window. That is LiveKit
    // congestion control, not our code: record what arrived instead of failing.
    const gotTop = await softPoll(
      async () => (await getInboundVideoStats(viewer, sharer.identity))?.frameWidth === captureWidth,
      45_000,
    );
    const focused = await getInboundVideoStats(viewer, sharer.identity);
    note('focused inbound', focused);
    if (!gotTop) {
      warn(
        'top layer not received within 45s (bandwidth estimate still ramping)',
        { inbound: focused, sender: await getScreenShareSender(sharer) },
      );
      return;
    }

    // --- Measured frame rate (soft as well). Headless Chromium's fake screen
    // capture is CPU-bound: alone it delivers ~20-26 fps, under the full
    // suite's load ~12-14. The negotiated maxFramerate 60 above is the
    // deterministic check.
    const measured = await getScreenShareSender(sharer);
    note('focused sender', measured);
    const sourceFps = measured.sourceFramesPerSecond ?? 0;
    if (sourceFps <= OLD_CAP_FPS + 5) {
      warn('fps not observable', `fake capture delivered ${sourceFps} fps; asserted negotiated maxFramerate only`);
      return;
    }
    const fastEnough = await softPoll(
      async () => ((await getInboundVideoStats(viewer, sharer.identity))?.framesPerSecond ?? 0) > OLD_CAP_FPS,
      20_000,
    );
    if (!fastEnough) {
      warn(`viewer did not receive above ${OLD_CAP_FPS} fps`, await getInboundVideoStats(viewer, sharer.identity));
    }
  });

  test('a constrained viewer gets a lower layer instead of stalling, then the top one again', async () => {
    const sender = await getScreenShareSender(sharer);
    test.skip(!sender.published, 'No screen share published (capture unavailable).');
    const captureWidth = sender.captureSettings!.width!;

    expect(await setScreenShareQuality(viewer, sharer.identity, 'low')).toBe(true);
    expect((await getScreenShareRequest(viewer, sharer.identity))?.requestedQuality).toBe(0);

    // Dynacast turns the low layer on for this subscriber...
    await expect
      .poll(
        async () => {
          const s = await getScreenShareSender(sharer);
          return s.encodings[0]?.active ?? false;
        },
        { timeout: 20_000, message: 'the lowest layer was not active for the LOW subscriber' },
      )
      .toBe(true);

    // ...and the viewer switches to it: smaller frames, still flowing.
    await expect
      .poll(async () => (await getInboundVideoStats(viewer, sharer.identity))?.frameWidth ?? 0, {
        timeout: 20_000,
        message: 'constrained viewer never switched to the low (quarter-size) layer',
      })
      .toBeLessThanOrEqual(Math.ceil(captureWidth / 4));
    await waitForVideoFlow(viewer, sharer, 'screenshare');
    const low = await getInboundVideoStats(viewer, sharer.identity);
    note('LOW inbound', low);

    // Back to HIGH: the request covers the full size again (hard); receiving
    // it again depends on the bandwidth estimate (soft).
    await setScreenShareQuality(viewer, sharer.identity, 'high');
    await expect
      .poll(async () => (await getScreenShareRequest(viewer, sharer.identity))?.requestedQuality, {
        timeout: 10_000,
        message: 'viewer did not lift its quality cap',
      })
      .toBe(2);
    expect((await getScreenShareRequest(viewer, sharer.identity))?.requestedWidth ?? 0).toBeGreaterThanOrEqual(
      captureWidth,
    );
    const backOnTop = await softPoll(
      async () => (await getInboundVideoStats(viewer, sharer.identity))?.frameWidth === captureWidth,
      45_000,
    );
    if (!backOnTop) {
      warn('top layer not received again within 45s (bandwidth estimate)', {
        inbound: await getInboundVideoStats(viewer, sharer.identity),
      });
    }

    await stopScreenShare(sharer);
  });
});
