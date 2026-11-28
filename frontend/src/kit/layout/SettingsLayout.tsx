import { useRef, type JSX, type ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { useToastClearance } from '../behaviour/hosts/toasts';
import { IconButton } from '../controls/IconButton';
import { Island } from '../surfaces/Island';
import { kitTheme } from '../theme/KitProvider';
import { transientProps } from '../theme/transientProps';
import { Text } from '../typography/Text';
import { atMedia, media, useWidthRange } from './breakpoints';
import { Pane } from './Pane';
import { isPresent } from './present';
import { useFollowFocus } from './useFollowFocus';
import { useKeyboardInset } from './useKeyboardInset';
import { CallSlot, DockSlot, leftColumnGrid, phoneColumnGrid } from './leftColumnGrid';

export interface SettingsLayoutProps {
  /** The page's heading: shown on the nav island (and on the content pane's header on a phone), and names the main. */
  title: string;
  /** The list of sections, usually ListRows. */
  nav: ReactNode;
  /** Names the navigation landmark. */
  navLabel: string;
  /** The section being edited. */
  children: ReactNode;
  /** Which pane a phone shows. */
  phonePane?: 'nav' | 'content';
  /** Called by the Back button on a phone's content pane. Required: a phone has no other way back to the list. */
  onBack: () => void;
  /** A bar pinned to the bottom of the content island, such as "unsaved changes". */
  footer?: ReactNode;
  /** A kit Dock. Above the nav island at compact and wide, the bar at the bottom of a phone (left out while the keyboard is up). */
  dock?: ReactNode;
  /** Stays at the foot of the nav island while the rest of it scrolls (the user's own card). */
  navFooter?: ReactNode;
  /**
   * The persistent in-call strip, as in ThreeIslands: at compact and wide under the nav island, at the bottom of the
   * left column; on a phone between the shown pane and the dock bar, whichever pane shows.
   */
  callBar?: ReactNode;
}

interface GridProps {
  $dock: boolean;
  $call: boolean;
  $keyboard: boolean;
}

/** Written from the compact range up, as ThreeIslands' grid. */
const Grid = styled('div', { shouldForwardProp: transientProps })<GridProps>(({ $dock, $call, $keyboard }) => ({
  flex: '1 1 0',
  minWidth: 0,
  minHeight: 0,
  display: 'grid',
  gap: `${tokens.layout.gutter}px`,
  // A size container: the call slot's video is capped against the height this grid really has, in `cqh`.
  containerType: 'size',
  ...leftColumnGrid({ dock: $dock, call: $call, column: 'nav', rest: ['content'], restColumns: ['minmax(0, 1fr)'] }),
  [atMedia(media.phone)]: phoneColumnGrid({ dock: $dock, call: $call, keyboard: $keyboard }),
}));

const PhonePane = styled(Pane)({ [atMedia(media.phone)]: { gridArea: 'pane' } });

const Column = styled('div')({
  flex: '1 1 auto',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
});

const NavBody = styled('div')({ marginTop: `${tokens.space.sm}px` });

const Header = styled('div')({
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  gap: `${tokens.space.md}px`,
  minHeight: `${tokens.control.md + 2 * tokens.space.lg}px`,
  boxSizing: 'border-box',
  padding: `0 ${tokens.space.lg}px`,
});

/** Under the phone header the content starts close to it; as the island's first row it needs the island's own room above. */
const Body = styled('div', { shouldForwardProp: transientProps })<{ $headed: boolean }>(({ $headed }) => ({
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  overscrollBehavior: 'contain',
  padding: `${$headed ? tokens.space.xs : tokens.space.xl}px ${tokens.space.xl}px ${tokens.space.xl}px`,
}));

const Footer = styled('div')(({ theme }) => ({
  flex: '0 0 auto',
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: `${tokens.space.sm}px`,
  padding: `${tokens.space.md}px ${tokens.space.xl}px`,
  borderTop: `${tokens.border.hairline}px solid ${kitTheme(theme).palette.hairline}`,
}));

/**
 * The settings screen: sections on the left, the section on the right.
 *
 * - wide and compact: a nav island (`tokens.layout.leftColumn` wide, a `nav` landmark headed by `title`)
 *   beside the content island (the `main`). `footer` is pinned to the bottom of the content island.
 * - phone: one pane (`phonePane`). The content pane has a header with a Back button. The other pane stays
 *   mounted but `hidden` and `inert`, so what was typed in it survives and nothing in it can be reached.
 *   While the nav pane is the one shown it sits in a `main`, so the page still has exactly one.
 * When the pane that holds focus stops being shown, focus moves to the pane now shown. A `footer` that is
 * `undefined`, `null`, `false` or `''` leaves no bar.
 * - The shell's pieces, as in ThreeIslands (same rows, same order): `dock` above the nav island and `callBar` under
 *   it at compact and wide; on a phone the shown pane, then the call bar, then the dock bar (left out while the
 *   on-screen keyboard is up). `navFooter` stays at the nav island's foot. The dock and the call bar are rebuilt when
 *   the width changes (they move); the nav and the content are not.
 * Render inside an `AppFrame`.
 */
export function SettingsLayout({
  title,
  nav,
  navLabel,
  children,
  phonePane = 'nav',
  onBack,
  footer,
  dock,
  navFooter,
  callBar,
}: SettingsLayoutProps): JSX.Element {
  const phone = useWidthRange() === 'phone';
  const keyboard = useKeyboardInset() > 0;
  const hasCall = isPresent(callBar);
  const hasDock = isPresent(dock) && !(phone && keyboard);
  const showNav = !phone || phonePane === 'nav';
  const showContent = !phone || phonePane === 'content';
  const navRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  useToastClearance(footerRef);
  useFollowFocus(
    { nav: navRef, content: contentRef },
    [...(showNav ? ['nav'] : []), ...(showContent ? ['content'] : [])],
    phone && phonePane === 'nav' ? 'nav' : 'content',
  );
  return (
    <Grid $dock={hasDock} $call={hasCall} $keyboard={keyboard}>
      {!phone && hasDock && <DockSlot data-slot="dock">{dock}</DockSlot>}
      <PhonePane
        ref={navRef}
        tabIndex={-1}
        $area="nav"
        hidden={!showNav}
        inert={!showNav}
        role={phone && showNav ? 'main' : undefined}
        data-kit-toast-anchor={phone && showNav ? '' : undefined}
      >
        <Island as="nav" label={navLabel} padding="md" scroll footer={isPresent(navFooter) ? navFooter : null}>
          <Text variant="title" as="h1">
            {title}
          </Text>
          <NavBody>{nav}</NavBody>
        </Island>
      </PhonePane>
      {!phone && hasCall && <CallSlot data-slot="call-bar">{callBar}</CallSlot>}
      <PhonePane
        ref={contentRef}
        tabIndex={-1}
        $area="content"
        hidden={!showContent}
        inert={!showContent}
        data-kit-toast-anchor={showContent ? '' : undefined}
      >
        <Island as="main" label={title} padding="none" scroll>
          <Column>
            {phone && (
              <Header>
                <IconButton icon="ArrowLeft" label="Back" variant="soft" onClick={onBack} />
                <Text variant="title" as="h1">
                  {title}
                </Text>
              </Header>
            )}
            <Body $headed={phone}>{children}</Body>
            {isPresent(footer) && (
              <Footer ref={footerRef} data-slot="footer">
                {footer}
              </Footer>
            )}
          </Column>
        </Island>
      </PhonePane>
      {phone && hasCall && <CallSlot data-slot="call-bar">{callBar}</CallSlot>}
      {phone && hasDock && <DockSlot data-slot="dock">{dock}</DockSlot>}
    </Grid>
  );
}
