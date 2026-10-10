import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import AdminUsersPage from '../../pages/admin/AdminUsersPage';
import AdminStoragePage from '../../pages/admin/AdminStoragePage';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const API = 'http://localhost:3000/api';

function captureUsersQuery() {
  const seen: URLSearchParams[] = [];
  server.use(
    http.get(`${API}/users/admin/list`, ({ request }) => {
      seen.push(new URL(request.url).searchParams);
      return HttpResponse.json({ users: [], continuationToken: undefined });
    }),
    http.get(`${API}/roles/instance/all`, () => HttpResponse.json([])),
  );
  return seen;
}

function captureStorageQuery() {
  const seen: URLSearchParams[] = [];
  server.use(
    http.get(`${API}/storage/users`, ({ request }) => {
      seen.push(new URL(request.url).searchParams);
      return HttpResponse.json({ users: [], total: 0 });
    }),
  );
  return seen;
}

describe('admin deep links from the dashboard', () => {
  it('?status=banned preselects the banned filter on the users page', async () => {
    const seen = captureUsersQuery();
    renderWithProviders(<AdminUsersPage />, { routerProps: { initialEntries: ['/admin/users?status=banned'] } });
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0].get('banned')).toBe('true');
  });

  it('without a status the users page shows everyone', async () => {
    const seen = captureUsersQuery();
    renderWithProviders(<AdminUsersPage />, { routerProps: { initialEntries: ['/admin/users?status=bogus'] } });
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0].has('banned')).toBe(false);
  });

  it('?minPercent=90 preselects the usage filter on the storage page', async () => {
    const seen = captureStorageQuery();
    renderWithProviders(<AdminStoragePage />, { routerProps: { initialEntries: ['/admin/storage?minPercent=90'] } });
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0].get('minPercentUsed')).toBe('90');
    expect(await screen.findByDisplayValue('90')).toBeInTheDocument();
  });

  it('ignores a non-numeric minPercent', async () => {
    const seen = captureStorageQuery();
    renderWithProviders(<AdminStoragePage />, { routerProps: { initialEntries: ['/admin/storage?minPercent=abc'] } });
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0].has('minPercentUsed')).toBe(false);
  });
});
