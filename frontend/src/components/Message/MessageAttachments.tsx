import React, { useState } from "react";
import { Box, styled } from "@mui/material";
import { AttachmentPreview } from "./AttachmentPreview";
import { ImageLightbox } from "./ImageLightbox";
import { useAuthenticatedFile } from "../../hooks/useAuthenticatedFile";
import { FileMetadata } from "../../types/message.type";
import { viewerImages } from "../../data/chat/messageRowModel";

const AttachmentsGrid = styled(Box)(({ theme }) => ({
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(min(250px, 100%), 1fr))",
  gap: theme.spacing(1),
  marginTop: theme.spacing(1),
}));

const SingleAttachmentContainer = styled(Box)(({ theme }) => ({
  marginTop: theme.spacing(1),
}));

interface MessageAttachmentsProps {
  attachments: FileMetadata[];
}

// Helper component to manage lightbox for images only
const ImageLightboxManager: React.FC<{
  fileId: string;
  onClose: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  hasNext?: boolean;
  hasPrevious?: boolean;
}> = ({ fileId, onClose, onNext, onPrevious, hasNext, hasPrevious }) => {
  const { blobUrl } = useAuthenticatedFile(fileId, {
    fetchBlob: true,
    fetchMetadata: false,
  });

  if (!blobUrl) return null;

  return (
    <ImageLightbox
      blobUrl={blobUrl}
      mediaType="image"
      onClose={onClose}
      onNext={onNext}
      onPrevious={onPrevious}
      hasNext={hasNext}
      hasPrevious={hasPrevious}
    />
  );
};

export const MessageAttachments: React.FC<MessageAttachmentsProps> = React.memo(({
  attachments,
}) => {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Filter image attachments for lightbox navigation (no API call needed!)
  const imageAttachments = React.useMemo(
    () => viewerImages(attachments),
    [attachments]
  );

  if (!attachments || attachments.length === 0) {
    return null;
  }

  const openLightbox = (metadata: FileMetadata) => {
    const imageIndex = imageAttachments.findIndex((a) => a.id === metadata.id);
    if (imageIndex !== -1) {
      setLightboxIndex(imageIndex);
    }
  };

  const closeLightbox = () => {
    setLightboxIndex(null);
  };

  const nextImage = () => {
    if (lightboxIndex !== null && lightboxIndex < imageAttachments.length - 1) {
      setLightboxIndex(lightboxIndex + 1);
    }
  };

  const previousImage = () => {
    if (lightboxIndex !== null && lightboxIndex > 0) {
      setLightboxIndex(lightboxIndex - 1);
    }
  };

  // Single attachment: show full width (up to max width)
  if (attachments.length === 1) {
    return (
      <>
        <SingleAttachmentContainer>
          <AttachmentPreview
            metadata={attachments[0]}
            onImageClick={() => openLightbox(attachments[0])}
          />
        </SingleAttachmentContainer>
        {lightboxIndex !== null && imageAttachments[lightboxIndex] && (
          <ImageLightboxManager
            fileId={imageAttachments[lightboxIndex].id}
            onClose={closeLightbox}
          />
        )}
      </>
    );
  }

  // Multiple attachments: show in grid
  return (
    <>
      <AttachmentsGrid>
        {attachments.map((metadata) => (
          <AttachmentPreview
            key={metadata.id}
            metadata={metadata}
            onImageClick={() => openLightbox(metadata)}
          />
        ))}
      </AttachmentsGrid>
      {lightboxIndex !== null && imageAttachments[lightboxIndex] && (
        <ImageLightboxManager
          fileId={imageAttachments[lightboxIndex].id}
          onClose={closeLightbox}
          onNext={nextImage}
          onPrevious={previousImage}
          hasNext={lightboxIndex < imageAttachments.length - 1}
          hasPrevious={lightboxIndex > 0}
        />
      )}
    </>
  );
}, (prev, next) =>
  prev.attachments?.length === next.attachments?.length &&
  (prev.attachments?.every((a, i) => a.id === next.attachments?.[i]?.id) ?? true)
);
