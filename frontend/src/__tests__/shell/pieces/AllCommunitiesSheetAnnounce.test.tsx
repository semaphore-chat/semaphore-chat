/**
 * Filter results are announced politely (review I3): the count when the list narrows, "No community called x" when
 * nothing matches; once typing pauses, not on every key. The kit's `useAnnounce` is wrapped to record the calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { screen, waitFor } from '@testing-library/react';
import { renderWithKit } from '../../test-utils/renderWithKit';
import { AllCommunitiesSheet } from '../../../shell/lounge/pieces/AllCommunitiesSheet';
import { FILTER_ANNOUNCE_DELAY_MS, filterAnnouncement } from '../../../shell/lounge/pieces/communitiesModel';
import { fixedLoad, sampleCommunities } from '../../../stories/fixtures/loungeCommunities';

const said = vi.hoisted(() => [] as { text: string; politeness: string | undefined }[]);
vi.mock('../../../kit', async (importOriginal) => {
  const kit = await importOriginal<typeof import('../../../kit')>();
  const record = (text: string, politeness?: string) => said.push({ text, politeness });
  return { ...kit, useAnnounce: () => record };
});

const useReady = fixedLoad('ready');

function Harness({ count }: { count: number }) {
  const [filter, setFilter] = useState('');
  return (
    <AllCommunitiesSheet
      open
      onClose={() => undefined}
      instanceName="moss.social"
      username="alexk"
      communities={sampleCommunities(count)}
      currentId="c-1"
      canCreate
      useLoad={useReady}
      filter={filter}
      onFilterChange={setFilter}
      showSettings={false}
    />
  );
}

beforeEach(() => {
  said.length = 0;
});

describe('filter announcements', () => {
  it('words: the count, one community, no match', () => {
    expect(filterAnnouncement('lan', 3)).toBe('3 communities');
    expect(filterAnnouncement('lan', 1)).toBe('1 community');
    expect(filterAnnouncement('zebra', 0)).toBe('No community called “zebra”');
  });

  it('says the narrowed count once typing pauses, politely, once per pause (not per key)', async () => {
    const { user } = renderWithKit(<Harness count={24} />);
    const field = await screen.findByRole('searchbox', { name: 'Find a community' });
    await user.type(field, 'lan');
    expect(said).toEqual([]);
    await waitFor(() => expect(said).toEqual([{ text: '2 communities', politeness: undefined }]), {
      timeout: FILTER_ANNOUNCE_DELAY_MS + 1000,
    });
  });

  it('says "No community called x" when nothing matches, and nothing for an empty field', async () => {
    const { user } = renderWithKit(<Harness count={12} />);
    const field = await screen.findByRole('searchbox', { name: 'Find a community' });
    await user.type(field, 'zebra');
    await waitFor(() => expect(said.map((entry) => entry.text)).toEqual(['No community called “zebra”']), {
      timeout: FILTER_ANNOUNCE_DELAY_MS + 1000,
    });
    await user.clear(field);
    await new Promise((resolve) => setTimeout(resolve, FILTER_ANNOUNCE_DELAY_MS + 100));
    expect(said).toHaveLength(1);
  });
});
