/**
 * The community home's centre (design §3 PR 10e, finding 3). At compact and wide the community's list is beside the
 * centre, so an empty centre would be a dead island: as the old shell (`pages/CommunityPage.tsx`), the home replaces
 * itself with the remembered text channel, else the first one by position (`utils/lastChannel`). A phone's home is the
 * list itself, and the centre pane stays mounted there while hidden, so at phone width this never navigates.
 *
 * With no text channel to open it says so; while the list loads (or fails: the left island shows that) it is empty.
 */
import { useEffect, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChatPane, Stack, Text, useWidthRange } from '../../../kit';
import { useCommunityChannels } from '../../../data/channels';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { getLastChannelId, pickInitialChannel } from '../../../utils/lastChannel';
import { useLoungeLinks } from '../links';
import type { LoungeScreenProps } from '../screen';

export function CommunityRedirect({ params }: LoungeScreenProps): JSX.Element | null {
  const communityId = params.communityId ?? '';
  const range = useWidthRange();
  const navigate = useNavigate();
  const links = useLoungeLinks();
  const { user } = useCurrentUser();
  const userId = user?.id;
  const { all, status } = useCommunityChannels(communityId);
  const wanted = range !== 'phone' && status === 'success' && userId !== undefined;
  const target = wanted ? pickInitialChannel(all, getLastChannelId(userId, communityId)) : null;
  const targetHref = target === null ? null : links.channel(communityId, target.id);

  useEffect(() => {
    if (targetHref !== null) navigate(targetHref.replace(/^#/, ''), { replace: true });
  }, [targetHref, navigate]);

  if (!wanted || target !== null) return null;
  // In a ChatPane's state region: the room around it a chat's own empty state has.
  return (
    <ChatPane
      state={
        <Stack gap="xs">
          <Text variant="title" as="h1">
            No text channels yet
          </Text>
          <Text tone="secondary">Pick a voice room from the list, or come back when a text channel is added.</Text>
        </Stack>
      }
    />
  );
}
