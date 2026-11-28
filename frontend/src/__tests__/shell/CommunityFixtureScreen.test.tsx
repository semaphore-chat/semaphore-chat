/**
 * The community fixture's placeholder centre: the community's name as the heading, one line, and a
 * Members button only while the members are not shown beside it (below wide they are a Sheet).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { renderWithKit } from '../test-utils/renderWithKit';
import { NO_SCREEN_CHROME, ScreenChromeContext, type LoungeScreenProps } from '../../shell/lounge/screen';
import fixture from '../../shell/lounge/screens/CommunityFixtureScreen';

vi.mock('../../data/communities', () => ({
  useCommunity: (id: string) => ({ community: { id, name: 'Couch Co-op', avatarFileId: null }, status: 'success', error: null, refetch: () => undefined }),
}));

const Centre = (fixture.template === 'threeIslands' ? fixture.Centre : null) as ComponentType<LoungeScreenProps>;

describe('the community fixture centre', () => {
  it('below wide (members closed) offers Members, which opens them', async () => {
    const setRightOpen = vi.fn();
    const { user } = renderWithKit(
      <ScreenChromeContext value={{ ...NO_SCREEN_CHROME, rightOpen: false, setRightOpen }}>
        <Centre params={{ communityId: 'c-1' }} />
      </ScreenChromeContext>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Couch Co-op' })).toBeInTheDocument();
    expect(screen.getByText('Pick a channel or a room on the left.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Members' }));
    expect(setRightOpen).toHaveBeenCalledWith(true);
  });

  it('with the members beside it, no Members button', () => {
    renderWithKit(
      <ScreenChromeContext value={{ ...NO_SCREEN_CHROME, rightOpen: true, setRightOpen: () => undefined }}>
        <Centre params={{ communityId: 'c-1' }} />
      </ScreenChromeContext>,
    );
    expect(screen.queryByRole('button', { name: 'Members' })).toBeNull();
  });
});
