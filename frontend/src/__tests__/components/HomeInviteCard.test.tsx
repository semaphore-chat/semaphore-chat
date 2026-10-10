import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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

describe('HomeInviteCard', () => {
  beforeEach(() => {
    mockPerms = { CREATE_INSTANCE_INVITE: true };
    createdBodies = [];
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

    await user.click(screen.getByRole('button', { name: 'Quick invite' }));

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
    await user.click(screen.getByRole('button', { name: 'Quick invite' }));
    await screen.findByText('Invite link copied to clipboard!');
    expect(createdBodies[0].communityIds).toEqual(['c9']);
  });

  it('Copy copies the last invite link again', async () => {
    server.use(inviteCreated('ABC123'));
    const { user } = renderWithProviders(<HomeInviteCard communities={[community('c1', 'Gaming')]} />);
    await user.click(screen.getByRole('button', { name: 'Quick invite' }));
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

    await user.click(screen.getByRole('button', { name: 'Quick invite' }));

    expect(await screen.findByText("Couldn't create an invite link. Try again.")).toBeInTheDocument();
    expect(mockCopy).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Copy invite link' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Quick invite' })).toBeEnabled());
  });

  it('keeps the created code and points at the copy button when the clipboard write fails', async () => {
    server.use(inviteCreated('ABC123'));
    mockCopy.mockRejectedValue(new Error('denied'));
    const { user } = renderWithProviders(<HomeInviteCard communities={[community('c1', 'Gaming')]} />);

    await user.click(screen.getByRole('button', { name: 'Quick invite' }));

    expect(
      await screen.findByText("Invite created, but it couldn't be copied. Use the copy button."),
    ).toBeInTheDocument();
    expect(screen.getByText('ABC123')).toBeInTheDocument();
  });

  it('reports a failed Copy', async () => {
    server.use(inviteCreated('ABC123'));
    const { user } = renderWithProviders(<HomeInviteCard communities={[community('c1', 'Gaming')]} />);
    await user.click(screen.getByRole('button', { name: 'Quick invite' }));
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
