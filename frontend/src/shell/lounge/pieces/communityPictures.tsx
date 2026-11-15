/**
 * One probe per community picture (see `useCommunityPictures`): each renders nothing and reports the
 * picture's address from `useAuthenticatedImage`.
 */
import { useEffect, type JSX } from 'react';
import { useAuthenticatedImage } from '../../../hooks/useAuthenticatedImage';

function PictureProbe({ id, fileId, onUrl }: { id: string; fileId: string; onUrl(id: string, url: string | null): void }): null {
  const { blobUrl } = useAuthenticatedImage(fileId);
  useEffect(() => {
    onUrl(id, blobUrl ?? null);
  }, [id, blobUrl, onUrl]);
  return null;
}

export function CommunityPictureProbes({
  communities,
  onUrl,
}: {
  communities: readonly { id: string; avatarFileId: string | null }[];
  onUrl(id: string, url: string | null): void;
}): JSX.Element {
  return (
    <>
      {communities.map((community) =>
        community.avatarFileId === null ? null : (
          <PictureProbe key={community.id} id={community.id} fileId={community.avatarFileId} onUrl={onUrl} />
        ),
      )}
    </>
  );
}
