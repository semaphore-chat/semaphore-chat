import type { JSX, ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { IconButton } from '../controls/IconButton';
import { Island } from '../surfaces/Island';
import { kitTheme } from '../theme/KitProvider';
import { transientProps } from '../theme/transientProps';
import { Text } from '../typography/Text';
import { atMedia, media, useWidthRange } from './breakpoints';
import { Pane } from './Pane';

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
  /** The Back button on a phone's content pane. */
  onBack?: () => void;
  /** A bar pinned to the bottom of the content island, such as "unsaved changes". */
  footer?: ReactNode;
}

const Grid = styled('div')({
  flex: '1 1 0',
  minWidth: 0,
  minHeight: 0,
  display: 'grid',
  gap: `${tokens.layout.gutter}px`,
  gridTemplateRows: 'minmax(0, 1fr)',
  gridTemplateColumns: `${tokens.layout.leftColumn}px minmax(0, 1fr)`,
  gridTemplateAreas: '"nav content"',
  [atMedia(media.phone)]: {
    gridTemplateColumns: 'minmax(0, 1fr)',
    gridTemplateAreas: '"pane"',
  },
});

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
}: SettingsLayoutProps): JSX.Element {
  const phone = useWidthRange() === 'phone';
  const showNav = !phone || phonePane === 'nav';
  const showContent = !phone || phonePane === 'content';
  return (
    <Grid>
      <PhonePane $area="nav" hidden={!showNav} inert={!showNav} role={phone && showNav ? 'main' : undefined}>
        <Island as="nav" label={navLabel} padding="md" scroll>
          <Text variant="title" as="h1">
            {title}
          </Text>
          <NavBody>{nav}</NavBody>
        </Island>
      </PhonePane>
      <PhonePane $area="content" hidden={!showContent} inert={!showContent}>
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
            {footer !== undefined && <Footer data-slot="footer">{footer}</Footer>}
          </Column>
        </Island>
      </PhonePane>
    </Grid>
  );
}
