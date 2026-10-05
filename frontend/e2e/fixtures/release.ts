/**
 * Helpers for the release smoke specs (release-*.spec.ts).
 *
 * Each test builds its own community through the API (owner = the seeded
 * `testuser`, an instance OWNER; plain member = the seeded `member`, an
 * instance USER) so tests never share state and can run in any order.
 */

import type {
  APIRequestContext,
  Browser,
  BrowserContext,
  Page,
  TestInfo,
} from '@playwright/test';
import { API_BASE, TEST_USER, loginViaApi } from './auth.fixture';
import { createTestCommunity, generateTestName } from './test-data';

export const MEMBER_USER = {
  username: 'member',
  password: 'Member123!@#',
};

export const DESKTOP_VIEWPORT = { width: 1440, height: 900 };

export interface Session {
  context: BrowserContext;
  page: Page;
  token: string;
}

/** A fresh browser context signed in as `credentials` (no shared storage state). */
export async function openSession(
  browser: Browser,
  credentials: { username: string; password: string },
  viewport: { width: number; height: number } = DESKTOP_VIEWPORT,
): Promise<Session> {
  const context = await browser.newContext({
    viewport,
    storageState: { cookies: [], origins: [] },
  });
  // The app signs in through the httpOnly refresh-token cookie, so log in with
  // the context's own request: the Set-Cookie headers land in this context
  const login = await context.request.post(`${API_BASE}/auth/login`, { data: credentials });
  if (!login.ok()) {
    throw new Error(`Login failed: ${login.status()} ${await login.text()}`);
  }
  const { accessToken } = await login.json();
  const page = await context.newPage();
  await page.goto('/');
  return { context, page, token: accessToken };
}

export interface ReleaseWorld {
  ownerToken: string;
  memberToken: string;
  communityId: string;
  communityName: string;
}

/** Owner creates a community and adds the plain `member` user to it. */
export async function createWorld(request: APIRequestContext): Promise<ReleaseWorld> {
  const { accessToken: ownerToken } = await loginViaApi(request, TEST_USER);
  const { accessToken: memberToken } = await loginViaApi(request, MEMBER_USER);

  const communityName = generateTestName('rel');
  const community = await createTestCommunity(request, { name: communityName }, ownerToken);

  const profile = await request.get(`${API_BASE}/users/profile`, {
    headers: { Authorization: `Bearer ${memberToken}` },
  });
  const memberId = (await profile.json()).id as string;
  const join = await request.post(`${API_BASE}/membership`, {
    data: { userId: memberId, communityId: community.id },
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  if (!join.ok()) {
    throw new Error(`Adding member failed: ${join.status()} ${await join.text()}`);
  }

  return { ownerToken, memberToken, communityId: community.id, communityName };
}

/** Post a message made of arbitrary spans (e.g. a CHANNEL_MENTION). */
export async function sendSpans(
  request: APIRequestContext,
  channelId: string,
  spans: Array<Record<string, unknown>>,
  token: string,
): Promise<{ id: string }> {
  const response = await request.post(`${API_BASE}/messages`, {
    data: { channelId, spans, attachments: [] },
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok()) {
    throw new Error(`Failed to send message: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

/** Attach a screenshot of `page` to the HTML report. */
export async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
}

export const channelUrl = (communityId: string, channelId: string) =>
  `/#/community/${communityId}/channel/${channelId}`;
