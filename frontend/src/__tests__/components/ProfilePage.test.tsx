import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import ProfilePage from '../../pages/ProfilePage';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

vi.mock('../../components/Profile/ClipLibrary', () => ({ ClipLibrary: () => <div /> }));

const renderProfile = () =>
  renderWithProviders(
    <Routes>
      <Route path="/profile/:userId" element={<ProfilePage />} />
    </Routes>,
    { routerProps: { initialEntries: ['/profile/user-9'] } },
  );

describe('ProfilePage states', () => {
  it('shows a layout-shaped skeleton while loading, not a spinner', async () => {
    server.use(
      http.get('http://localhost:3000/api/users/:id', async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    renderProfile();
    expect(await screen.findByRole('progressbar', { name: 'Loading profile' })).toBeInTheDocument();
  });

  it('404 shows the not-found state without a retry', async () => {
    server.use(
      http.get('http://localhost:3000/api/users/:id', () =>
        HttpResponse.json({ statusCode: 404, message: 'Not Found' }, { status: 404 }),
      ),
    );
    renderProfile();
    expect(await screen.findByRole('alert')).toHaveTextContent('This user does not exist');
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('500 shows a server error with Try again', async () => {
    server.use(
      http.get('http://localhost:3000/api/users/:id', () =>
        HttpResponse.json({ statusCode: 500, message: 'boom' }, { status: 500 }),
      ),
    );
    renderProfile();
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load this profile");
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
