import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { buildPresetOverwrites } from '@semaphore-chat/shared';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import { createChannel } from '../test-utils/factories';
import ChannelPermissionsTab from '../../components/Community/ChannelPermissionsTab';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const BASE = 'http://localhost:3000';
const COMMUNITY = 'community-1';
const channel = createChannel({ id: 'ch-ann', name: 'announcements', communityId: COMMUNITY });

const POSTING = ['CREATE_MESSAGE', 'ATTACH_FILES', 'CREATE_REACTION', 'MANAGE_CHANNEL_PERMISSIONS', 'READ_CHANNEL'];
const role = (id: string, name: string, position: number, actions: string[]) => ({
  id,
  name,
  position,
  actions,
  createdAt: '2025-01-01T00:00:00Z',
  isDefault: true,
});
const ADMIN = role('r-admin', 'Community Admin', 10, POSTING);
const MOD = role('r-mod', 'Moderator', 20, POSTING);
const HELPER = role('r-helper', 'Helper', 50, POSTING);
const MEMBER = role('r-member', 'Member', 100, ['CREATE_MESSAGE', 'ATTACH_FILES', 'CREATE_REACTION']);
const ROLES = [ADMIN, MOD, HELPER, MEMBER];

interface Setup {
  me?: 'OWNER' | 'USER';
  myRoles?: ReturnType<typeof role>[];
  stored?: { preset: string; overwrites: unknown[] };
}

function setup({ me = 'USER', myRoles = [MOD], stored = { preset: 'NORMAL', overwrites: [] } }: Setup = {}) {
  const puts: unknown[] = [];
  const patches: unknown[] = [];
  server.use(
    http.get(`${BASE}/api/users/profile`, () =>
      HttpResponse.json({ id: 'current-user-1', username: 'me', role: me })),
    http.get(`${BASE}/api/roles/community/:communityId`, () =>
      HttpResponse.json({ communityId: COMMUNITY, roles: ROLES })),
    http.get(`${BASE}/api/roles/my/community/:communityId`, () =>
      HttpResponse.json({ resourceType: 'COMMUNITY', userId: 'current-user-1', resourceId: COMMUNITY, roles: myRoles })),
    http.get(`${BASE}/api/channels/:id/overwrites`, () =>
      HttpResponse.json({ channelId: channel.id, ...stored })),
    http.put(`${BASE}/api/channels/:id/overwrites`, async ({ request }) => {
      const body = await request.json();
      puts.push(body);
      return HttpResponse.json({ channelId: channel.id, ...(body as object) });
    }),
    http.patch(`${BASE}/api/channels/:id`, async ({ request }) => {
      const body = await request.json();
      patches.push(body);
      return HttpResponse.json({ ...channel, ...(body as object) });
    }),
  );
  const onSaved = vi.fn();
  const result = renderWithProviders(<ChannelPermissionsTab channel={channel} onSaved={onSaved} />);
  return { ...result, puts, patches, onSaved };
}

const card = (id: string) => screen.findByTestId(`preset-${id}`);

describe('ChannelPermissionsTab', () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  it('selects the stored preset', async () => {
    setup({
      stored: {
        preset: 'READ_ONLY',
        overwrites: [
          { targetType: 'EVERYONE', roleId: null, allow: [], deny: ['CREATE_MESSAGE', 'ATTACH_FILES', 'CREATE_REACTION'] },
          { targetType: 'ROLE', roleId: HELPER.id, allow: ['CREATE_MESSAGE', 'ATTACH_FILES', 'CREATE_REACTION'], deny: [] },
        ],
      },
    });
    await waitFor(async () => expect(await card('READ_ONLY')).toHaveAttribute('aria-checked', 'true'));
    expect(await card('NORMAL')).toHaveAttribute('aria-checked', 'false');
    // Helper is a post role: its chip is pressed
    expect(screen.getByRole('button', { name: 'Helper' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('as a Moderator, Announcement keeps Community Admin automatically and saves exactly the built payload', async () => {
    const { user, puts, onSaved } = setup();
    await user.click(await card('ANNOUNCEMENT'));
    expect(await card('ANNOUNCEMENT')).toHaveAttribute('aria-checked', 'true');

    // Community Admin ranks above the Moderator: locked "kept automatically" chip
    const auto = await screen.findByTestId(`auto-role-${ADMIN.id}`);
    expect(auto).toHaveTextContent('Community Admin');
    // Roles below the actor are pickable; Helper manages permissions, so it's preselected
    expect(screen.getByRole('button', { name: 'Helper' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Member' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByRole('button', { name: /save permissions/i }));
    await waitFor(() => expect(puts).toHaveLength(1));
    const expected = buildPresetOverwrites({
      preset: 'ANNOUNCEMENT',
      postRoleIds: [HELPER.id],
      membersCanAttach: true,
      roles: ROLES,
      actorBestPosition: 20,
    });
    expect(puts[0]).toEqual({ preset: expected.preset, overwrites: expected.overwrites });
    // ...which includes an allow for Community Admin
    expect(expected.overwrites).toContainEqual(
      expect.objectContaining({ targetType: 'ROLE', roleId: ADMIN.id, allow: ['CREATE_MESSAGE', 'ATTACH_FILES'] }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('toggling a post role changes the payload', async () => {
    const { user, puts } = setup({ me: 'OWNER', myRoles: [] });
    await user.click(await card('READ_ONLY'));
    await user.click(screen.getByRole('button', { name: 'Member' }));
    await user.click(screen.getByRole('button', { name: /save permissions/i }));
    await waitFor(() => expect(puts).toHaveLength(1));
    const body = puts[0] as { overwrites: { roleId: string | null }[] };
    expect(body.overwrites.map((o) => o.roleId)).toContain(MEMBER.id);
    // The owner has no rank above anyone: no automatic allows
    expect(screen.queryByTestId(`auto-role-${ADMIN.id}`)).not.toBeInTheDocument();
  });

  it('turning off "Members can attach files" on Normal denies ATTACH_FILES for everyone', async () => {
    const { user, puts } = setup({ me: 'OWNER', myRoles: [] });
    await user.click(await screen.findByRole('switch', { name: /members can attach files/i }));
    await user.click(screen.getByRole('button', { name: /save permissions/i }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({
      preset: 'NORMAL',
      overwrites: [{ targetType: 'EVERYONE', roleId: null, allow: [], deny: ['ATTACH_FILES'] }],
    });
  });

  it('the Mods-only card is disabled ("Coming soon")', async () => {
    setup();
    const mods = await card('MODS_ONLY');
    expect(mods).toHaveAttribute('aria-disabled', 'true');
    expect(mods).toHaveTextContent(/coming soon/i);
  });

  it('shows a non-preset set as Custom, with a summary', async () => {
    setup({
      stored: {
        preset: 'CUSTOM',
        overwrites: [
          { targetType: 'EVERYONE', roleId: null, allow: [], deny: ['CREATE_REACTION'] },
          { targetType: 'ROLE', roleId: MEMBER.id, allow: [], deny: ['ATTACH_FILES'] },
        ],
      },
    });
    expect(await card('CUSTOM')).toHaveAttribute('aria-checked', 'true');
    const summary = await screen.findByTestId('custom-summary');
    expect(summary).toHaveTextContent("@everyone: can't add reactions");
    expect(summary).toHaveTextContent("Member: can't attach files");
    // Nothing to save until a preset is chosen
    expect(screen.getByRole('button', { name: /save permissions/i })).toBeDisabled();
  });

  it('disables presets that need actions the actor lacks', async () => {
    const curator = role('r-curator', 'Curator', 50, ['MANAGE_CHANNEL_PERMISSIONS', 'CREATE_REACTION']);
    const { user } = setup({ myRoles: [curator] });
    const readOnly = await card('READ_ONLY');
    expect(readOnly).toHaveAttribute('aria-disabled', 'true');
    expect(await card('ANNOUNCEMENT')).toHaveAttribute('aria-disabled', 'true');
    await user.click(readOnly);
    expect(readOnly).toHaveAttribute('aria-checked', 'false');
    await user.hover(readOnly);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/you need send messages/i);
  });

  it('saves the private switch through PATCH /channels/:id', async () => {
    const { user, patches, puts } = setup({ me: 'OWNER', myRoles: [] });
    await user.click(await screen.findByRole('switch', { name: /private channel/i }));
    await user.click(screen.getByRole('button', { name: /save permissions/i }));
    await waitFor(() => expect(patches).toEqual([{ isPrivate: true }]));
    // The (unchanged) preset is written too
    await waitFor(() => expect(puts).toHaveLength(1));
  });

  it('shows an error when saving fails', async () => {
    const { user } = setup({ me: 'OWNER', myRoles: [] });
    server.use(
      http.put(`${BASE}/api/channels/:id/overwrites`, () =>
        HttpResponse.json(
          { statusCode: 403, message: 'This would remove CREATE_MESSAGE from roles above yours' },
          { status: 403 },
        )),
    );
    await user.click(await card('ANNOUNCEMENT'));
    await user.click(screen.getByRole('button', { name: /save permissions/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('shows an error when the overwrites fail to load', async () => {
    setup();
    server.use(
      http.get(`${BASE}/api/channels/:id/overwrites`, () => new HttpResponse(null, { status: 500 })),
    );
    // The handler swap races the first fetch; re-render from scratch
    server.resetHandlers();
    server.use(
      http.get(`${BASE}/api/users/profile`, () => HttpResponse.json({ id: 'u', role: 'USER' })),
      http.get(`${BASE}/api/roles/community/:communityId`, () => HttpResponse.json({ communityId: COMMUNITY, roles: ROLES })),
      http.get(`${BASE}/api/roles/my/community/:communityId`, () =>
        HttpResponse.json({ resourceType: 'COMMUNITY', userId: 'u', resourceId: COMMUNITY, roles: [MOD] })),
      http.get(`${BASE}/api/channels/:id/overwrites`, () => new HttpResponse(null, { status: 500 })),
    );
    const { getAllByRole } = renderWithProviders(<ChannelPermissionsTab channel={channel} />);
    await waitFor(() =>
      expect(getAllByRole('alert').some((a) => within(a).queryByText(/couldn't load/i))).toBe(true),
    );
  });
});
