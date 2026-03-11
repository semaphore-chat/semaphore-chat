import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { ReadStatusIndicator } from '../../components/Message/ReadStatusIndicator';

describe('ReadStatusIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders blue eye icon', () => {
    renderWithProviders(<ReadStatusIndicator />);

    expect(screen.getByTestId('VisibilityIcon')).toBeInTheDocument();
  });

  it('returns null when showForDm is false', () => {
    const { container } = renderWithProviders(
      <ReadStatusIndicator showForDm={false} />
    );

    expect(container.innerHTML).toBe('');
  });

  it('shows tooltip with "Seen" text on hover', async () => {
    const { user } = renderWithProviders(<ReadStatusIndicator />);

    const icon = screen.getByTestId('VisibilityIcon');
    await user.hover(icon);

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Seen');
  });

  it('renders without tooltip when disableTooltip is true', async () => {
    const { user } = renderWithProviders(
      <ReadStatusIndicator disableTooltip={true} />
    );

    const icon = screen.getByTestId('VisibilityIcon');
    expect(icon).toBeInTheDocument();

    await user.hover(icon);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
