import { useState, type JSX } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { mix } from '../theme/mix';
import { focusRing } from '../theme/states';
import { standOutFill, tintBase, useSurface, type Surface } from '../theme/onSurface';
import { transientProps } from '../theme/transientProps';
import { Icon } from '../display/Icon';
import { IMAGE_MAX } from './attachmentBox';
import { checkLink } from './messageSegments';
import { useRowTabIndex } from './rowTabScope';

export interface LinkCardProps {
  /** The page the card is about. Only an http or https address without a user name opens; anything else is plain. */
  href: string;
  /** The page's title (two lines at most). */
  title?: string;
  /** The site's name, or its host ("Example · Aiko"). One line. */
  site: string;
  /** The page's own summary (two lines at most). */
  description?: string;
  /**
   * The page's picture, drawn in a fixed 1.91:1 box (the shape link previews are made for), so a picture that loads
   * late never changes the card's height. Loaded lazily and without a Referer.
   */
  imageSrc?: string;
  /** The site's icon, beside its name. Loaded without a Referer. */
  iconSrc?: string;
}

/** The banner's shape: the 1.91:1 that link-preview images are made for. */
export const LINK_CARD_BANNER_RATIO = '1.91 / 1';

const look = ({ theme, $on }: { theme: Parameters<typeof kitTheme>[0]; $on: Surface }) => {
  const { palette } = kitTheme(theme);
  return {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: `${tokens.space.xs}px`,
    boxSizing: 'border-box' as const,
    width: '100%',
    maxWidth: `${IMAGE_MAX.width}px`,
    minWidth: 0,
    padding: `${tokens.space.sm}px ${tokens.space.md}px ${tokens.space.md}px`,
    borderRadius: `${tokens.radius.md}px`,
    borderInlineStart: `${tokens.border.selected}px solid ${palette.accent}`,
    background: standOutFill(palette, $on),
    color: palette.text,
    textDecoration: 'none',
    fontFamily: theme.typography.fontFamily,
    outline: 'none',
    '&:focus-visible': focusRing(palette, 0),
    '@media (hover: hover)': {
      '&:is(a):hover': { background: mix(palette.text, tintBase(palette, $on), tokens.state.hover) },
    },
  };
};

const Pressable = styled('a', { shouldForwardProp: transientProps })<{ $on: Surface }>(look);
const Plain = styled('div', { shouldForwardProp: transientProps })<{ $on: Surface }>(look);

const SiteLine = styled('span')(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: `${tokens.space.xs}px`,
  minWidth: 0,
  color: kitTheme(theme).palette.textSecondary,
  fontSize: `${tokens.text.small.size}px`,
  lineHeight: `${tokens.text.small.line}px`,
}));

const SiteName = styled('span')({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

const SiteIcon = styled('img')({
  flex: `0 0 ${tokens.icon.sm}px`,
  width: `${tokens.icon.sm}px`,
  height: `${tokens.icon.sm}px`,
  borderRadius: `${tokens.space.xs}px`,
  objectFit: 'contain',
});

const twoLines = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical' as const,
  overflow: 'hidden',
  overflowWrap: 'anywhere' as const,
};

const Title = styled('span')(({ theme }) => ({
  ...twoLines,
  color: kitTheme(theme).palette.accentText,
  fontSize: `${tokens.text.bodyStrong.size}px`,
  lineHeight: `${tokens.text.bodyStrong.line}px`,
  fontWeight: tokens.text.bodyStrong.weight,
}));

const Description = styled('span')(({ theme }) => ({
  ...twoLines,
  color: kitTheme(theme).palette.textSecondary,
  fontSize: `${tokens.text.meta.size}px`,
  lineHeight: `${tokens.text.meta.line}px`,
}));

const Banner = styled('span', { shouldForwardProp: transientProps })<{ $on: Surface }>(({ theme, $on }) => ({
  display: 'block',
  width: '100%',
  aspectRatio: LINK_CARD_BANNER_RATIO,
  marginTop: `${tokens.space.xs}px`,
  overflow: 'hidden',
  borderRadius: `${tokens.radius.sm}px`,
  background: mix(kitTheme(theme).palette.text, tintBase(kitTheme(theme).palette, $on), tokens.state.hover),
}));

const BannerImage = styled('img')({ display: 'block', width: '100%', height: '100%', objectFit: 'cover' });

/**
 * A link's preview under a message (MessageRow's `attachments`): the site, the page's title and summary, and its
 * picture. The whole card is one link that opens in a new tab (`noopener noreferrer`). Its pictures come from
 * other sites: both load without a Referer, the banner lazily in a box of fixed shape, and one that fails is left
 * out (the box stays empty, the card keeps its height).
 */
export function LinkCard({ href, title, site, description, imageSrc, iconSrc }: LinkCardProps): JSX.Element {
  const on = useSurface();
  const tabIndex = useRowTabIndex();
  const [iconFailed, setIconFailed] = useState(false);
  const [bannerFailed, setBannerFailed] = useState(false);
  const link = checkLink(href);
  const content = (
    <>
      <SiteLine>
        {iconSrc !== undefined && !iconFailed ? (
          <SiteIcon src={iconSrc} alt="" referrerPolicy="no-referrer" onError={() => setIconFailed(true)} />
        ) : (
          <Icon name="Link" size="sm" />
        )}
        <SiteName dir="auto">{site}</SiteName>
      </SiteLine>
      {title !== undefined && <Title dir="auto">{title}</Title>}
      {description !== undefined && <Description dir="auto">{description}</Description>}
      {imageSrc !== undefined && (
        <Banner $on={on}>
          {!bannerFailed && (
            <BannerImage
              src={imageSrc}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setBannerFailed(true)}
            />
          )}
        </Banner>
      )}
    </>
  );
  if (link === null) {
    return (
      <Plain $on={on} role="group" aria-label={title ?? site}>
        {content}
      </Plain>
    );
  }
  return (
    <Pressable
      $on={on}
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy="no-referrer"
      tabIndex={tabIndex}
      aria-label={`${title !== undefined ? `${title}, ${site}` : site}, opens in a new tab`}
    >
      {content}
    </Pressable>
  );
}
