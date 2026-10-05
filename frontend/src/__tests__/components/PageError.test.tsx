import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import PageError from '../../components/Common/PageError';
import { COMMUNITY_ERROR_COPY } from '../../utils/pageError';

describe('PageError', () => {
  it('403: no-access message, Go home, no retry', () => {
    renderWithProviders(<PageError error={{ statusCode: 403 }} copy={COMMUNITY_ERROR_COPY} onRetry={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent("You don't have access to this community");
    expect(screen.getByRole('button', { name: 'Go home' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('404: not-found message, no retry', () => {
    renderWithProviders(<PageError error={{ statusCode: 404 }} copy={COMMUNITY_ERROR_COPY} onRetry={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('This community no longer exists');
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('500: server message with a working Try again', async () => {
    const onRetry = vi.fn();
    const { user } = renderWithProviders(
      <PageError error={{ statusCode: 500 }} copy={COMMUNITY_ERROR_COPY} onRetry={onRetry} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this community");
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
