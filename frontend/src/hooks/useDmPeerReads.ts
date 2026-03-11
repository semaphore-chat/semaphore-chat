import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { readReceiptsControllerGetDmPeerReadsOptions } from '../api-client/@tanstack/react-query.gen';

export function useDmPeerReads(directMessageGroupId: string | undefined) {
  const { data: peerReads } = useQuery({
    ...readReceiptsControllerGetDmPeerReadsOptions({
      path: { directMessageGroupId: directMessageGroupId! },
    }),
    enabled: !!directMessageGroupId,
    staleTime: 60_000,
  });

  const peerWatermarks = useMemo(() => {
    if (!peerReads) return [];
    return peerReads.map((p) => ({
      userId: p.userId,
      lastReadAtMs: new Date(p.lastReadAt).getTime(),
    }));
  }, [peerReads]);

  const getReadByCount = useMemo(
    () => (sentAt: string): number => {
      const sentAtMs = new Date(sentAt).getTime();
      return peerWatermarks.filter((p) => p.lastReadAtMs >= sentAtMs).length;
    },
    [peerWatermarks],
  );

  const getReaderIds = useMemo(
    () => (sentAt: string): string[] => {
      const sentAtMs = new Date(sentAt).getTime();
      return peerWatermarks
        .filter((p) => p.lastReadAtMs >= sentAtMs)
        .map((p) => p.userId);
    },
    [peerWatermarks],
  );

  return { getReadByCount, getReaderIds };
}
