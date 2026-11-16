/**
 * PR #351 validation — live audio device switching (#346).
 *
 * The fix wires Settings → Voice & Video's mic <Select> through
 * `onDeviceChange` → `switchAudioInputDevice` → `room.switchActiveDevice(
 * 'audioinput', deviceId)`, so changing the input device swaps the ACTIVE
 * LiveKit capture track live, with NO rejoin.
 *
 * This spec asserts that LiveKit behaviour directly against a real server via the
 * `__lkSwitchMic` hook (which calls the exact same `room.switchActiveDevice` the
 * UI path ends in). It deliberately does NOT drive the Settings DOM:
 *   - the form wiring (onDeviceChange → switchAudioInputDevice) is covered by
 *     unit tests `VoiceSettings.test.tsx` / `AudioVideoSettingsPanel.test.tsx`;
 *   - the lazy `/settings` route does not render reliably under this headless
 *     e2e harness, and the *valuable* part an E2E adds over the unit test is
 *     proving the live track actually swaps against real LiveKit without
 *     dropping the connection — which is exactly what this does.
 *
 * #347 (input-sensitivity threshold persistence) is a pure client-side
 * localStorage behaviour with no LiveKit interaction; it is fully covered by the
 * `AudioVideoSettingsPanel.test.tsx` unit test and is intentionally not
 * duplicated here.
 *
 * Requires the real-LiveKit stack: scripts/run-voice-e2e.sh
 */
import { test, expect } from '@playwright/test';
import {
  launchParticipant,
  joinVoiceChannel,
  closeParticipant,
  listAudioInputs,
  getLocalMicDeviceId,
  switchMic,
  TEST_USER,
  type Participant,
} from '../fixtures/voice.fixture';

test.describe.configure({ mode: 'serial' });

test.describe('PR #351 — live mic device switching', () => {
  let p: Participant;

  test.beforeAll(async () => {
    p = await launchParticipant(TEST_USER, 'sample-a.wav');
    await joinVoiceChannel(p, 'voice-chat');
    // joinVoiceChannel returns once the Room is `connected`; the app's join then enables the mic and applies the
    // saved device preferences (switchActiveDevice('audioinput', 'default')). A switch made before that is undone by
    // it (seen 2026-11-16: the test switched at +40 ms, the join re-applied 'default' at +80 ms). Wait for the join
    // to finish: the bar says "Voice Connected" only then, and the mic is published.
    await expect(p.page.getByText('Voice Connected', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => getLocalMicDeviceId(p), { timeout: 15_000, message: 'the mic was never published' })
      .not.toBeNull();
  });

  test.afterAll(async () => {
    if (p) await closeParticipant(p);
  });

  test('#346: switching the mic swaps the live capture track without rejoining', async () => {
    // Need ≥2 distinct real inputs to switch BETWEEN. The fake-media stack
    // exposes "Fake Audio Input 1/2" (+ default); if a given env only has one,
    // skip with a reason rather than fail (the wiring is unit-tested).
    const inputs = await listAudioInputs(p);
    const distinct = inputs.filter((d) => d.deviceId && d.deviceId !== 'default');
    test.skip(
      distinct.length < 2,
      `Need >=2 distinct audio inputs to switch between; this env has ` +
        `${distinct.length}. (Wiring is covered by AudioVideoSettingsPanel.test.tsx.)`,
    );

    const before = await getLocalMicDeviceId(p);
    const target = distinct.find((d) => d.deviceId !== before) ?? distinct[0];

    await switchMic(p, target.deviceId);

    // The room stays connected — switched live, no rejoin.
    expect(await p.page.evaluate(() => window.__lkRoom?.state ?? 'none')).toBe('connected');

    // The active capture track's deviceId reflects the switch.
    await expect
      .poll(() => getLocalMicDeviceId(p), {
        timeout: 10_000,
        message: 'live mic deviceId did not change after switchActiveDevice',
      })
      .toBe(target.deviceId);
  });
});
