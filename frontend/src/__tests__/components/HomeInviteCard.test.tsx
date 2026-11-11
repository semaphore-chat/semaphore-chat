import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import HomeInviteCard from '../../components/Home/HomeInviteCard';
import type { CommunityResponseDto, CreateInviteDto } from '../../api-client/types.gen';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const { mockCopy } = vi.hoisted(() => ({ mockCopy: vi.fn() }));
vi.mock('../../utils/clipboard', () => ({ copyToClipboard: mockCopy }));
vi.mock('../../config/env', () => ({ getInstanceUrl: () => 'https://chat.example' }));
vi.mock('../../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), log: vi.fn() } }));

let mockUser: { id: string; role: string } = { id: 'me', role: 'USER' };
vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: mockUser, isLoading: false }),
}));

let mockPerms: Record<string, boolean> = {};
vi.mock('../../features/roles/useUserPermissions', () => ({
  useUserPermissions: ({ actions }: { actions: string[] }) => ({
    hasPermissions: actions.every((a) => mockPerms[a]),
    isLoading: false,
  }),
}));

const community = (id: string, name: string): CommunityResponseDto => ({
  id,
  name,
  description: null,
  avatar: null,
  banner: null,
  createdAt: '2026-01-01T00:00:00.000Z',
});

/** What GET /roles/my/community/:id answers: the actions held per community. */
let heldActions: Record<string, string[]> = {};
const rolesHandler = http.get('http://localhost:3000/api/roles/my/community/:communityId', ({ params }) =>
  HttpResponse.json({
    userId: 'me',
    resourceId: params.communityId,
    resourceType: 'COMMUNITY',
    roles: [{ id: 'r', name: 'Role', actions: heldActions[params.communityId as string] ?? [] }],
  }),
);

let createdBodies: CreateInviteDto[] = [];
const inviteCreated = (code: string) =>
  http.post('http://localhost:3000/api/invite', async ({ request }) => {
    createdBodies.push((await request.json()) as CreateInviteDto);
    return HttpResponse.json(
      {
        id: 'inv-1',
        code,
        createdById: 'me',
        maxUses: 10,
        uses: 0,
        validUntil: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        disabled: false,
        defaultCommunities: [],
        usages: [],
      },
      { status: 201 },
    );
  });

/** The button is disabled until the community roles have arrived. */
const clickQuickInvite = async (user: UserEvent) => {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Quick invite' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Quick invite' }));
};

describe('HomeInviteCard', () => {
  beforeEach(() => {
    mockPerms = { CREATE_INSTANCE_INVITE: true };
    createdBodies = [];
    mockUser = { id: 'me', role: 'USER' };
    heldActions = { c1: ['CREATE_INVITE'], c2: ['CREATE_INVITE'], c9: ['CREATE_INVITE'] };
    server.use(rolesHandler);
    mockCopy.mockReset();
    mockCopy.mockResolvedValue(undefined);
    localStorage.clear();
  });

  it('Quick invite creates a 10-use, 7-day invite for every community and copies its link', async () => {
    server.use(inviteCreated('ABC123'));
    const before = Date.now();
    const { user } = renderWithProviders(
      <HomeInviteCard communities={[community('c1', 'Gaming'), community('c2', 'Work')]} />,
    );

    await clickQuickInvite(user);

    expect(await screen.findByText('Invite link copied to clipboard!')).toBeInTheDocument();
    expect(mockCopy).toHaveBeenCalledWith('https://chat.example/#/join/ABC123');
    expect(screen.getByText('ABC123')).toBeInTheDocument();
    expect(createdBodies).toHaveLength(1);
    expect(createdBodies[0].communityIds).toEqual(['c1', 'c2']);
    expect(createdBodies[0].maxUses).toBe(10);
    const validFor = new Date(createdBodies[0].validUntil!).getTime() - before;
    expect(validFor).toBeGreaterThan(6.9 * 24 * 3600 * 1000);
    expect(validFor).toBeLessThan(7.1 * 24 * 3600 * 1000);
  });

  it('prefers a community called "default" when there is one', async () => {
    server.use(inviteCreated('DEF456'));
    const { user } = renderWithProviders(
      <HomeInviteCard communities={[community('c1', 'Gaming'), community('c9', 'Default')]} />,
    );
    await clickQuickInvite(user);
    await screen.findByText('Invite link copied to clipboard!');
    expect(createdBodies[0].communityIds).toEqual(['c9']);
  });

  describe('target communities', () => {
    it('leaves out communities where the user lacks CREATE_INVITE', async () => {
      heldActions = { c1: ['READ_MESSAGE'], c2: ['CREATE_INVITE'] };
      server.use(inviteCreated('ABC123'));
      const { user } = renderWithProviders(
        <HomeInviteCard communities={[community('c1', 'Gaming'), community('c2', 'Work')]} />,
      );
      await clickQuickInvite(user);
      await screen.findByText('Invite link copied to clipboard!');
      expect(createdBodies[0].communityIds).toEqual(['c2']);
    });

    it('does not prefer a "default" community the user cannot invite to', async () => {
      heldActions = { c1: ['CREATE_INVITE'], c9: ['READ_MESSAGE'] };
      server.use(inviteCreated('ABC123'));
      const { user } = renderWithProviders(
        <HomeInviteCard communities={[community('c1', 'Gaming'), community('c9', 'Default')]} />,
      );
      await clickQuickInvite(user);
      await screen.findByText('Invite link copied to clipboard!');
      expect(createdBodies[0].communityIds).toEqual(['c1']);
    });

    it('falls back to an invite with no communities for a plain Member', async () => {
      heldActions = { c1: ['READ_MESSAGE'], c2: ['READ_MESSAGE'] };
      server.use(inviteCreated('ABC123'));
      const { user } = renderWithProviders(
        <HomeInviteCard communities={[community('c1', 'Gaming'), community('c2', 'Work')]} />,
      );
      await clickQuickInvite(user);
      await screen.findByText('Invite link copied to clipboard!');
      expect(createdBodies[0].communityIds).toEqual([]);
    });

    it('treats a community whose roles failed to load as one it cannot invite to', async () => {
      server.use(
        http.get('http://localhost:3000/api/roles/my/community/c1', () =>
          HttpResponse.json({ message: 'nope' }, { status: 500 }),
        ),
        inviteCreated('ABC123'),
      );
      const { user } = renderWithProviders(
        <HomeInviteCard communities={[community('c1', 'Gaming'), community('c2', 'Work')]} />,
      );
      await clickQuickInvite(user);
      await screen.findByText('Invite link copied to clipboard!');
      expect(createdBodies[0].communityIds).toEqual(['c2']);
    });

    it('an instance owner holds it everywhere, without any community role', async () => {
      heldActions = {};
      mockUser = { id: 'me', role: 'OWNER' };
      server.use(inviteCreated('ABC123'));
      const { user } = renderWithProviders(
        <HomeInviteCard communities={[community('c1', 'Gaming'), community('c2', 'Work')]} />,
      );
      await clickQuickInvite(user);
      await screen.findByText('Invite link copied to clipboard!');
      expect(createdBodies[0].communityIds).toEqual(['c1', 'c2']);
    });

    it('holds Quick invite back while the roles load', async () => {
      server.use(
        http.get('http://localhost:3000/api/roles/my/community/:communityId', () => new Promise(() => {})),
      );
      renderWithProviders(<HomeInviteCard communities={[community('c1', 'Gaming')]} />);
      expect(screen.getByRole('button', { name: 'Quick invite' })).toBeDisabled();
    });
  });

  it('Copy copies the last invite link again', async () => {
    server.use(inviteCreated('ABC123'));
    const { user } = renderWithProviders(<HomeInviteCard communities={[community('c1', 'Gaming')]} />);
    await clickQuickInvite(user);
    await screen.findByText('ABC123');
    mockCopy.mockClear();

    await user.click(screen.getByRole('button', { name: 'Copy invite link' }));

    expect(mockCopy).toHaveBeenCalledTimes(1);
    expect(mockCopy).toHaveBeenCalledWith('https://chat.example/#/join/ABC123');
    expect(await screen.findByText('Invite link copied to clipboard!')).toBeInTheDocument();
  });

  it('says so when the invite cannot be created, and copies nothing', async () => {
    server.use(
      http.post('http://localhost:3000/api/invite', () =>
        HttpResponse.json({ message: 'Forbidden', statusCode: 403 }, { status: 403 }),
      ),
    );
    const { user } = renderWithProviders(<HomeInviteCard communities={[community('c1', 'Gaming')]} />);

    await clickQuickInvite(user);

    expect(await screen.findByText("Couldn't create an invite link. Try again.")).toBeInTheDocument();
    expect(mockCopy).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Copy invite link' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Quick invite' })).toBeEnabled());
  });

  it('keeps the created code and points at the copy button when the clipboard write fails', async () => {
    server.use(inviteCreated('ABC123'));
    mockCopy.mockRejectedValue(new Error('denied'));
    const { user } = renderWithProviders(<HomeInviteCard communities={[community('c1', 'Gaming')]} />);

    await clickQuickInvite(user);

    expect(
      await screen.findByText("Invite created, but it couldn't be copied. Use the copy button."),
    ).toBeInTheDocument();
    expect(screen.getByText('ABC123')).toBeInTheDocument();
  });

  it('reports a failed Copy', async () => {
    server.use(inviteCreated('ABC123'));
    const { user } = renderWithProviders(<HomeInviteCard communities={[community('c1', 'Gaming')]} />);
    await clickQuickInvite(user);
    await screen.findByText('ABC123');
    mockCopy.mockRejectedValue(new Error('denied'));

    await user.click(screen.getByRole('button', { name: 'Copy invite link' }));

    expect(await screen.findByText("Couldn't copy the invite link.")).toBeInTheDocument();
  });

  it('shows "Manage" only to users who can read invites', () => {
    const { unmount } = renderWithProviders(<HomeInviteCard communities={[]} />);
    expect(screen.queryByRole('link', { name: /manage/i })).not.toBeInTheDocument();
    unmount();
    mockPerms = { CREATE_INSTANCE_INVITE: true, READ_INSTANCE_INVITE: true };
    renderWithProviders(<HomeInviteCard communities={[]} />);
    expect(screen.getByRole('link', { name: /manage/i })).toHaveAttribute('href', '/admin/invites');
  });
});
