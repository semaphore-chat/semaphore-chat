/**
 * A call survives the shell switch: going to the new design's marker screen
 * (/__lounge) and back, through a preview link or the account switch, and
 * resizing while there, must not touch the call. And on the marker, where the
 * old voice bar is not mounted, the call's behaviour still runs: deafen, a
 * moderator's mute, push-to-talk and the presence heartbeat. Against real
 * LiveKit:
 *
 *   1. preview link to the marker: same Room, no new getUserMedia, same
 *      <audio> elements playing, audio both ways;
 *   2. "Back to the app": the old shell's voice bar is back;
 *   3. the account switch at /debug/design mid-call, then resizing across
 *      1200, 768 and 600 px on the marker: audio keeps flowing;
 *   4. deafened on the marker, a newcomer is not heard;
 *   5. muted by a moderator on the marker, the mic stays off;
 *   6. push-to-talk works on the marker;
 *   7. 100 s on the marker: still listed in voice presence (TTL 90 s) (@slow);
 *   8. the new shell's chunk fails to load (offline, or gone after a deploy): its error page offers
 *      a way back that keeps the call, and Try again loads it once the network is back.
 *
 * Requires the real-LiveKit stack: scripts/run-voice-e2e.sh shell-switch
 */
import { test, expect, type Page } from '@playwright/test';
import {
  launchParticipant,
  joinVoiceChannel,
  closeParticipant,
  waitForAudioFlow,
  expectNoAudioGrowth,
  moderatorMute,
  setMicEnabled,
  ADMIN_USER,
  TEST_USER,
  TEST_USER_2,
  type Participant,
} from '../fixtures/voice.fixture';
import { API_BASE } from '../fixtures/auth.fixture';
import { goTo, countGetUserMedia, tagCall, expectCallUntouched, setAccountNewDesign } from '../fixtures/lounge';

test.describe.configure({ mode: 'serial' });

const CH = 'voice-chat';
const HEIGHT = 900;
const POLL = { timeout: 15_000 };

const marker = (page: Page) => page.getByRole('heading', { name: 'New design preview' });
const voiceBar = (page: Page) => page.getByTestId('voice-bar-controls');
const micOn = (p: Participant) =>
  p.page.evaluate(
    () => (window.__lkRoom?.localParticipant as unknown as { isMicrophoneEnabled?: boolean } | undefined)?.isMicrophoneEnabled ?? null,
  );

test.describe('The call across the shell switch', () => {
  let a: Participant;
  let b: Participant;
  let c: Participant;

  test.afterEach(async () => {
    if (a) await setAccountNewDesign(a, false).catch(() => {});
    await Promise.all([a, b, c].filter(Boolean).map((p) => closeParticipant(p).catch(() => {})));
    a = b = c = undefined as unknown as Participant;
  });

  test('steps 1-3: to the marker and back, the account switch and resizing keep the Room, the mic and the audio', async () => {
    test.setTimeout(240_000);
    a = await launchParticipant(TEST_USER, 'sample-a.wav');
    b = await launchParticipant(TEST_USER_2, 'sample-b.wav');
    await a.page.setViewportSize({ width: 1440, height: HEIGHT });
    await setAccountNewDesign(a, false);
    await a.page.addInitScript(countGetUserMedia);

    await joinVoiceChannel(a, CH);
    await joinVoiceChannel(b, CH);
    await waitForAudioFlow(a, b);
    await waitForAudioFlow(b, a);
    const before = await tagCall(a, b);
    expect(before.gum).toBeGreaterThan(0);

    // 1. The preview link, in the middle of the call.
    await goTo(a.page, '/__lounge?design=lounge');
    await expect(marker(a.page)).toBeVisible();
    await expect(a.page.getByTestId('lounge-voice-line')).toHaveText(`In a call in ${CH}`);
    await expect(a.page).toHaveURL(/#\/__lounge$/);
    await expect(voiceBar(a.page)).toHaveCount(0);
    await expectCallUntouched(a, before, 'on the marker');
    await waitForAudioFlow(a, b);
    await waitForAudioFlow(b, a);

    // 2. Back to the app: the old shell and its voice bar.
    await a.page.getByRole('button', { name: 'Back to the app' }).click();
    await expect(voiceBar(a.page)).toBeVisible();
    await expectCallUntouched(a, before, 'back in the old shell');

    // 3. The account switch at /debug/design (inside the shell), mid-call.
    await goTo(a.page, '/__lounge?design=reset');
    await expect(a.page.getByText('Page not found')).toBeVisible();
    await goTo(a.page, '/debug/design');
    const toggle = a.page.getByLabel('New design (saved to your account)');
    await toggle.check();
    await expect(toggle).toBeChecked();
    await expectCallUntouched(a, before, 'after the account switch');
    await goTo(a.page, '/__lounge');
    await expect(marker(a.page)).toBeVisible();
    await expectCallUntouched(a, before, 'on the marker by the account setting');

    for (const width of [1000, 700, 390, 1440]) {
      await a.page.setViewportSize({ width, height: HEIGHT });
      await expect(marker(a.page)).toBeVisible();
      await expectCallUntouched(a, before, `marker at ${width}px`);
      await waitForAudioFlow(a, b);
      await waitForAudioFlow(b, a);
    }

    // Off again through the same switch: the old shell, the same call.
    await goTo(a.page, '/debug/design');
    await toggle.uncheck();
    await expect(toggle).not.toBeChecked();
    await goTo(a.page, '/');
    await expect(voiceBar(a.page)).toBeVisible();
    await expectCallUntouched(a, before, 'switched off');
    await waitForAudioFlow(a, b);
  });

  test('steps 4-5: on the marker, deafen silences a newcomer and a moderator mute holds', async () => {
    test.setTimeout(240_000);
    a = await launchParticipant(TEST_USER, 'sample-a.wav');
    b = await launchParticipant(TEST_USER_2, 'sample-b.wav');
    await a.page.setViewportSize({ width: 1440, height: HEIGHT });
    await joinVoiceChannel(a, CH);
    await joinVoiceChannel(b, CH);
    await waitForAudioFlow(b, a);

    // 4. A deafens in the old shell, goes to the marker, then C joins.
    const deafen = voiceBar(a.page).getByRole('button', { name: 'Deafen', exact: true });
    await deafen.click();
    await expect(deafen).toHaveAttribute('aria-pressed', 'true', POLL);
    await goTo(a.page, '/__lounge?design=lounge');
    await expect(marker(a.page)).toBeVisible();

    c = await launchParticipant(ADMIN_USER, 'sample-c.wav');
    await joinVoiceChannel(c, CH);
    await expect.poll(() => a.page.evaluate(() => window.__lkRoom?.remoteParticipants.size ?? 0), POLL).toBe(2);
    // Deafen plays everyone at volume 0 (the media still arrives): C's track, which
    // arrived while the old bar was not mounted, must be silenced too.
    const playedVolumeOfC = () =>
      a.page.evaluate((identity) => {
        type Publication = { source: string; track?: unknown };
        const participant = window.__lkRoom?.remoteParticipants.get(identity) as
          | { audioTrackPublications: Map<string, Publication> }
          | undefined;
        const publication = participant && [...participant.audioTrackPublications.values()].find((p) => p.source === 'microphone');
        const track = publication?.track as unknown as { getVolume?: () => number | undefined; attachedElements?: HTMLMediaElement[] } | undefined;
        if (!track) return null;
        return track.getVolume?.() ?? track.attachedElements?.[0]?.volume ?? null;
      }, c.identity);
    await expect.poll(playedVolumeOfC, { ...POLL, message: 'C is played at volume 0 while A is deafened' }).toBe(0);
    expect(await micOn(a)).toBe(false);

    // Undeafen in the old shell, with the mic on.
    await a.page.getByRole('button', { name: 'Back to the app' }).click();
    await deafen.click();
    await expect(deafen).toHaveAttribute('aria-pressed', 'false', POLL);
    if (!(await micOn(a))) await setMicEnabled(a, true);
    await expect.poll(() => micOn(a), POLL).toBe(true);
    await waitForAudioFlow(b, a);

    // 5. On the marker, the moderator (C, an instance owner) mutes A.
    await goTo(a.page, '/__lounge?design=lounge');
    await expect(marker(a.page)).toBeVisible();
    await moderatorMute(c, a.identity, true, a.channelId);
    await expect.poll(() => micOn(a), { ...POLL, message: "the moderator's mute turns A's mic off" }).toBe(false);
    await expectNoAudioGrowth(b, a);
    // A cannot undo it while on the marker: the server mute is enforced with no bar mounted.
    await setMicEnabled(a, true).catch(() => {});
    await expectNoAudioGrowth(b, a);

    await moderatorMute(c, a.identity, false, a.channelId);
  });

  test('step 6: push-to-talk works on the marker', async () => {
    test.setTimeout(180_000);
    a = await launchParticipant(TEST_USER, 'sample-a.wav');
    b = await launchParticipant(TEST_USER_2, 'sample-b.wav');
    await a.page.setViewportSize({ width: 1440, height: HEIGHT });
    await a.page.evaluate(() =>
      localStorage.setItem(
        'semaphore_voice_settings',
        JSON.stringify({ inputMode: 'push_to_talk', pushToTalkKey: 'Backquote', pushToTalkKeyDisplay: '`' }),
      ),
    );
    await joinVoiceChannel(a, CH);
    await joinVoiceChannel(b, CH);
    await expect.poll(() => micOn(a), { ...POLL, message: 'PTT starts with the mic off' }).toBe(false);

    await goTo(a.page, '/__lounge?design=lounge');
    await expect(marker(a.page)).toBeVisible();
    await expect(voiceBar(a.page)).toHaveCount(0);

    await a.page.keyboard.down('Backquote');
    await expect.poll(() => micOn(a), { ...POLL, message: 'holding the key transmits' }).toBe(true);
    await waitForAudioFlow(b, a);
    await a.page.keyboard.up('Backquote');
    await expect.poll(() => micOn(a), { ...POLL, message: 'letting go stops' }).toBe(false);
  });

  test("step 8: the new shell's chunk fails to load: back to the current design keeps the call, Try again recovers", async () => {
    test.setTimeout(180_000);
    a = await launchParticipant(TEST_USER, 'sample-a.wav');
    b = await launchParticipant(TEST_USER_2, 'sample-b.wav');
    await a.page.setViewportSize({ width: 1440, height: HEIGHT });
    await setAccountNewDesign(a, false);
    await a.page.addInitScript(countGetUserMedia);
    await joinVoiceChannel(a, CH);
    await joinVoiceChannel(b, CH);
    await waitForAudioFlow(a, b);
    await waitForAudioFlow(b, a);
    const before = await tagCall(a, b);

    // The shell's module (dev server) or chunk (build) cannot be fetched.
    const chunk = /\/src\/shell\/lounge\/LoungeRoot\.tsx|\/assets\/LoungeRoot-[^/]*\.js/;
    // A 404, as for a chunk a deploy removed from under an open tab.
    await a.page.route(chunk, (route) => route.fulfill({ status: 404, body: 'Not found' }));

    await goTo(a.page, '/__lounge?design=lounge');
    await expect(a.page.getByText('The new design could not be shown')).toBeVisible();
    await expect(a.page.getByRole('button', { name: 'Reload' })).toHaveCount(0);
    await expectCallUntouched(a, before, 'on the error page');

    // Try again while still offline: the same page again, the call still untouched.
    await a.page.getByRole('button', { name: 'Try again' }).click();
    await expect(a.page.getByText('The new design could not be shown')).toBeVisible();

    await a.page.getByRole('button', { name: 'Back to the current design' }).click();
    await expect(voiceBar(a.page)).toBeVisible();
    await expectCallUntouched(a, before, 'back to the current design');
    await waitForAudioFlow(a, b);
    await waitForAudioFlow(b, a);

    // The network is back: the preview link loads the new shell.
    await a.page.unroute(chunk);
    await goTo(a.page, '/__lounge?design=lounge');
    await expect(marker(a.page)).toBeVisible();
    await expectCallUntouched(a, before, 'the new shell loaded after the failure');
    // The Room tag checked above lives on `window`: it would be gone after any page reload.
  });

  test('step 7: 100 s on the marker keeps A in voice presence @slow', async () => {
    test.slow();
    a = await launchParticipant(TEST_USER, 'sample-a.wav');
    b = await launchParticipant(TEST_USER_2, 'sample-b.wav');
    await a.page.setViewportSize({ width: 1440, height: HEIGHT });
    await joinVoiceChannel(a, CH);
    await joinVoiceChannel(b, CH);

    const presenceListsA = async () => {
      const res = await b.context.request.get(`${API_BASE}/channels/${a.channelId}/voice-presence`, {
        headers: { Authorization: `Bearer ${b.accessToken}` },
      });
      if (!res.ok()) throw new Error(`presence: ${res.status()} ${await res.text()}`);
      const body = (await res.json()) as { users: Array<{ id: string }> };
      return body.users.some((user) => user.id === a.identity);
    };
    await expect.poll(presenceListsA, POLL).toBe(true);

    await goTo(a.page, '/__lounge?design=lounge');
    await expect(marker(a.page)).toBeVisible();
    // The duration is what is under test: longer than the presence TTL (90 s), so
    // only the heartbeat (VoiceSessionEffects, no bar mounted) can keep A listed.
    await a.page.waitForTimeout(100_000);
    expect(await presenceListsA()).toBe(true);
    expect(await a.page.evaluate(() => window.__lkRoom?.state)).toBe('connected');
    await waitForAudioFlow(b, a);
  });
});
