import type { JSX, ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { visuallyHidden } from '../theme/a11y';

export interface ChatPaneProps {
  /** The conversation's header: Back, its name, its buttons. Stays at the top. */
  header?: ReactNode;
  /** The message list. Fills what is left, and scrolls inside itself. */
  list?: ReactNode;
  /**
   * Shown in the list region in place of the list, centred with room around it: what the conversation is while it
   * has no list to show (skeleton rows, an empty channel, no access, an error with Try again).
   */
  state?: ReactNode;
  /** The typing line, floating at the bottom of the list region over the space the list keeps for it. */
  typing?: ReactNode;
  /** A `JumpToLatest`, floating over the bottom of the list region. */
  jump?: ReactNode;
  /** New messages the reader cannot see, said politely ("2 new messages from aiko"). Never shown. */
  announcement?: string;
  /** The composer, under the list. */
  composer?: ReactNode;
  /**
   * A second conversation over this one, filling the pane (a thread over its channel): usually its own `ChatPane`.
   * This one stays mounted underneath, so its scroll position, its list and its composer's draft are kept, but it is
   * hidden and inert: nothing in it can be seen, focused, clicked or announced until the cover goes.
   */
  cover?: ReactNode;
}

const Root = styled('div')({
  position: 'relative',
  height: '100%',
  minHeight: 0,
  minWidth: 0,
  overflow: 'hidden',
});

/** The conversation itself; under a cover it keeps its layout (and scroll) but is not seen. */
const Base = styled('div')({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  minWidth: 0,
  '&[inert]': { visibility: 'hidden' },
});

const Cover = styled('div')({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  minWidth: 0,
});

const Fixed = styled('div')({ flex: '0 0 auto', minWidth: 0 });

/** The header row: the island has no padding of its own, so the header brings the kit's. */
const Head = styled('div')({ flex: '0 0 auto', minWidth: 0, padding: `${tokens.space.sm}px ${tokens.space.sm}px ${tokens.space.xs}px` });

/** The list region: the positioned container the floating parts place themselves in. */
const ListRegion = styled('div')({
  position: 'relative',
  flex: '1 1 auto',
  minHeight: 0,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
});

const State = styled('div')({
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  padding: `${tokens.space.lg}px`,
});

const Typing = styled('div')({
  position: 'absolute',
  insetInline: 0,
  bottom: 0,
  pointerEvents: 'none',
});

const Live = styled('div')({ ...visuallyHidden });

/**
 * A conversation inside the centre island: header, the message list with its floating typing line and Jump to
 * latest, the composer. It owns the placement of the floating parts, so a screen never positions anything itself.
 * The list region gets the room the header and the composer leave; only the list scrolls. A `cover` (a thread)
 * fills the pane over the conversation, which stays mounted, hidden and inert underneath.
 */
export function ChatPane({ header, list, state, typing, jump, announcement, composer, cover }: ChatPaneProps): JSX.Element {
  const covered = cover !== undefined;
  return (
    <Root>
      <Base inert={covered || undefined} data-chat-pane-covered={covered || undefined}>
        {header !== undefined && <Head>{header}</Head>}
        <ListRegion>
          {state !== undefined ? <State>{state}</State> : list}
          {typing !== undefined && <Typing>{typing}</Typing>}
          {jump}
          <Live role="status" aria-live="polite" aria-atomic="true">
            {covered ? '' : (announcement ?? '')}
          </Live>
        </ListRegion>
        {composer !== undefined && <Fixed>{composer}</Fixed>}
      </Base>
      {covered && <Cover>{cover}</Cover>}
    </Root>
  );
}
