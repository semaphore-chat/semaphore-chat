import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { PublicRoute } from '../../components/PublicRoute';
import { Route, Routes } from 'react-router-dom';
import { setAccessToken, clearTokens } from '../../utils/tokenService';

vi.mock('../../utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), dev: vi.fn(), info: vi.fn(), debug: vi.fn() },
  default: { warn: vi.fn(), error: vi.fn(), dev: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

/** Helper: create a fake JWT with a given exp */
function makeJwt(exp: number): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify({ exp, sub: 'user1' }));
  return `${header}.${body}.fakesig`;
}

function validToken() {
  return makeJwt(Math.floor(Date.now() / 1000) + 3600);
}

function expiredToken() {
  return makeJwt(Math.floor(Date.now() / 1000) - 60);
}

function renderPublicRoute(initialRoute = '/login') {
  return renderWithProviders(
    <Routes>
      <Route
        path="/login"
        element={
          <PublicRoute>
            <div data-testid="login-form">Login Form</div>
          </PublicRoute>
        }
      />
      <Route path="/" element={<div data-testid="home">Home</div>} />
    </Routes>,
    { routerProps: { initialEntries: [initialRoute] } },
  );
}

describe('PublicRoute', () => {
  beforeEach(() => {
    clearTokens();
    localStorage.clear();
  });

  it('renders children when no token is present', () => {
    renderPublicRoute();
    expect(screen.getByTestId('login-form')).toBeInTheDocument();
    expect(screen.queryByTestId('home')).not.toBeInTheDocument();
  });

  it('renders children when token is expired', () => {
    setAccessToken(expiredToken());
    renderPublicRoute();
    expect(screen.getByTestId('login-form')).toBeInTheDocument();
    expect(screen.queryByTestId('home')).not.toBeInTheDocument();
  });

  it('renders children when token is expiring within the 30s buffer', () => {
    const soonExp = Math.floor(Date.now() / 1000) + 10;
    setAccessToken(makeJwt(soonExp));
    renderPublicRoute();
    expect(screen.getByTestId('login-form')).toBeInTheDocument();
  });

  it('redirects to / when user has a valid (non-expired) token', () => {
    setAccessToken(validToken());
    renderPublicRoute();
    expect(screen.getByTestId('home')).toBeInTheDocument();
    expect(screen.queryByTestId('login-form')).not.toBeInTheDocument();
  });

  it('renders children when token is malformed (not a JWT)', () => {
    setAccessToken('not-a-jwt');
    renderPublicRoute();
    expect(screen.getByTestId('login-form')).toBeInTheDocument();
  });

});
