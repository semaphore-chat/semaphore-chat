/**
 * The message wire types, generated from backend/openapi.json (see
 * src/generated). Regenerate them, don't edit them: the NestJS DTOs are the
 * source.
 */
import type {
  AttachmentDto,
  LinkPreviewDto,
  MessageDto,
  ReactionDto,
  SpanDto,
} from '../generated';

export { FileType, SpanType } from '../generated';

export type Span = SpanDto;
export type Reaction = ReactionDto;
export type FileMetadata = AttachmentDto;
export type LinkPreview = LinkPreviewDto;
export type Message = MessageDto;
