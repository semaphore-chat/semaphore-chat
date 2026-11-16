/**
 * Guard for the world fixtures' cleanup: `deleteWorlds` removes every community a world created, so the
 * shared `testuser` does not pile up communities across a full run (see shell-switch.spec.ts).
 */

import { test, expect, deleteWorlds, getUserCommunities } from './fixtures';
import { createWorld } from './fixtures/release';

test('deleteWorlds removes the communities a world created', async ({ request }) => {
  const world = await createWorld(request);
  const idsOf = async () =>
    (await getUserCommunities(request, world.ownerToken)).map((c: { id: string }) => c.id);

  expect(await idsOf()).toContain(world.communityId);
  await deleteWorlds(request);
  expect(await idsOf()).not.toContain(world.communityId);

  // Safe to call again with nothing recorded
  await deleteWorlds(request);
});

test.afterEach(async ({ request }) => deleteWorlds(request));
