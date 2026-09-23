import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { renderInEveryTheme } from '../test-utils/themeMatrix';
import ListState, { ListSkeleton } from '../../components/Common/ListState';

const mockUseResponsive = vi.fn(() => ({ shouldUseTouchUI: false }));
vi.mock('../../hooks/useResponsive', () => ({
  useResponsive: () => mockUseResponsive(),
}));

const children = <ul data-testid="the-list"><li>row</li></ul>;
const empty = <div data-testid="the-empty">Nothing here</div>;

describe('ListState', () => {
  beforeEach(() => {
    mockUseResponsive.mockReset();
    mockUseResponsive.mockReturnValue({ shouldUseTouchUI: false });
  });

  it('renders the skeleton (default) while loading, not the empty state or children', () => {
    renderWithProviders(
      <ListState isLoading isEmpty empty={empty}>{children}</ListState>,
    );
    expect(screen.getByRole('progressbar', { name: /loading/i })).toBeInTheDocument();
    expect(screen.queryByTestId('the-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('the-list')).not.toBeInTheDocument();
  });

  it('renders a custom skeleton when given one', () => {
    renderWithProviders(
      <ListState isLoading isEmpty skeleton={<div data-testid="custom-skel" />}>{children}</ListState>,
    );
    expect(screen.getByTestId('custom-skel')).toBeInTheDocument();
  });

  it('renders an error with a working retry button instead of the empty copy', async () => {
    const onRetry = vi.fn();
    const { user } = renderWithProviders(
      <ListState
        isLoading={false}
        error={new Error('boom')}
        onRetry={onRetry}
        isEmpty
        empty={empty}
        errorTitle="Couldn't load conversations"
      >
        {children}
      </ListState>,
    );
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText("Couldn't load conversations")).toBeInTheDocument();
    expect(screen.queryByTestId('the-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('the-list')).not.toBeInTheDocument();

    await user.click(within(alert).getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('omits the retry button when no onRetry is given', () => {
    renderWithProviders(
      <ListState isLoading={false} error={new Error('boom')} isEmpty>{children}</ListState>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('keeps showing stale data when a refetch fails but data is present', () => {
    renderWithProviders(
      <ListState isLoading={false} error={new Error('boom')} isEmpty={false}>{children}</ListState>,
    );
    expect(screen.getByTestId('the-list')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders the empty node when loaded with no items', () => {
    renderWithProviders(
      <ListState isLoading={false} isEmpty empty={empty}>{children}</ListState>,
    );
    expect(screen.getByTestId('the-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('the-list')).not.toBeInTheDocument();
  });

  it('renders children when loaded with items', () => {
    renderWithProviders(
      <ListState isLoading={false} isEmpty={false} empty={empty}>{children}</ListState>,
    );
    expect(screen.getByTestId('the-list')).toBeInTheDocument();
    expect(screen.queryByTestId('the-empty')).not.toBeInTheDocument();
  });

  it('gives the retry button a 44px touch target on touch layouts', () => {
    mockUseResponsive.mockReturnValue({ shouldUseTouchUI: true });
    renderWithProviders(
      <ListState isLoading={false} error={new Error('x')} onRetry={() => {}} isEmpty size="compact">
        {children}
      </ListState>,
    );
    const button = screen.getByRole('button', { name: /try again/i });
    expect(getComputedStyle(button).minHeight).toBe('44px');
  });

  it('renders every branch under all theme modes and intensities', () => {
    for (const props of [
      { isLoading: true, isEmpty: true },
      { isLoading: false, isEmpty: true, error: new Error('x'), onRetry: () => {} },
      { isLoading: false, isEmpty: true, error: new Error('x'), onRetry: () => {}, size: 'compact' as const },
      { isLoading: false, isEmpty: true },
    ]) {
      renderInEveryTheme(() => (
        <ListState {...props} empty={empty}>{children}</ListState>
      ));
    }
    renderInEveryTheme(() => <ListSkeleton rows={3} avatarSize={0} />);
  });
});
