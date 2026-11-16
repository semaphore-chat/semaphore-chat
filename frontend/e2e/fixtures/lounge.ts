/**
 * Helpers for the Lounge (new design shell) specs: `lounge-pieces.spec.ts`, `voice/lounge-pieces.spec.ts` and
 * `voice/shell-switch.spec.ts`.
 *
 * The Lounge's hidden community fixture is `/__lounge/community/:communityId`: every piece of the shell on real
 * data (dock, left island with the user card, members, call slot, banners) around a placeholder centre. It is
 * reached only with the new design on (`?design=lounge` for one tab, or the account setting).
 */
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { API_BASE, TEST_USER, loginViaApi } from './auth.fixture';
import { createTestChannel, createTestCommunity, generateTestName } from './test-data';
import { waitForRemoteAudioElements, type Participant } from './voice.fixture';

declare global {
  interface Window {
    __gumCount?: number;
    __probeAudios?: HTMLAudioElement[];
  }
}

/**
 * Requests that would mean the new shell or the kit fonts loaded: its modules (dev server) or chunks
 * (build), the kit, or the kit's font families. Not shell/loungeRootChunk.ts: that two-line loader is
 * eager by design (in a build it is part of the entry chunk).
 */
export const NEW_SHELL_REQUEST = /\/src\/shell\/lounge\/|\/assets\/(LoungeRoot|MarkerScreen|kit)-|\/src\/kit\/|bricolage|figtree/i;

/** Counts getUserMedia calls on this page (a probe for the test only). Pass to `addInitScript`. */
export function countGetUserMedia(): void {
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) return;
  const original = md.getUserMedia.bind(md);
  window.__gumCount = 0;
  md.getUserMedia = (constraints?: MediaStreamConstraints) => {
    window.__gumCount = (window.__gumCount ?? 0) + 1;
    return original(constraints);
  };
}

/** An in-app navigation (the hash router): never a page load. */
export async function goTo(page: Page, hashPath: string): Promise<void> {
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, `#${hashPath}`);
}

/** Turns the account's new-design switch on or off through the API (for a participant). */
export async function setAccountNewDesign(p: Participant, on: boolean): Promise<void> {
  const res = await p.context.request.patch(`${API_BASE}/appearance-settings`, {
    headers: { Authorization: `Bearer ${p.accessToken}` },
    data: { newDesign: on },
  });
  if (!res.ok()) throw new Error(`PATCH appearance-settings: ${res.status()} ${await res.text()}`);
}

/**
 * Tags what must survive every step: the Room object and the remote <audio> elements, once `remote`'s mic and
 * soundboard tracks both have theirs (the soundboard one can land after audio flows). `remote` must have joined
 * through the classic bar: a Lounge-card joiner publishes no soundboard track yet (G3).
 */
export async function tagCall(p: Participant, remote: Participant): Promise<{ gum: number; audioCount: number }> {
  await waitForRemoteAudioElements(p, remote);
  return p.page.evaluate(() => {
    (window.__lkRoom as unknown as Record<string, unknown>).__probe = 'shell-switch';
    window.__probeAudios = Array.from(document.querySelectorAll('audio'));
    return { gum: window.__gumCount ?? -1, audioCount: window.__probeAudios.length };
  });
}

/** The call is the one tagged: same Room, connected, no new getUserMedia, the same <audio> elements, none paused. */
export async function expectCallUntouched(
  p: Participant,
  before: { gum: number; audioCount: number },
  step: string,
): Promise<void> {
  const now = await p.page.evaluate(() => ({
    probe: (window.__lkRoom as unknown as Record<string, unknown> | null)?.__probe ?? null,
    state: window.__lkRoom?.state ?? 'none',
    gum: window.__gumCount ?? -1,
    audioCount: document.querySelectorAll('audio').length,
    sameAudio: (() => {
      const current = Array.from(document.querySelectorAll('audio'));
      const tagged = window.__probeAudios ?? [];
      return tagged.length > 0 && current.length === tagged.length && current.every((el, i) => el === tagged[i] && el.isConnected);
    })(),
    anyPaused: Array.from(document.querySelectorAll('audio')).some((el) => el.paused),
  }));
  expect(now, step).toEqual({
    probe: 'shell-switch',
    state: 'connected',
    gum: before.gum,
    audioCount: before.audioCount,
    sameAudio: true,
    anyPaused: false,
  });
}

/** The fixture's path for one community (the hash route). */
export const fixturePath = (communityId: string) => `/__lounge/community/${communityId}`;

/**
 * Opens the community fixture with the new design on for this tab (the `?design=lounge` preview) and waits for
 * the shell and the community's header. The `?design=` parameter is removed by a `replace` navigation, so the URL
 * is not asserted here. `page.goto`: a page load (use `goTo` to keep a running call).
 */
export async function openFixture(page: Page, communityId: string, opts: { communityName?: string } = {}): Promise<void> {
  await page.goto(`/#${fixturePath(communityId)}?design=lounge`);
  await expect(page.locator('[data-shell="lounge"]')).toBeAttached({ timeout: 20_000 });
  if (opts.communityName) {
    await expect(
      page.locator('[data-shell="lounge"]').getByRole('heading', { name: opts.communityName, level: 2 }),
    ).toBeVisible({ timeout: 20_000 });
  }
}

/**
 * Clicks "Join <room>" on the room card of a participant who is already on the fixture, waits for the real Room
 * to be connected and fills `identity` and `channelId` from it as `joinVoiceChannel` does (never from the URL: a
 * card join does not change it).
 */
export async function joinFromRoomCard(p: Participant, room: string): Promise<void> {
  await p.page.getByRole('button', { name: `Join ${room}`, exact: true }).click();
  await expect
    .poll(() => p.page.evaluate(() => window.__lkRoom?.state ?? 'none'), {
      timeout: 30_000,
      message: `${p.name} never reached connected state from the ${room} card`,
    })
    .toBe('connected');
  p.identity = await p.page.evaluate(() => window.__lkRoom!.localParticipant.identity);
  await expect
    .poll(() => p.page.evaluate(() => window.__lkRoom?.name ?? ''), {
      timeout: 10_000,
      message: `${p.name} channelId never resolved after the card join`,
    })
    .toBeTruthy();
  p.channelId = await p.page.evaluate(() => window.__lkRoom?.name ?? '');
}

/** A user registered through the API with the seeded invite code. Never online before this call. */
export interface FreshUser {
  username: string;
  password: string;
  id: string;
  token: string;
}

export const INVITE_CODE = 'test-invite';

export async function registerFreshUser(request: APIRequestContext): Promise<FreshUser> {
  const username = `lng${Math.random().toString(36).slice(2, 10)}`;
  const password = 'Lounge123!@#';
  // POST /users is the registration endpoint (`registerViaApi` posts to /auth/register, which does not exist).
  const created = await request.post(`${API_BASE}/users`, {
    data: { username, password, email: `${username}@test.local`, code: INVITE_CODE },
  });
  if (!created.ok()) throw new Error(`Registration failed: ${created.status()} ${await created.text()}`);
  const { accessToken } = await loginViaApi(request, { username, password });
  const profile = await request.get(`${API_BASE}/users/profile`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!profile.ok()) throw new Error(`GET /users/profile: ${profile.status()} ${await profile.text()}`);
  return { username, password, id: (await profile.json()).id as string, token: accessToken };
}

export interface LoungeCommunity {
  id: string;
  name: string;
  lobbyId: string;
  hangoutId: string;
  /** Only C1 has a private channel. */
  staffId?: string;
}

export interface LoungeWorld {
  /** The seeded `testuser`, an instance OWNER. */
  owner: { token: string; id: string };
  /** A fresh, never-online plain member of both communities, in no private channel. */
  member: FreshUser;
  c1: LoungeCommunity;
  c2: LoungeCommunity;
}

/**
 * Two communities C1 and C2 (owner `testuser`), each with a text channel `lobby` and a voice room `hangout`; C1 also
 * has a private text channel `staff`. A fresh user N is added to both as a plain member (an instance OWNER sees every
 * channel, so it cannot be the private-channel check).
 */
export async function loungeWorld(request: APIRequestContext): Promise<LoungeWorld> {
  const { accessToken: ownerToken } = await loginViaApi(request, TEST_USER);
  const ownerProfile = await request.get(`${API_BASE}/users/profile`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  if (!ownerProfile.ok()) throw new Error(`GET /users/profile: ${ownerProfile.status()}`);
  const ownerId = (await ownerProfile.json()).id as string;
  const member = await registerFreshUser(request);

  const build = async (withStaff: boolean): Promise<LoungeCommunity> => {
    const name = generateTestName('lng');
    const community = await createTestCommunity(request, { name }, ownerToken);
    const lobby = await createTestChannel(request, community.id, { name: 'lobby' }, ownerToken);
    const hangout = await createTestChannel(request, community.id, { name: 'hangout', type: 'VOICE' }, ownerToken);
    const staff = withStaff
      ? await createTestChannel(request, community.id, { name: 'staff', isPrivate: true }, ownerToken)
      : undefined;
    const join = await request.post(`${API_BASE}/membership`, {
      data: { userId: member.id, communityId: community.id },
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    if (!join.ok()) throw new Error(`Adding member failed: ${join.status()} ${await join.text()}`);
    return { id: community.id, name, lobbyId: lobby.id, hangoutId: hangout.id, staffId: staff?.id };
  };

  const c1 = await build(true);
  const c2 = await build(false);
  return { owner: { token: ownerToken, id: ownerId }, member, c1, c2 };
}
