/**
 * Test Data Helpers
 *
 * API helpers for setting up and tearing down test data.
 * These bypass the UI for faster test setup.
 */

import { APIRequestContext } from '@playwright/test';

const API_BASE = '/api';

/**
 * Create a test community
 */
/**
 * Communities created with an owner token in this worker (each Playwright worker has its own module
 * instance). `createWorld`, `loungeWorld` and direct calls all go through `createTestCommunity`, so every
 * one is recorded here; `deleteWorlds` removes them so the shared `testuser` does not pile up communities.
 */
const createdCommunities: Array<{ id: string; token: string }> = [];

/** Delete every community recorded in this worker as its owner. A failed delete only logs a warning. */
export async function deleteWorlds(request: APIRequestContext): Promise<void> {
  const batch = createdCommunities.splice(0);
  for (const { id, token } of batch) {
    try {
      await deleteCommunity(request, id, token);
    } catch (error) {
      console.warn(`deleteWorlds: could not delete community ${id}: ${(error as Error).message}`);
    }
  }
}

export async function createTestCommunity(
  request: APIRequestContext,
  data: { name: string; description?: string },
  token?: string
): Promise<{ id: string; name: string }> {
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await request.post(`${API_BASE}/community`, {
    data: {
      name: data.name,
      description: data.description || `Test community: ${data.name}`,
    },
    headers,
  });

  if (!response.ok()) {
    const error = await response.text();
    throw new Error(`Failed to create community: ${response.status()} - ${error}`);
  }

  const community = await response.json();
  if (token) createdCommunities.push({ id: community.id, token });
  return community;
}

/**
 * Create a test channel in a community
 */
export async function createTestChannel(
  request: APIRequestContext,
  communityId: string,
  data: { name: string; type?: 'TEXT' | 'VOICE'; isPrivate?: boolean },
  token?: string
): Promise<{ id: string; name: string }> {
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await request.post(`${API_BASE}/channels`, {
    data: {
      name: data.name,
      communityId,
      type: data.type || 'TEXT',
      isPrivate: data.isPrivate || false,
    },
    headers,
  });

  if (!response.ok()) {
    const error = await response.text();
    throw new Error(`Failed to create channel: ${response.status()} - ${error}`);
  }

  return response.json();
}

/**
 * Send a test message to a channel
 */
export async function sendTestMessage(
  request: APIRequestContext,
  channelId: string,
  content: string,
  token?: string
): Promise<{ id: string; spans: Array<{ type: string; text: string }> }> {
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await request.post(`${API_BASE}/messages`, {
    data: {
      channelId,
      // API expects spans array for message content
      spans: [{ type: 'PLAINTEXT', text: content }],
      attachments: [],
    },
    headers,
  });

  if (!response.ok()) {
    const error = await response.text();
    throw new Error(`Failed to send message: ${response.status()} - ${error}`);
  }

  return response.json();
}

/**
 * Create a community invite link
 */
export async function createCommunityInvite(
  request: APIRequestContext,
  communityId: string,
  token?: string
): Promise<{ code: string; url: string }> {
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await request.post(`${API_BASE}/community/${communityId}/invite`, {
    data: {},
    headers,
  });

  if (!response.ok()) {
    const error = await response.text();
    throw new Error(`Failed to create invite: ${response.status()} - ${error}`);
  }

  return response.json();
}

/**
 * Get current user's communities
 */
export async function getUserCommunities(
  request: APIRequestContext,
  token?: string
): Promise<Array<{ id: string; name: string }>> {
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await request.get(`${API_BASE}/community/mine`, { headers });

  if (!response.ok()) {
    const error = await response.text();
    throw new Error(`Failed to get communities: ${response.status()} - ${error}`);
  }

  return response.json();
}

/**
 * Delete a community (cleanup)
 */
export async function deleteCommunity(
  request: APIRequestContext,
  communityId: string,
  token?: string
): Promise<void> {
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await request.delete(`${API_BASE}/community/${communityId}`, { headers });

  if (!response.ok() && response.status() !== 404) {
    const error = await response.text();
    throw new Error(`Failed to delete community: ${response.status()} - ${error}`);
  }
}

/**
 * Generate a unique test name to avoid conflicts
 */
export function generateTestName(prefix: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Wait for real-time message to appear
 * Useful for WebSocket message tests
 */
export async function waitForMessage(
  page: import('@playwright/test').Page,
  content: string,
  timeout = 5000
): Promise<void> {
  await page.waitForSelector(`text="${content}"`, { timeout });
}

/**
 * Cleanup helper - deletes all test communities
 */
export async function cleanupTestCommunities(
  request: APIRequestContext,
  prefix = 'test-',
  token?: string
): Promise<void> {
  try {
    const communities = await getUserCommunities(request, token);
    for (const community of communities) {
      if (community.name.startsWith(prefix)) {
        await deleteCommunity(request, community.id, token);
      }
    }
  } catch (error) {
    console.warn('Cleanup error:', error);
  }
}
