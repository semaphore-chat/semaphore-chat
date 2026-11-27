/**
 * MessageSpan Component
 *
 * Renders individual message spans with appropriate styling.
 * Supports mentions (user, special, community, alias) and plain text.
 */

import React, { useState } from "react";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Span, SpanType } from "../../types/message.type";
import type { CustomEmojiDto } from "../../api-client/types.gen";
import { getFileUrl } from "../../utils/fileHelpers";
import { useNavigate } from "react-router-dom";
import { useChannelMentionTarget } from "../../hooks/useChannelMentionTarget";
import { checkLink, stripBidi, stripBidiOverrides, stripUnpairedBidi } from "../../kit";

/**
 * A left-to-right isolate: a link label draws as written, whatever precedes it
 * in the line, and cannot reorder the text around it.
 */
const Isolate: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <bdi dir="ltr" style={{ unicodeBidi: "isolate" }}>
    {children}
  </bdi>
);

/** What a #channel mention shows when the reader can't see the channel. */
export const HIDDEN_CHANNEL_MENTION_LABEL = "#private-channel";

/**
 * A #channel mention. The span stores only the channel id (no name, so
 * hidden channel names never leak): the name comes from the reader's own
 * visible channels. Visible channel: a link to it. Otherwise a muted,
 * non-interactive "#private-channel".
 */
const ChannelMention: React.FC<{ channelId?: string | null }> = ({ channelId }) => {
  const theme = useTheme();
  const navigate = useNavigate();
  const channel = useChannelMentionTarget(channelId);

  // The chip is its own isolate, taking its direction from its own name: its
  // sign stays at the name's start, and a chip that wraps keeps its edges.
  const chipStyle: React.CSSProperties = {
    unicodeBidi: "isolate",
    fontWeight: 600,
    borderRadius: 4,
    padding: "0 2px",
  };

  if (!channel) {
    return (
      <span
        data-testid="channel-mention-hidden"
        dir="auto"
        title="You don't have access to this channel"
        style={{ ...chipStyle, color: theme.palette.text.secondary, fontStyle: "italic" }}
      >
        {HIDDEN_CHANNEL_MENTION_LABEL}
      </span>
    );
  }

  return (
    <a
      href={`/community/${channel.communityId}/channel/${channel.id}`}
      data-testid="channel-mention"
      dir="auto"
      onClick={(e) => {
        e.preventDefault();
        navigate(`/community/${channel.communityId}/channel/${channel.id}`);
      }}
      style={{
        ...chipStyle,
        color: theme.palette.primary.light,
        backgroundColor: theme.palette.action.hover,
        textDecoration: "none",
        cursor: "pointer",
      }}
    >
      #{stripBidiOverrides(channel.name)}
    </a>
  );
};

export interface MessageSpanProps {
  span: Span;
  index: number;
  /** Community custom emojis, keyed by id — resolves EMOJI spans to images. */
  emojiById?: Map<string, CustomEmojiDto>;
}

/**
 * Inline custom-emoji image with graceful fallback: if the emoji is unknown
 * (e.g. deleted) or the image fails to load, the `:shortcode:` text is shown.
 */
const EmojiImage: React.FC<{ emoji: CustomEmojiDto; fallback: string }> = ({
  emoji,
  fallback,
}) => {
  const [failed, setFailed] = useState(false);
  const src = getFileUrl(emoji.fileId);
  if (failed || !src) return <>{stripBidiOverrides(fallback)}</>;
  return (
    <img
      src={src}
      alt={`:${emoji.name}:`}
      title={`:${emoji.name}:`}
      onError={() => setFailed(true)}
      style={{
        height: "1.375em",
        width: "auto",
        verticalAlign: "-0.3em",
        margin: "0 1px",
        objectFit: "contain",
      }}
    />
  );
};

/**
 * Render a single message span with type-specific styling
 */
export const MessageSpan: React.FC<MessageSpanProps> = ({ span, index, emojiById }) => {
  const theme = useTheme();

  switch (span.type) {
    case SpanType.EMOJI: {
      const emoji = span.emojiId ? emojiById?.get(span.emojiId) : undefined;
      if (!emoji) {
        // Unknown/deleted emoji — render the literal shortcode.
        return <span key={index}>{stripBidiOverrides(span.text || "")}</span>;
      }
      return (
        <span key={index}>
          <EmojiImage emoji={emoji} fallback={span.text || `:${emoji.name}:`} />
        </span>
      );
    }
    case SpanType.USER_MENTION:
      return (
        <span key={index} dir="auto" style={{ color: theme.palette.primary.main, fontWeight: 600, unicodeBidi: "isolate" }}>
          {stripBidiOverrides(span.text || span.userId || "")}
        </span>
      );
    case SpanType.SPECIAL_MENTION:
      return (
        <span key={index} dir="auto" style={{ color: theme.palette.semantic.status.positive, fontWeight: 600, unicodeBidi: "isolate" }}>
          @{stripBidiOverrides(span.specialKind ?? "")}
        </span>
      );
    case SpanType.COMMUNITY_MENTION:
      return (
        <span key={index} dir="auto" style={{ color: theme.palette.primary.light, fontWeight: 600, unicodeBidi: "isolate" }}>
          {stripBidiOverrides(span.text || span.communityId || "")}
        </span>
      );
    case SpanType.CHANNEL_MENTION:
      return <ChannelMention key={index} channelId={span.channelId} />;
    case SpanType.ALIAS_MENTION:
      return (
        <span key={index} dir="auto" style={{ color: theme.palette.warning.main, fontWeight: 600, unicodeBidi: "isolate" }}>
          {stripBidiOverrides(span.text || span.aliasId || "")}
        </span>
      );
    case SpanType.CODE_BLOCK:
      return (
        <Box
          component="pre"
          key={index}
          // MessageComponent lets it grow past the text cap on wide columns
          // (CODE_BLOCK_MAX_WIDTH); sx (a class, not an inline style) so it can.
          className="message-code-block"
          sx={{
            margin: '4px 0',
            padding: '8px 12px',
            borderRadius: '6px',
            backgroundColor: theme.palette.action.hover,
            border: `1px solid ${theme.palette.divider}`,
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
            fontSize: '0.85em',
            whiteSpace: 'pre-wrap',
            overflowX: 'auto',
            wordBreak: 'break-word',
          }}
        >
          <code>{stripUnpairedBidi(span.text ?? "")}</code>
        </Box>
      );
    case SpanType.PLAINTEXT:
    default: {
      let content: React.ReactNode;

      if (span.code) {
        // Inline code is verbatim: no auto-linking or further parsing.
        content = (
          <code
            style={{
              padding: '1px 5px',
              borderRadius: 4,
              backgroundColor: theme.palette.action.hover,
              border: `1px solid ${theme.palette.divider}`,
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
              fontSize: '0.85em',
            }}
          >
            {stripUnpairedBidi(span.text ?? "")}
          </code>
        );
      } else {
        // Split text into segments: plain text and URLs (auto-link).
        const urlPattern = /(https?:\/\/[^\s<>)"']*[^\s<>)"'.,!?;:])/g;
        const parts = stripUnpairedBidi(span.text ?? "").split(urlPattern);

        content = parts.map((part, i) => {
          if (!/^https?:\/\//.test(part)) return <React.Fragment key={i}>{part}</React.Fragment>;
          // The same check as the kit: an address with a user name or password is drawn as text, and a link
          // shows the parsed address (punycode host), not what was typed.
          const link = checkLink(part);
          if (link === null) return <Isolate key={i}>{stripBidi(part)}</Isolate>;
          return (
            <a
              key={i}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: theme.palette.primary.main, textDecoration: 'underline' }}
            >
              <Isolate>{link.label}</Isolate>
            </a>
          );
        });
      }

      // Compose the inline-formatting flags by nesting wrappers.
      if (span.strikethrough) content = <s>{content}</s>;
      if (span.italic) content = <em>{content}</em>;
      if (span.bold) content = <strong>{content}</strong>;

      return <span key={index}>{content}</span>;
    }
  }
};

/**
 * Render an array of message spans
 */
// eslint-disable-next-line react-refresh/only-export-components
export const renderMessageSpans = (
  spans: Span[],
  emojiById?: Map<string, CustomEmojiDto>,
): React.ReactNode => {
  return spans.map((span, idx) => (
    <MessageSpan key={idx} span={span} index={idx} emojiById={emojiById} />
  ));
};
