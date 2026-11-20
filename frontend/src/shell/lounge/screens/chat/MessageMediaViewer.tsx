/**
 * A message's pictures, full size (the old chat's lightbox, on the kit's MediaViewer): the message's raster pictures
 * in order (`viewableImages`: the old lightbox's list, narrowed to the types the opener shows), the one showing fetched whole through the file cache (the old
 * lightbox's `useAuthenticatedFile`), and Download for it. Escape, Close and a press beside the picture close it;
 * focus returns to the picture that opened it.
 */
import { useEffect, useState, type JSX } from 'react';
import { MediaViewer } from '../../../../kit';
import { viewableImages, type AttachmentOpener } from '../../../../data/chat/useAttachmentOpener';
import { useAuthenticatedFile } from '../../../../hooks/useAuthenticatedFile';
import { downloadBlob } from '../../../../utils/format';
import type { Message } from '../../../../types/message.type';

export interface ViewerRequest {
  message: Message;
  /** The picture pressed. */
  fileId: string;
}

interface ViewerProps {
  request: ViewerRequest | null;
  /** The chat's opener: Download when the picture could not be loaded here (it fetches again and reports a failure). */
  opener: AttachmentOpener;
  onDone: () => void;
}

export function MessageMediaViewer({ request, opener, onDone }: ViewerProps): JSX.Element | null {
  if (request === null) return null;
  return <ViewerFor key={`${request.message.id}:${request.fileId}`} request={request} opener={opener} onDone={onDone} />;
}

function ViewerFor({ request, opener, onDone }: ViewerProps & { request: ViewerRequest }): JSX.Element {
  const images = viewableImages(request.message.attachments);
  const [index, setIndex] = useState(() => Math.max(0, images.findIndex((f) => f.id === request.fileId)));
  const [open, setOpen] = useState(true);
  const current = images[index];
  // Done once the viewer has closed (the overlay stack has handed focus back first).
  useEffect(() => {
    if (!open) onDone();
  }, [open, onDone]);
  const { blobUrl, error } = useAuthenticatedFile(current?.id ?? null, { fetchBlob: true, fetchMetadata: false });
  const items = images.map((file, i) => ({
    name: file.filename,
    ...(i === index ? { src: blobUrl ?? undefined, failed: !!error } : {}),
  }));
  return (
    <MediaViewer
      open={open}
      onClose={() => setOpen(false)}
      items={items}
      index={index}
      onIndexChange={setIndex}
      // Download is there from the start (no reflow), busy until the picture is in.
      onDownload={() => {
        if (!current) return;
        if (blobUrl) downloadBlob(blobUrl, current.filename);
        else if (error) opener.open({ id: current.id, name: current.filename, mimeType: current.mimeType ?? '' });
      }}
      downloading={!blobUrl && !error}
    />
  );
}
