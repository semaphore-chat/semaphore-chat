import type { JSX, ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';

export interface PanelPaneProps {
  /** The panel's header: its heading and Close. Stays at the top. */
  header: ReactNode;
  /** Under the header and also fixed: a search field, a scope switch. */
  top?: ReactNode;
  /** The panel's content. Fills what is left, and is the only part that scrolls. */
  children: ReactNode;
}

const Root = styled('div')({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  minWidth: 0,
});

/** The same padding as ChatPane's header, so a panel's Close lines up with a thread's. */
const Head = styled('div')({ flex: '0 0 auto', minWidth: 0, padding: `${tokens.space.sm}px ${tokens.space.sm}px ${tokens.space.xs}px` });

const Top = styled('div')({ flex: '0 0 auto', minWidth: 0, padding: `${tokens.space.xs}px ${tokens.space.sm}px ${tokens.space.sm}px` });

const Body = styled('div')({
  flex: '1 1 auto',
  minHeight: 0,
  minWidth: 0,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  padding: `0 ${tokens.space.sm}px ${tokens.space.sm}px`,
});

/**
 * A screen's right panel that fills its region (ThreeIslands `rightFill`, a filling Sheet below wide) and is not a
 * conversation: a header and an optional fixed part at the top, then a body that scrolls on its own, so the heading,
 * Close and a search field stay in view over a long list. The island has no padding in that mode; the pane brings it.
 */
export function PanelPane({ header, top, children }: PanelPaneProps): JSX.Element {
  return (
    <Root data-kit-panel-pane="">
      <Head>{header}</Head>
      {top !== undefined && <Top>{top}</Top>}
      <Body data-kit-panel-pane-body="">{children}</Body>
    </Root>
  );
}
