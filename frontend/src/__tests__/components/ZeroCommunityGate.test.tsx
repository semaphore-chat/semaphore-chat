import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import ZeroCommunityGate from '../../components/Home/ZeroCommunityGate';

let mockCommunities: { id: string; name: string }[] | undefined;
vi.mock('../../api-client/@tanstack/react-query.gen', () => ({
  communityControllerFindAllMineOptions: () => ({ queryKey: ['communities'], queryFn: async () => mockCommunities }),
}));
vi.mock('../../features/roles/useUserPermissions', () => ({ useCanPerformAction: () => false }));

describe('ZeroCommunityGate (phone/tablet "no community selected" pane)', () => {
  beforeEach(() => {
    mockCommunities = [];
  });

  it('shows the new-user next step to a user in no communities', async () => {
    renderWithProviders(<ZeroCommunityGate>pick a community</ZeroCommunityGate>);
    expect(await screen.findByTestId('new-user-next-step')).toBeInTheDocument();
    expect(screen.queryByText('pick a community')).not.toBeInTheDocument();
  });

  it('keeps the existing pane for a user with communities', async () => {
    mockCommunities = [{ id: 'c1', name: 'Gaming' }];
    renderWithProviders(<ZeroCommunityGate>pick a community</ZeroCommunityGate>);
    expect(await screen.findByText('pick a community')).toBeInTheDocument();
    expect(screen.queryByTestId('new-user-next-step')).not.toBeInTheDocument();
  });
});
