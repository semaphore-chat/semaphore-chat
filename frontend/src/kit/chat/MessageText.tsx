import { useState, type JSX, type MouseEvent, type ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { mix } from '../theme/mix';
import { focusRing } from '../theme/states';
import { standOutFill, tintBase, useSurface, type Surface } from '../theme/onSurface';
import { transientProps } from '../theme/transientProps';
import { visuallyHidden } from '../theme/a11y';
import { checkLink, cleanSegments, internalHref, stripBidi, type MentionSegment, type MessageSegment, type SegmentStyle } from './messageSegments';
import { useRowTabIndex } from './rowTabScope';

export interface MessageTextProps {
  segments: readonly MessageSegment[];
  /**
   * A mention was pressed: a user mention becomes a button (open their profile), and a mention with `href` (a
   * channel) calls this instead of following the link on a plain click, so the app can route in place.
   */
  onMention?: (mention: MentionSegment) => void;
}

/**
 * The code font. The tokens name two families (heading, body) and no code face, so code uses the platform's own
 * monospace, as the browser and every OS ship one. The native kit picks its platform monospace the same way.
 */
const CODE_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

const Root = styled('div')(({ theme }) => {
  const { palette } = kitTheme(theme);
  const type = tokens.text.body;
  return {
    minWidth: 0,
    color: palette.text,
    fontFamily: theme.typography.fontFamily,
    fontSize: `${type.size}px`,
    lineHeight: `${type.line}px`,
    fontWeight: type.weight,
    // A message keeps its own line breaks, and an unbroken run (a long link, a key) wraps instead of overflowing.
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  };
});

const codeLook = (theme: Parameters<typeof kitTheme>[0], on: Surface) => {
  const { palette } = kitTheme(theme);
  return {
    fontFamily: CODE_FONT,
    fontSize: `${tokens.text.meta.size}px`,
    background: standOutFill(palette, on),
    color: palette.text,
    borderRadius: `${tokens.radius.sm}px`,
  };
};

const InlineCode = styled('code', { shouldForwardProp: transientProps })<{ $on: Surface }>(({ theme, $on }) => ({
  ...codeLook(theme, $on),
  padding: `0 ${tokens.space.xs}px`,
}));

const CodeBlock = styled('pre', { shouldForwardProp: transientProps })<{ $on: Surface }>(({ theme, $on }) => ({
  ...codeLook(theme, $on),
  display: 'block',
  margin: `${tokens.space.xs}px 0`,
  padding: `${tokens.space.sm}px ${tokens.space.md}px`,
  lineHeight: `${tokens.text.meta.line}px`,
  // Long lines wrap rather than scroll: a scrolling block would need its own Tab stop, and on a phone a sideways
  // scroll inside a vertical list is easy to miss.
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  '& code': { font: 'inherit' },
}));

const Link = styled('a')(({ theme }) => {
  const { palette } = kitTheme(theme);
  return {
    color: palette.accentText,
    textDecoration: 'underline',
    borderRadius: `${tokens.radius.sm}px`,
    '&:focus-visible': focusRing(palette, 0),
  };
});

interface MentionLookProps {
  $me: boolean;
  $unavailable: boolean;
  $on: Surface;
}

const mentionLook = ({ theme, $me, $unavailable, $on }: MentionLookProps & { theme: Parameters<typeof kitTheme>[0] }) => {
  const { palette } = kitTheme(theme);
  const under = tintBase(palette, $on);
  const tint = mix(palette.accent, under, tokens.state.hoverOnFill);
  return {
    display: 'inline',
    margin: 0,
    padding: `0 ${tokens.space['2xs']}px`,
    border: 'none',
    borderRadius: `${tokens.radius.sm}px`,
    font: 'inherit',
    fontWeight: tokens.text.bodyStrong.weight,
    textDecoration: 'none',
    // A mention never breaks across lines in the middle of a name unless it must.
    overflowWrap: 'anywhere' as const,
    ...($unavailable
      ? { background: 'transparent', color: palette.textDim, fontStyle: 'italic' }
      : $me
        ? { background: palette.accent, color: palette.onAccent }
        : { background: tint, color: palette.accentText }),
    '&:is(a, button)': { cursor: 'pointer' },
    '&:focus-visible': focusRing(palette, 0),
    '@media (hover: hover)': {
      '&:is(a, button):hover': {
        background: $me ? mix(palette.text, palette.accent, tokens.state.hoverOnFill) : mix(palette.accent, under, tokens.state.pressedOnFill),
      },
    },
  };
};

const mentionOptions = { shouldForwardProp: transientProps };
const MentionSpan = styled('span', mentionOptions)<MentionLookProps>(mentionLook);
const MentionLink = styled('a', mentionOptions)<MentionLookProps>(mentionLook);
const MentionButton = styled('button', mentionOptions)<MentionLookProps>(mentionLook);

const EmojiImage = styled('img')({
  // As tall as a line of body text, so a custom emoji sits in the line without changing its height.
  height: `${tokens.text.body.line}px`,
  width: 'auto',
  verticalAlign: 'bottom',
  objectFit: 'contain',
});

/**
 * A left-to-right isolate: what is inside never reorders with, or is reordered by, the text around it, so a link's
 * label and a mention draw as written whatever precedes them in the line.
 */
const Isolate = styled('bdi')({ unicodeBidi: 'isolate' });

const Hidden = styled('span')({ ...visuallyHidden });

function CustomEmoji({ name, src }: { name: string; src?: string }): JSX.Element {
  const [failed, setFailed] = useState(false);
  const shortcode = `:${name}:`;
  if (src === undefined || failed) return <span>{shortcode}</span>;
  return <EmojiImage src={src} alt={shortcode} title={shortcode} onError={() => setFailed(true)} />;
}

function Mention({
  segment,
  onMention,
  on,
  tabIndex,
}: {
  segment: MentionSegment;
  onMention: MessageTextProps['onMention'];
  on: Surface;
  tabIndex: -1 | undefined;
}): JSX.Element {
  const look = { $me: segment.me === true, $unavailable: segment.unavailable === true, $on: on };
  if (segment.unavailable === true) {
    return (
      <MentionSpan {...look}>
        <Isolate dir="ltr">{segment.text}</Isolate>
        <Hidden> (not available to you)</Hidden>
      </MentionSpan>
    );
  }
  const spokenMe = segment.me === true && segment.kind !== 'channel' ? <Hidden>, mentions you</Hidden> : null;
  // Only an app-internal address is followed; any other is drawn as a mention that is not a link.
  const href = segment.href === undefined ? null : internalHref(segment.href);
  if (href !== null) {
    const follow = (event: MouseEvent<HTMLAnchorElement>) => {
      // A plain click routes in place; a modified click (new tab, new window) is the browser's.
      if (onMention === undefined || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      onMention(segment);
    };
    return (
      <MentionLink {...look} href={href} onClick={follow} tabIndex={tabIndex}>
        <Isolate dir="ltr">{segment.text}</Isolate>
        {spokenMe}
      </MentionLink>
    );
  }
  if (onMention !== undefined && segment.kind === 'user') {
    return (
      <MentionButton {...look} type="button" onClick={() => onMention(segment)} tabIndex={tabIndex}>
        <Isolate dir="ltr">{segment.text}</Isolate>
        {spokenMe}
      </MentionButton>
    );
  }
  return (
    <MentionSpan {...look}>
      <Isolate dir="ltr">{segment.text}</Isolate>
      {spokenMe}
    </MentionSpan>
  );
}

/** Words with their inline formatting: strong, emphasis and strike-through, nested in that order. */
function withStyle(text: string, style: SegmentStyle): ReactNode {
  let content: ReactNode = text;
  if (style.strike === true) content = <s>{content}</s>;
  if (style.italic === true) content = <em>{content}</em>;
  if (style.bold === true) content = <strong>{content}</strong>;
  return content;
}

function renderSegment(
  segment: MessageSegment,
  key: number,
  onMention: MessageTextProps['onMention'],
  on: Surface,
  tabIndex: -1 | undefined,
): ReactNode {
  switch (segment.type) {
    case 'text':
      return <span key={key}>{withStyle(segment.text, segment)}</span>;
    case 'code':
      return (
        <InlineCode key={key} $on={on}>
          {segment.text}
        </InlineCode>
      );
    case 'codeBlock':
      return (
        <CodeBlock key={key} $on={on}>
          <code>{segment.text}</code>
        </CodeBlock>
      );
    case 'link': {
      // What is shown is always the address itself, as parsed: no masked links, no lookalike host, no bidi tricks.
      const link = checkLink(segment.href);
      if (link === null) return <Isolate key={key} dir="ltr">{withStyle(stripBidi(segment.href), segment)}</Isolate>;
      return (
        <Link key={key} href={link.href} target="_blank" rel="noopener noreferrer" tabIndex={tabIndex}>
          <Isolate dir="ltr">{withStyle(link.label, segment)}</Isolate>
        </Link>
      );
    }
    case 'mention':
      return <Mention key={key} segment={segment} onMention={onMention} on={on} tabIndex={tabIndex} />;
    case 'emoji':
      return <CustomEmoji key={key} name={segment.name} src={segment.src} />;
  }
}

/**
 * A message's words, drawn from pre-parsed segments: formatting, inline code and code blocks, links, mentions
 * and custom emoji. Pure: it holds no parsing and no data. `dir="auto"`, so a right-to-left message reads from
 * the right.
 */
export function MessageText({ segments, onMention }: MessageTextProps): JSX.Element {
  const on = useSurface();
  // In a message row Tab skips (not the list's focused row), the links and mentions are not Tab stops.
  const tabIndex = useRowTabIndex();
  return <Root dir="auto">{cleanSegments(segments).map((segment, index) => renderSegment(segment, index, onMention, on, tabIndex))}</Root>;
}
