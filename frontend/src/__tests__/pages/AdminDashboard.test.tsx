import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import AdminDashboard from '../../pages/admin/AdminDashboard';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const failStats = (status: number) =>
  server.use(
    http.get('http://localhost:3000/api/instance/stats', () =>
      HttpResponse.json({ statusCode: status, message: 'x' }, { status }),
    ),
  );

describe('AdminDashboard load failures', () => {
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
