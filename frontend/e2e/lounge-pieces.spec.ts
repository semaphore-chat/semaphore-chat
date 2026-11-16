/**
 * The Lounge's pieces (dock, "All communities" sheet, community left island, members island, user card,
 * banners) on real data, through the hidden community fixture `/__lounge/community/:communityId`.
 *
 * Each test builds its own world (`loungeWorld`): two communities C1 and C2 owned by the seeded `testuser`,
 * and a fresh plain member N who has never been online (so presence is deterministic and N is in no private
 * channel). Assertions use roles and accessible names.
 *
 * Run: scripts/run-e2e.sh lounge-pieces
 */
import type { APIRequestContext, BrowserContext, Locator, Page, Request, Response, TestInfo } from '@playwright/test';
import { test, expect, TEST_USER, API_BASE, openSession, shot, sendSpans, sendTestMessage, createTestCommunity, generateTestName } from './fixtures';
import { loginViaApi } from './fixtures/auth.fixture';
import {
  NEW_SHELL_REQUEST,
  fixturePath,
  goTo,
  loungeWorld,
  openFixture,
  type FreshUser,
  type LoungeWorld,
} from './fixtures/lounge';

// Not serial: each test builds its own world, so one failure never skips the others.
test.describe.configure({ timeout: 120_000 });

/** Presence and list updates are socket-driven and eventual; CI is slower than a laptop. */
const EVENTUAL = { timeout: 20_000 };

const PHONE = { width: 390, height: 844 };
const COMPACT = { width: 820, height: 900 };
const WIDE = { width: 1440, height: 900 };

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const startsWith = (text: string) => new RegExp(`^${escapeRe(text)}`);

const dock = (page: Page) => page.getByRole('navigation', { name: 'Communities', exact: true });
const leftIsland = (page: Page) => page.getByRole('navigation', { name: 'Community', exact: true });
const membersIsland = (page: Page) => page.getByRole('complementary', { name: 'Members', exact: true });
const allSheet = (page: Page) => page.getByRole('dialog', { name: 'All communities', exact: true });
const communityLink = (scope: Locator, name: string) => scope.getByRole('link', { name: startsWith(name) });
const header = (page: Page, name: string) => page.getByRole('heading', { name, level: 2, exact: true });

interface Opened {
  context: BrowserContext;
  page: Page;
  /** The access token of this session's login (the session the app's sign-out revokes). */
  token: string;
}

/** N (or anyone) signed in a fresh context, on the fixture of `communityId`. */
async function sessionOnFixture(
  browser: Parameters<typeof openSession>[0],
  user: { username: string; password: string },
  viewport: { width: number; height: number },
  communityId: string,
  communityName?: string,
  opts: { onPage?: (page: Page) => void } = {},
): Promise<Opened> {
  const { context, page, token } = await openSession(browser, user, viewport);
  opts.onPage?.(page);
  await openFixture(page, communityId, { communityName });
  return { context, page, token };
}

/** The "N around" count of the left island's header. */
async function aroundCount(page: Page): Promise<number> {
  const text = await leftIsland(page).getByText(/^\d+ around$/).textContent();
  return Number.parseInt(text ?? '', 10);
}

test.describe('The Lounge pieces on the community fixture', () => {
  test("with the new design off the fixture is the old shell's Page not found, and nothing of the new shell loads", async ({
    browser,
    request,
  }, testInfo) => {
    const world = await loungeWorld(request);
    const { context, page } = await openSession(browser, world.member, WIDE);
    try {
      const urls: string[] = [];
      page.on('request', (req: Request) => urls.push(req.url()));
      await page.goto('/#/');
      await page.reload();
      await expect(page.getByTestId('shortcut-announcer')).toBeAttached(EVENTUAL);

      await page.goto(`/#${fixturePath(world.c1.id)}`);
      await expect(page.getByText('Page not found')).toBeVisible(EVENTUAL);
      await expect(page.getByTestId('shortcut-announcer')).toBeAttached();
      await expect(page.locator('[data-shell="lounge"]')).toHaveCount(0);
      await shot(page, testInfo, 'p1-fixture-is-not-found-with-the-design-off');

      expect(urls.length).toBeGreaterThan(0);
      expect(urls.filter((url) => NEW_SHELL_REQUEST.test(url))).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('the dock and the All sheet list your real communities, the current one marked', async ({ browser, request }, testInfo) => {
    const world = await loungeWorld(request);
    // The positive control of P1: opening the fixture with the design on does load what NEW_SHELL_REQUEST matches
    // (a renamed chunk or module path would otherwise let P1 pass without testing anything).
    const urls: string[] = [];
    const wide = await sessionOnFixture(browser, world.member, WIDE, world.c1.id, world.c1.name, {
      onPage: (page) => page.on('request', (req: Request) => urls.push(req.url())),
    });
    try {
      const { page } = wide;
      expect(urls.filter((url) => NEW_SHELL_REQUEST.test(url)).length, 'the fixture loads the new shell').toBeGreaterThan(0);
      const bar = dock(page);
      await expect(communityLink(bar, world.c1.name)).toBeVisible(EVENTUAL);
      await expect(communityLink(bar, world.c2.name)).toBeVisible();
      await expect(communityLink(bar, world.c1.name)).toHaveAttribute('aria-current', 'page');
      await expect(communityLink(bar, world.c2.name)).not.toHaveAttribute('aria-current', 'page');

      const all = bar.getByRole('button', { name: 'All communities', exact: true });
      await all.click();
      const sheet = allSheet(page);
      await expect(sheet).toBeVisible();
      await expect(communityLink(sheet, world.c1.name)).toHaveAttribute('aria-current', 'page');
      await expect(communityLink(sheet, world.c2.name)).toBeVisible();
      await expect(communityLink(sheet, world.c2.name)).not.toHaveAttribute('aria-current', 'page');
      // Wide has no user card, no foot of account rows in the sheet: those are the phone's.
      await expect(sheet.getByRole('button', { name: 'Sign out…' })).toHaveCount(0);
      await shot(page, testInfo, 'p2-all-sheet-wide');
      await page.keyboard.press('Escape');
      await expect(sheet).toHaveCount(0);
      await expect(all).toBeFocused();
    } finally {
      await wide.context.close();
    }

    const phone = await sessionOnFixture(browser, world.member, PHONE, world.c1.id, world.c1.name);
    try {
      const { page } = phone;
      const bar = dock(page);
      await expect(communityLink(bar, world.c1.name)).toHaveAttribute('aria-current', 'page', EVENTUAL);
      await expect(communityLink(bar, world.c2.name)).toBeVisible();
      await bar.getByRole('button', { name: 'All communities', exact: true }).click();
      const sheet = allSheet(page);
      await expect(sheet).toBeVisible();
      await expect(communityLink(sheet, world.c1.name)).toHaveAttribute('aria-current', 'page');
      await expect(communityLink(sheet, world.c2.name)).toBeVisible();
      await expect(sheet.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
      await expect(sheet.getByRole('link', { name: 'Your profile', exact: true })).toBeVisible();
      await expect(sheet.getByRole('button', { name: 'Sign out…', exact: true })).toBeVisible();
      await shot(page, testInfo, 'p2-all-sheet-phone');
    } finally {
      await phone.context.close();
    }
  });

  test("the left island shows the server's channels and rooms; a private channel stays hidden from a member; the community menu is the owner's only", async ({
    browser,
    request,
  }, testInfo) => {
    const world = await loungeWorld(request);
    const elsewhere = await createTestCommunity(request, { name: generateTestName('lng-away') }, world.owner.token);

    const member = await sessionOnFixture(browser, world.member, WIDE, world.c1.id, world.c1.name);
    const owner = await sessionOnFixture(browser, TEST_USER, WIDE, world.c1.id, world.c1.name);
    try {
      const left = leftIsland(member.page);
      await expect(left.getByRole('link', { name: startsWith('lobby') })).toBeVisible(EVENTUAL);
      await expect(left.getByRole('heading', { name: 'hangout', level: 3 })).toBeVisible();
      await expect(left.getByRole('link', { name: startsWith('staff') })).toHaveCount(0);
      await expect(left.getByText(/^\d+ around$/)).toBeVisible(EVENTUAL);
      expect(await aroundCount(member.page)).toBeGreaterThanOrEqual(1);
      await expect(member.page.getByRole('button', { name: `${world.c1.name}, community menu` })).toHaveCount(0);
      await shot(member.page, testInfo, 'p3-member-left-island');

      const ownerLeft = leftIsland(owner.page);
      await expect(ownerLeft.getByRole('link', { name: startsWith('staff') })).toBeVisible(EVENTUAL);
      await owner.page.getByRole('button', { name: `${world.c1.name}, community menu` }).click();
      await expect(owner.page.getByRole('menuitem', { name: 'Community settings' })).toBeVisible();
      await shot(owner.page, testInfo, 'p3-owner-community-menu');

      // A community N is not in.
      await openFixture(member.page, elsewhere.id);
      await expect(member.page.getByRole('heading', { name: "You're not a member of this community" })).toBeVisible(EVENTUAL);
      await member.page.getByRole('button', { name: 'Go to your communities' }).click();
      await expect(member.page).toHaveURL(/#\/(\?.*)?$/);
    } finally {
      await member.context.close();
      await owner.context.close();
    }
  });

  /**
   * N mentions the owner in C2's `lobby`, the owner being on C1. With `warm`, N posts a plain message there first and
   * the dock shows "new messages", so the mention only increments an existing unread entry.
   */
  async function mentionScenario(
    { browser, request }: { browser: Parameters<typeof openSession>[0]; request: APIRequestContext },
    testInfo: TestInfo,
    warm: boolean,
  ): Promise<void> {
    const world = await loungeWorld(request);
    const owner = await sessionOnFixture(browser, TEST_USER, WIDE, world.c1.id, world.c1.name);
    try {
      const { page } = owner;
      await expect(communityLink(dock(page), world.c2.name)).toBeVisible(EVENTUAL);
      await expect(communityLink(dock(page), world.c2.name)).not.toHaveAccessibleName(/mention/);
      let loads = 0;
      page.on('load', () => (loads += 1));

      if (warm) {
        await sendTestMessage(request, world.c2.lobbyId, 'hello', world.member.token);
        await expect(communityLink(dock(page), world.c2.name)).toHaveAccessibleName(`${world.c2.name}, new messages`, EVENTUAL);
      }
      await sendSpans(
        request,
        world.c2.lobbyId,
        [
          { type: 'USER_MENTION', userId: world.owner.id, text: `@${TEST_USER.username}` },
          { type: 'PLAINTEXT', text: ' lunch?' },
        ],
        world.member.token,
      );

      await expect(communityLink(dock(page), world.c2.name)).toHaveAccessibleName(`${world.c2.name}, 1 mention`, EVENTUAL);
      await dock(page).getByRole('button', { name: 'All communities', exact: true }).click();
      const row = communityLink(allSheet(page), world.c2.name);
      await expect(row).toHaveAccessibleName(/1 mention/, EVENTUAL);
      await expect(row.getByText('1 mention', { exact: true })).toBeVisible();
      await shot(page, testInfo, 'p4-mention-badges');
      expect(loads, 'no page load happened').toBe(0);
    } finally {
      await owner.context.close();
    }
  }

  test('a mention in another community badges the dock and the sheet without a reload (the channel already has an unread entry)', async ({ browser, request }, testInfo) => {
    await mentionScenario({ browser, request }, testInfo, true);
  });

  // Product race, issue #817 (seen in 1 of 6 runs): when the mention is the FIRST message of a channel the owner has
  // no unread entry for, the dock shows "new messages" and never the mention until a reload (the entry the message
  // handler inserts is refetched, and the refetch can overwrite the notification handler's mentionCount increment).
  test.fixme('a first message that mentions you badges the dock as a mention, not as "new messages" (1 in 6 runs it never does)', async ({
    browser,
    request,
  }, testInfo) => {
    await mentionScenario({ browser, request }, testInfo, false);
  });

  test('new messages bold a channel row; reading it in the old shell clears it, and Back returns to that row', async ({
    browser,
    request,
  }, testInfo) => {
    const world = await loungeWorld(request);
    const owner = await sessionOnFixture(browser, TEST_USER, PHONE, world.c1.id, world.c1.name);
    try {
      const { page } = owner;
      const lobby = () => leftIsland(page).getByRole('link', { name: startsWith('lobby') });
      await expect(lobby()).toBeVisible(EVENTUAL);
      await expect(lobby()).not.toHaveAccessibleName(/unread/);

      await sendTestMessage(request, world.c1.lobbyId, 'anyone around?', world.member.token);
      await expect(lobby()).toHaveAccessibleName(/unread/, EVENTUAL);
      await shot(page, testInfo, 'p5-unread-row');

      // A channel is a classic chat today: tapping it leaves the Lounge.
      await lobby().click();
      await expect(page.getByRole('textbox', { name: /^Message #lobby/ })).toBeVisible(EVENTUAL);
      await expect(page.locator('[data-shell="lounge"]')).toHaveCount(0);

      await page.goBack();
      await expect(page.locator('[data-shell="lounge"]')).toBeAttached(EVENTUAL);
      await expect(header(page, world.c1.name)).toBeVisible(EVENTUAL);
      await expect(lobby()).toBeFocused(EVENTUAL);
      await expect(lobby()).not.toHaveAccessibleName(/unread/, EVENTUAL);
      await shot(page, testInfo, 'p5-back-on-the-row');
    } finally {
      await owner.context.close();
    }
  });

  test('members and presence: a newcomer moves from Away to Around when they sign in, and "N around" follows', async ({
    browser,
    request,
  }, testInfo) => {
    const world = await loungeWorld(request);
    const owner = await sessionOnFixture(browser, TEST_USER, WIDE, world.c1.id, world.c1.name);
    let newcomer: Opened | undefined;
    try {
      const { page } = owner;
      const members = membersIsland(page);
      const row = (scope: Locator, state: 'away' | 'online') =>
        scope.getByRole('button', { name: new RegExp(`^${escapeRe(world.member.username)}\\s*, ${state}`) });
      /** A group of the members island: its h3 and the rows under it (the heading's parent holds both). */
      const group = (title: 'Around' | 'Away') => members.getByRole('heading', { name: title, level: 3, exact: true }).locator('xpath=..');
      await expect(row(group('Away'), 'away')).toBeVisible(EVENTUAL);
      await expect(row(members, 'online')).toHaveCount(0);
      // C1 has exactly two members, the owner (online, this page) and N (never online).
      await expect.poll(() => aroundCount(page).catch(() => -1), { ...EVENTUAL, message: '"1 around": only the owner' }).toBe(1);
      await shot(page, testInfo, 'p6-newcomer-away');

      newcomer = await sessionOnFixture(browser, world.member, WIDE, world.c1.id, world.c1.name);
      await expect(row(group('Around'), 'online')).toBeVisible(EVENTUAL);
      await expect(row(members, 'away')).toHaveCount(0);
      await expect.poll(() => aroundCount(page), { ...EVENTUAL, message: '"2 around": the owner and N' }).toBe(2);
      await shot(page, testInfo, 'p6-newcomer-around');

      // Below wide the members are a Sheet, opened from the centre's Members button.
      await page.setViewportSize(COMPACT);
      await expect(membersIsland(page)).toHaveCount(0);
      await page.getByRole('button', { name: 'Members', exact: true }).click();
      const sheet = page.getByRole('dialog', { name: 'Members', exact: true });
      await expect(sheet).toBeVisible();
      await expect(row(sheet.getByRole('heading', { name: 'Around', level: 3, exact: true }).locator('xpath=..'), 'online')).toBeVisible();
      await shot(page, testInfo, 'p6-members-sheet-compact');
    } finally {
      await newcomer?.context.close();
      await owner.context.close();
    }
  });

  for (const [label, viewport] of [
    ['390', PHONE],
    ['1440', WIDE],
  ] as const) {
    test(`the dock and the All sheet move between communities inside the Lounge, and the frame stays mounted (${label} px)`, async ({
      browser,
      request,
    }, testInfo) => {
      const world = await loungeWorld(request);
      const { context, page } = await sessionOnFixture(browser, world.member, viewport, world.c1.id, world.c1.name);
      try {
        await expect(communityLink(dock(page), world.c2.name)).toBeVisible(EVENTUAL);
        // The frame's pieces carry an expando: a remount would lose it.
        await page.evaluate(() => {
          const mark = (selector: string, key: string) => {
            const el = document.querySelector(selector) as (HTMLElement & Record<string, unknown>) | null;
            if (el) el[key] = true;
          };
          mark('nav[aria-label="Communities"]', '__keptDock');
          mark('nav[aria-label="Community"]', '__keptLeft');
        });
        const kept = () =>
          page.evaluate(() => ({
            dock: !!(document.querySelector('nav[aria-label="Communities"]') as unknown as Record<string, unknown> | null)?.__keptDock,
            left: !!(document.querySelector('nav[aria-label="Community"]') as unknown as Record<string, unknown> | null)?.__keptLeft,
          }));
        expect(await kept()).toEqual({ dock: true, left: true });

        // The dock to C2, from the keyboard (a click would focus the link anyway): focus must survive the move.
        await communityLink(dock(page), world.c2.name).focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(new RegExp(`#${escapeRe(fixturePath(world.c2.id))}$`), EVENTUAL);
        await expect(header(page, world.c2.name)).toBeVisible(EVENTUAL);
        await expect(communityLink(dock(page), world.c2.name)).toHaveAttribute('aria-current', 'page');
        await expect(communityLink(dock(page), world.c2.name)).toBeFocused();
        await expect(
          page.locator('[data-kit-live-slot] [aria-live="polite"]', { hasText: world.c2.name }).first(),
        ).toBeAttached(EVENTUAL);
        expect(await kept(), 'the dock and the left island were not remounted').toEqual({ dock: true, left: true });
        await shot(page, testInfo, `p7-dock-to-c2-${label}`);

        // The All sheet back to C1.
        await dock(page).getByRole('button', { name: 'All communities', exact: true }).click();
        await communityLink(allSheet(page), world.c1.name).click();
        await expect(page).toHaveURL(new RegExp(`#${escapeRe(fixturePath(world.c1.id))}$`), EVENTUAL);
        await expect(allSheet(page)).toHaveCount(0);
        await expect(header(page, world.c1.name)).toBeVisible(EVENTUAL);
        await expect(communityLink(dock(page), world.c1.name)).toHaveAttribute('aria-current', 'page');
        expect(await kept(), 'still not remounted after the sheet').toEqual({ dock: true, left: true });
      } finally {
        await context.close();
      }
    });
  }

  /**
   * Confirms the sign-out question and checks what a signed-out session looks like: the server ended it (the session's
   * access token and refresh cookie, captured before, are refused when replayed from a fresh request context), the
   * browser is on the login page and stays there across a reload, and nothing of the preview outlives it.
   */
  async function confirmSignOutAndExpectEnded(
    session: Opened,
    question: Locator,
    user: FreshUser,
    world: LoungeWorld,
    fresh: () => Promise<APIRequestContext>,
  ): Promise<void> {
    const { context, page, token } = session;
    const refreshCookie = (await context.cookies()).find((cookie) => cookie.name === 'refresh_token')?.value;
    expect(refreshCookie, 'the session has a refresh cookie before signing out').toBeTruthy();

    // The server's answer, not a timeout: on a slow logout the app navigates anyway and owes the server call.
    const logout = page.waitForResponse((res: Response) => res.url().endsWith('/api/auth/logout') && res.request().method() === 'POST');
    await question.getByRole('button', { name: 'Sign out', exact: true }).click();
    expect((await logout).ok(), 'the server confirmed the logout').toBe(true);

    await expect(page).toHaveURL(/#\/login/, EVENTUAL);
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('semaphore-design-preview')), EVENTUAL).toBeNull();

    // Replayed from a context that never saw the logout's Set-Cookie: only the server can refuse them.
    const replay = await fresh();
    try {
      const refresh = await replay.post(`${API_BASE}/auth/refresh`, { headers: { cookie: `refresh_token=${refreshCookie}` } });
      expect(refresh.status(), 'the old refresh token is refused after sign-out').toBe(401);
      const profile = await replay.get(`${API_BASE}/users/profile`, { headers: { Authorization: `Bearer ${token}` } });
      expect(profile.status(), 'the old access token is refused after sign-out').toBe(401);
    } finally {
      await replay.dispose();
    }

    // A reload stays on the login page: let the page settle (any silent refresh it makes has answered), then look.
    const refreshes: number[] = [];
    const onResponse = (res: Response) => {
      if (res.url().endsWith('/api/auth/refresh')) refreshes.push(res.status());
    };
    page.on('response', onResponse);
    await page.reload();
    await expect(page.getByLabel(/^Username/)).toBeVisible(EVENTUAL);
    await page.waitForLoadState('networkidle');
    page.off('response', onResponse);
    expect(refreshes.filter((status) => status < 400), 'no silent refresh succeeded after the reload').toEqual([]);
    await expect(page).toHaveURL(/#\/login/);
    await expect(page.getByLabel(/^Username/)).toBeVisible();

    // Signing in again (same context) and opening the fixture path: the preview was forgotten.
    await loginViaApi(context.request, user);
    await page.goto('/');
    await goTo(page, fixturePath(world.c1.id));
    await expect(page.getByText('Page not found')).toBeVisible(EVENTUAL);
    await expect(page.locator('[data-shell="lounge"]')).toHaveCount(0);
  }

  test('signing out from the user card ends the session', async ({ browser, request, playwright }, testInfo) => {
    const world = await loungeWorld(request);
    const fresh = () => playwright.request.newContext();
    const compact = await sessionOnFixture(browser, world.member, COMPACT, world.c1.id, world.c1.name);
    try {
      const { page } = compact;
      await page.getByRole('button', { name: 'Account menu', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Sign out…' }).click();
      const question = page.getByRole('dialog', { name: 'Sign out?' });
      await expect(question).toBeVisible();
      await shot(page, testInfo, 'p8-sign-out-question');
      await confirmSignOutAndExpectEnded(compact, question, world.member, world, fresh);
    } finally {
      await compact.context.close();
    }

    // The phone's way: the All sheet's foot.
    const phone = await sessionOnFixture(browser, world.member, PHONE, world.c1.id, world.c1.name);
    try {
      const { page } = phone;
      await dock(page).getByRole('button', { name: 'All communities', exact: true }).click();
      await allSheet(page).getByRole('button', { name: 'Sign out…', exact: true }).click();
      const question = page.getByRole('dialog', { name: 'Sign out?' });
      await expect(question).toBeVisible();
      await confirmSignOutAndExpectEnded(phone, question, world.member, world, fresh);
    } finally {
      await phone.context.close();
    }
  });

  test('at 390, 820 and 1440 px every piece is placed and the page never scrolls', async ({ browser, request }, testInfo) => {
    const world = await loungeWorld(request);
    const { context, page } = await sessionOnFixture(browser, world.member, PHONE, world.c1.id, world.c1.name);
    try {
      const expectNoPageScroll = async (step: string) => {
        const size = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          scrollHeight: document.documentElement.scrollHeight,
          innerHeight: window.innerHeight,
        }));
        expect(size.scrollWidth, `${step}: no horizontal scroll`).toBeLessThanOrEqual(size.innerWidth);
        expect(size.scrollHeight, `${step}: no vertical scroll`).toBeLessThanOrEqual(size.innerHeight);
      };
      const centre = page.getByTestId('lounge-fixture-centre');
      const card = page.getByRole('button', { name: 'Account menu', exact: true });

      for (const [width, viewport] of [
        [390, PHONE],
        [820, COMPACT],
        [1440, WIDE],
      ] as const) {
        await page.setViewportSize(viewport);
        await expect(dock(page)).toBeVisible(EVENTUAL);
        await expect(communityLink(dock(page), world.c1.name)).toBeVisible();
        await expect(leftIsland(page)).toBeVisible();
        await expect(header(page, world.c1.name)).toBeVisible();
        await expect(leftIsland(page).getByRole('heading', { name: 'Voice rooms', level: 2 })).toBeVisible();
        await expect(leftIsland(page).getByRole('heading', { name: 'hangout', level: 3 })).toBeVisible();
        if (width === 390) {
          await expect(centre).toBeHidden();
          await expect(card).toBeHidden();
        } else {
          await expect(centre).toBeVisible();
          await expect(page.getByRole('heading', { name: world.c1.name, level: 1 })).toBeVisible();
          await expect(card).toBeVisible();
        }
        if (width === 1440) await expect(membersIsland(page)).toBeVisible();
        else await expect(membersIsland(page)).toHaveCount(0);
        await expectNoPageScroll(`${width} px`);
        await shot(page, testInfo, `p9-${width}`);
      }
    } finally {
      await context.close();
    }
  });

  test('offline shows the kit banner, and it clears when the connection is back', async ({ browser, request }, testInfo) => {
    const world = await loungeWorld(request);
    const { context, page } = await sessionOnFixture(browser, world.member, WIDE, world.c1.id, world.c1.name);
    try {
      const banner = page.locator('[data-shell="lounge"]').getByText(/You're offline/);
      await expect(banner).toHaveCount(0);

      await context.setOffline(true);
      await expect(banner).toBeVisible(EVENTUAL);
      // The old shell's chip is not drawn while the new shell is shown.
      await expect(page.locator('.MuiChip-root')).toHaveCount(0);
      await shot(page, testInfo, 'p10-offline');

      await context.setOffline(false);
      await expect(banner).toHaveCount(0, EVENTUAL);
    } finally {
      await context.setOffline(false).catch(() => {});
      await context.close();
    }
  });
});
