import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import AdminDashboard from '../../pages/admin/AdminDashboard';
import { LIVEKIT_SETUP_DOCS_URL } from '../../pages/admin/adminAttention';
import type {
  InstanceStatsResponseDto,
  InstanceStorageStatsDto,
  LivekitHealthResponseDto,
} from '../../api-client/types.gen';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const API = 'http://localhost:3000/api';

const STATS: InstanceStatsResponseDto = {
  totalUsers: 1234567,
  totalCommunities: 42,
  totalChannels: 310,
  totalMessages: 166,
  activeInvites: 3,
  bannedUsers: 0,
};

const storageStats = (
  overrides: Partial<InstanceStorageStatsDto> = {},
  server: Partial<InstanceStorageStatsDto['server']> = {},
): InstanceStorageStatsDto => ({
  totalStorageUsedBytes: 4 * 1024 ** 3,
  totalFileCount: 128,
  totalUserCount: 13,
  averageStoragePerUserBytes: 300 * 1024 ** 2,
  userStorageDistribution: { under25Percent: 10, under50Percent: 2, under75Percent: 1, under90Percent: 0, over90Percent: 0 },
  storageByType: [{ type: 'IMAGE', bytes: 2 * 1024 ** 3, count: 80 }],
  defaultQuotaBytes: 5 * 1024 ** 3,
  maxFileSizeBytes: 25 * 1024 ** 2,
  usersApproachingQuota: 0,
  usersOverQuota: 0,
  ...overrides,
  server: {
    memoryTotalBytes: 16 * 1024 ** 3,
    memoryUsedBytes: 15 * 1024 ** 3,
    memoryFreeBytes: 1024 ** 3,
    memoryUsedPercent: 94,
    cpuCores: 8,
    cpuModel: 'cpu',
    loadAverage: [0.5, 0.4, 0.3],
    diskTotalBytes: 100 * 1024 ** 3,
    diskUsedBytes: 25 * 1024 ** 3,
    diskFreeBytes: 75 * 1024 ** 3,
    diskUsedPercent: 25,
    platform: 'linux',
    hostname: 'host',
    uptime: 3600,
    ...server,
  },
});

const LIVEKIT_OK: LivekitHealthResponseDto = { status: 'healthy', configured: true };

function useHandlers({
  stats = STATS,
  storage = storageStats(),
  storageStatus = 200,
  livekit = LIVEKIT_OK,
}: {
  stats?: InstanceStatsResponseDto;
  storage?: InstanceStorageStatsDto;
  storageStatus?: number;
  livekit?: LivekitHealthResponseDto;
} = {}) {
  const storageHandler = vi.fn(() =>
    storageStatus === 200
      ? HttpResponse.json(storage)
      : HttpResponse.json({ statusCode: storageStatus, message: 'x' }, { status: storageStatus }),
  );
  server.use(
    http.get(`${API}/instance/stats`, () => HttpResponse.json(stats)),
    http.get(`${API}/storage/instance`, storageHandler),
    http.get(`${API}/livekit/health`, () => HttpResponse.json(livekit)),
  );
  return { storageHandler };
}

const failStats = (status: number) =>
  server.use(
    http.get(`${API}/instance/stats`, () =>
      HttpResponse.json({ statusCode: status, message: 'x' }, { status }),
    ),
  );

describe('AdminDashboard load failures', () => {
  beforeEach(() => {
    useHandlers();
  });

  it('shows a permission message, not a fault, on 403', async () => {
    failStats(403);
    renderWithProviders(<AdminDashboard />);
    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have access to the admin dashboard");
    expect(screen.getByText('Only instance admins can see this page.')).toBeInTheDocument();
    expect(screen.queryByText(/Failed to load instance statistics/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('shows a server error with retry on 500', async () => {
    failStats(500);
    renderWithProviders(<AdminDashboard />);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the admin dashboard");
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});

describe('AdminDashboard needs attention', () => {
  it('shows a calm "All good" line and no attention section when nothing is wrong', async () => {
    useHandlers();
    renderWithProviders(<AdminDashboard />);
    expect(await screen.findByText('All good: nothing needs attention.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Needs attention' })).not.toBeInTheDocument();
  });

  it('does not flag high server memory', async () => {
    useHandlers({ storage: storageStats({}, { memoryUsedPercent: 99 }) });
    renderWithProviders(<AdminDashboard />);
    expect(await screen.findByText('All good: nothing needs attention.')).toBeInTheDocument();
  });

  it('lists disk, quota and LiveKit problems first, each with its link', async () => {
    useHandlers({
      storage: storageStats({ usersOverQuota: 3 }, { diskUsedPercent: 92 }),
      livekit: { status: 'unhealthy', configured: false },
    });
    renderWithProviders(<AdminDashboard />);

    const section = (await screen.findByRole('heading', { name: 'Needs attention' })).closest('section')!;
    const rows = within(section).getAllByRole('listitem');
    expect(rows.map((r) => r.dataset.testid)).toEqual(['attention-disk', 'attention-over-quota', 'attention-livekit']);
    expect(rows[0]).toHaveAttribute('data-severity', 'error');
    expect(rows[0]).toHaveTextContent('Server disk is 92% full');

    expect(within(rows[0]).getByRole('link', { name: /storage/i })).toHaveAttribute('href', '/admin/storage');
    expect(within(rows[1]).getByRole('link', { name: /storage/i })).toHaveAttribute('href', '/admin/storage?minPercent=90');
    const docs = within(rows[2]).getByRole('link', { name: /setup guide/i });
    expect(docs).toHaveAttribute('href', LIVEKIT_SETUP_DOCS_URL);
    expect(docs).toHaveAttribute('target', '_blank');

    expect(screen.queryByText('All good: nothing needs attention.')).not.toBeInTheDocument();
  });

  it('turns a storage stats failure into a retryable attention item instead of rendering nothing', async () => {
    const { storageHandler } = useHandlers({ storageStatus: 500 });
    const { user } = renderWithProviders(<AdminDashboard />);

    const row = await screen.findByTestId('attention-storage-unavailable');
    expect(row).toHaveTextContent("Couldn't load storage and server status");
    expect(screen.queryByRole('heading', { name: /storage & server/i })).not.toBeInTheDocument();

    const calls = storageHandler.mock.calls.length;
    await user.click(within(row).getByRole('button', { name: 'Try again' }));
    await vi.waitFor(() => expect(storageHandler.mock.calls.length).toBeGreaterThan(calls));
  });

  it('shows the quota numbers as readable text in the storage panel', async () => {
    useHandlers({ storage: storageStats({ usersApproachingQuota: 4 }) });
    renderWithProviders(<AdminDashboard />);
    const label = await screen.findByText('Users at 75–90% of quota');
    expect(label.parentElement).toHaveTextContent('4');
    // The old warning box set opacity on the whole box, fading its text too.
    expect(label.parentElement).not.toHaveStyle({ opacity: '0.15' });
  });
});

describe('AdminDashboard totals', () => {
  it('links each tile to its admin page, except messages', async () => {
    useHandlers();
    renderWithProviders(<AdminDashboard />);

    expect(await screen.findByRole('link', { name: 'Users: 1,234,567' })).toHaveAttribute('href', '/admin/users');
    expect(screen.getByRole('link', { name: 'Communities: 42' })).toHaveAttribute('href', '/admin/communities');
    expect(screen.getByRole('link', { name: 'Channels: 310' })).toHaveAttribute('href', '/admin/communities');
    expect(screen.getByRole('link', { name: 'Active invites: 3' })).toHaveAttribute('href', '/admin/invites');
    expect(screen.getByRole('link', { name: 'Banned users: 0' })).toHaveAttribute('href', '/admin/users?status=banned');
    expect(screen.queryByRole('link', { name: /^Messages/ })).not.toBeInTheDocument();
    expect(screen.getByText('Messages')).toBeInTheDocument();
  });

  it('shows counts from a million up in compact form, with the full value in the title', async () => {
    useHandlers();
    renderWithProviders(<AdminDashboard />);
    const value = await screen.findByTitle('1,234,567');
    expect(value).toHaveTextContent('1.2M');
    expect(screen.getByTitle('310')).toHaveTextContent('310');
  });
});
