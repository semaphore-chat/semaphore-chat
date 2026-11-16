/**
 * RouteFocus on Back inside the new shell (design B6): a history pop to a route whose row was remembered focuses
 * that row (as on entry from the old shell); a push to it does not.
 */
import { useRef, type JSX } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import { KitProvider } from '../../kit';
import { RouteFocus } from '../../shell/lounge/frame/RouteFocus';
import { LOUNGE_ROW_ATTRIBUTE, forgetRouteMemory, rememberActivatedRow } from '../../shell/routeMemory';

let go: NavigateFunction = () => undefined;

function Frame(): JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  go = useNavigate();
  return (
    <div ref={root}>
      <nav aria-label="Community">
        <a href="#/home/lobby" {...{ [LOUNGE_ROW_ATTRIBUTE]: 'lobby' }}>
          lobby
        </a>
      </nav>
      <main>
        <h1>{pathname}</h1>
        <button type="button">Back</button>
      </main>
      <RouteFocus rootRef={root} pathname={pathname} title={pathname} />
    </div>
  );
}

function setup() {
  return render(
    <KitProvider base="#8E75FF" mode="dark" intensity="minimal">
      <MemoryRouter initialEntries={['/home']}>
        <Frame />
      </MemoryRouter>
    </KitProvider>,
  );
}

describe('RouteFocus: Back to a remembered row', () => {
  beforeEach(() => forgetRouteMemory());

  it('a history pop back to the route focuses its remembered row', () => {
    setup();
    rememberActivatedRow('/home', 'lobby');
    act(() => go('/home/lobby'));
    screen.getByRole('button', { name: 'Back' }).focus();
    act(() => go(-1));
    expect(screen.getByRole('link', { name: 'lobby' })).toHaveFocus();
  });

  it('a push to the same route focuses its heading instead', () => {
    setup();
    rememberActivatedRow('/home', 'lobby');
    act(() => go('/home/lobby'));
    screen.getByRole('button', { name: 'Back' }).focus();
    act(() => go('/home'));
    expect(screen.getByRole('heading', { name: '/home' })).toHaveFocus();
  });
});
