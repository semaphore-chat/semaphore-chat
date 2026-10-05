import { SpanType, type Span } from '../../types/message.type';

/** A channel id no scenario contains: renders as "#private-channel". */
export const HIDDEN_CHANNEL_ID = '00000000-0000-4000-8000-00000000c0de';

export const channelMentionSpan = (channelId: string): Span => ({
  type: SpanType.CHANNEL_MENTION,
  channelId,
});
