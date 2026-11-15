/**
 * A call survives every layout change: resizing the window across the 1200 px
 * (desktop / tablet), 768 px (tablet / phone) and 600 px breakpoints swaps the
 * layout component, but must not touch the call. Asserted against real
 * LiveKit:
 *
 *   - the same Room object (a tag set on window.__lkRoom survives),
 *   - no new getUserMedia call (the microphone is not requested again),
 *   - the same <audio> element (remote audio is never detached and re-created),
 *   - audio keeps flowing both ways.
 *
 * Before the voice session layer (Layout.tsx → VoiceSessionLayer), each layout
 * mounted its own AudioRenderer, so every breakpoint re-created the audio
 * elements and restarted the call's behaviour.
 *
 * Requires the real-LiveKit stack: scripts/run-voice-e2e.sh layout-resize
 */
import { test, expect } from '@playwright/test';
import {
  launchParticipant,
  joinVoiceChannel,
  closeParticipant,
  waitForAudioFlow,
  TEST_USER,
  TEST_USER_2,
  type Participant,
} from '../fixtures/voice.fixture';

test.describe.configure({ mode: 'serial' });

const CH = 'voice-chat';
const HEIGHT = 900;

declare global {
  interface Window {
    __gumCount?: number;
    __probeAudios?: HTMLAudioElement[];
  }
}

/** Counts getUserMedia calls on this page (a probe for the test only). */
function countGetUserMedia() {
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) return;
  const original = md.getUserMedia.bind(md);
  window.__gumCount = 0;
  md.getUserMedia = (constraints?: MediaStreamConstraints) => {
    window.__gumCount = (window.__gumCount ?? 0) + 1;
    return original(constraints);
  };
}

/** Which layout is on screen: the desktop one has the shortcut announcer, the phone one the voice-bar slot. */
async function currentLayout(p: Participant): Promise<'desktop' | 'tablet' | 'phone'> {
  return p.page.evaluate(() => {
    if (document.querySelector('[data-testid="mobile-voice-bar-slot"]')) return 'phone';
    if (document.querySelector('[data-testid="shortcut-announcer"]')) return 'desktop';
    return 'tablet';
  });
}

test.describe('Layout changes mid-call', () => {
  let a: Participant;
  let b: Participant;

  test.afterEach(async () => {
    await Promise.all([a, b].filter(Boolean).map((p) => closeParticipant(p).catch(() => {})));
    a = b = undefined as unknown as Participant;
  });

  test('resizing across 1200, 768 and 600 px keeps the Room, the mic and the audio element', async () => {
    a = await launchParticipant(TEST_USER, 'sample-a.wav');
    b = await launchParticipant(TEST_USER_2, 'sample-b.wav');
    await a.page.setViewportSize({ width: 1440, height: HEIGHT });
    await a.page.addInitScript(countGetUserMedia);

    await joinVoiceChannel(a, CH);
    await joinVoiceChannel(b, CH);
    await waitForAudioFlow(a, b);
    await waitForAudioFlow(b, a);
    expect(await currentLayout(a)).toBe('desktop');

    // Tag what must survive: the Room object, the remote audio element.
    await expect
      .poll(() => a.page.evaluate(() => document.querySelectorAll('audio').length), {
        timeout: 15_000,
        message: 'A never rendered an <audio> element for B',
      })
      .toBeGreaterThan(0);
    const before = await a.page.evaluate(() => {
      (window.__lkRoom as unknown as Record<string, unknown>).__probe = 'layout-resize';
      window.__probeAudios = Array.from(document.querySelectorAll('audio'));
      return {
        gum: window.__gumCount ?? -1,
        audioCount: window.__probeAudios.length,
      };
    });
    expect(before.gum).toBeGreaterThan(0);

    for (const [width, layout] of [
      [1000, 'tablet'], // crosses 1200
      [700, 'phone'], // crosses 768
      [390, 'phone'], // crosses 600 (the same layout today; the new design's phone range starts here)
      [1440, 'desktop'], // all the way back
    ] as const) {
      await a.page.setViewportSize({ width, height: HEIGHT });
      await expect.poll(() => currentLayout(a), { message: `layout at ${width}px` }).toBe(layout);

      const now = await a.page.evaluate(() => ({
        probe: (window.__lkRoom as unknown as Record<string, unknown> | null)?.__probe ?? null,
        state: window.__lkRoom?.state ?? 'none',
        gum: window.__gumCount ?? -1,
        audioCount: document.querySelectorAll('audio').length,
        // Every <audio> element is the one tagged before the first resize, still in the page.
        sameAudio: (() => {
          const now = Array.from(document.querySelectorAll('audio'));
          const tagged = window.__probeAudios ?? [];
          return tagged.length > 0 && now.length === tagged.length && now.every((el, i) => el === tagged[i] && el.isConnected);
        })(),
        // And none of them stopped playing.
        anyPaused: Array.from(document.querySelectorAll('audio')).some((el) => el.paused),
      }));
      expect(now, `at ${width}px`).toEqual({
        probe: 'layout-resize',
        state: 'connected',
        gum: before.gum,
        audioCount: before.audioCount,
        sameAudio: true,
        anyPaused: false,
      });

      await waitForAudioFlow(a, b);
      await waitForAudioFlow(b, a);
    }
  });

  test('a touch hold-to-talk held while the layout changes ends with the mic off', async () => {
    a = await launchParticipant(TEST_USER, 'sample-a.wav');
    b = await launchParticipant(TEST_USER_2, 'sample-b.wav');
    await a.page.setViewportSize({ width: 1440, height: HEIGHT });
    // Push-to-talk mode: below 768 px the mic button becomes "Hold to talk".
    await a.page.evaluate(() =>
      localStorage.setItem(
        'semaphore_voice_settings',
        JSON.stringify({ inputMode: 'push_to_talk', pushToTalkKey: 'Backquote', pushToTalkKeyDisplay: '`' }),
      ),
    );
    await joinVoiceChannel(a, CH);
    await joinVoiceChannel(b, CH);

    const micOn = () => a.page.evaluate(() => window.__lkRoom?.localParticipant.isMicrophoneEnabled ?? null);
    await expect.poll(micOn, { message: 'PTT starts with the mic off' }).toBe(false);

    // Phone layout: hold the mic button down.
    await a.page.setViewportSize({ width: 390, height: HEIGHT });
    const hold = a.page.getByRole('button', { name: 'Hold to talk' }).first();
    await expect(hold).toBeVisible();
    const box = (await hold.boundingBox())!;
    await a.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await a.page.mouse.down();
    await expect.poll(micOn, { message: 'holding transmits' }).toBe(true);
    await waitForAudioFlow(b, a);

    // The layout changes under the finger: that bar (and the button holding the
    // pointer capture) leaves the page, so its pointerup never comes. The mic
    // must still end off, not stay live with nothing held.
    await a.page.setViewportSize({ width: 1440, height: HEIGHT });
    await expect.poll(() => currentLayout(a)).toBe('desktop');
    await expect.poll(micOn, { message: 'the mic is released when the holding bar goes away' }).toBe(false);
    await a.page.mouse.up();
    expect(await micOn()).toBe(false);
    expect(await a.page.evaluate(() => window.__lkRoom?.state)).toBe('connected');
  });
});
