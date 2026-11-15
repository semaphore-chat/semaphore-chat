import { useId, useLayoutEffect, useRef, type JSX, type KeyboardEvent } from 'react';
import { useDescribedBy } from '../overlays/tooltipDescription';
import ButtonBase from '@mui/material/ButtonBase';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { focusRing, interactiveStates } from '../theme/states';
import { transientProps } from '../theme/transientProps';

export interface TabItem {
  id: string;
  label: string;
  count?: number;
  disabled?: boolean;
  /** The id of this tab's panel, rendered as `aria-controls`. */
  panelId?: string;
}

export interface TabsProps {
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Names the tablist. */
  label: string;
  variant?: 'underline' | 'segmented';
  fullWidth?: boolean;
  id?: string;
}

/**
 * The DOM id Tabs gives a tab: pass the `id` you gave Tabs and the tab's `id`,
 * so a panel can name itself with `aria-labelledby`.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function tabElementId(listId: string, tabId: string): string {
  return `${listId}-tab-${tabId}`;
}

type Variant = NonNullable<TabsProps['variant']>;

interface ListProps {
  $variant: Variant;
  $fullWidth: boolean;
}

const List = styled('div', {
  shouldForwardProp: transientProps,
})<ListProps>(({ theme, $variant, $fullWidth }) => {
  const { palette } = kitTheme(theme);
  const segmented = $variant === 'segmented';
  return {
    // Positioned so a tab's offsetLeft is measured from the list.
    position: 'relative',
    boxSizing: 'border-box',
    display: $fullWidth ? 'flex' : 'inline-flex',
    maxWidth: '100%',
    width: $fullWidth ? '100%' : undefined,
    // A long row scrolls inside the list instead of widening the page. The
    // scrollbar stays (thin): a mouse with only a vertical wheel needs it.
    overflowX: 'auto',
    scrollbarWidth: 'thin',
    ...(segmented
      ? {
          gap: `${tokens.space['2xs']}px`,
          padding: `${tokens.space.xs}px`,
          borderRadius: `${tokens.radius.full}px`,
          background: palette.fill,
        }
      : {
          gap: `${tokens.space.lg}px`,
          borderBottom: `${tokens.border.hairline}px solid ${palette.hairline}`,
        }),
  };
});

interface TabProps {
  $variant: Variant;
  $selected: boolean;
  $fullWidth: boolean;
}

const Tab = styled(ButtonBase, {
  shouldForwardProp: transientProps,
})<TabProps>(({ theme, $variant, $selected, $fullWidth }) => {
  const { palette } = kitTheme(theme);
  const segmented = $variant === 'segmented';
  const type = segmented ? tokens.text.meta : tokens.text.bodyStrong;

  const base = {
    position: 'relative',
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: `${tokens.space.sm}px`,
    flex: $fullWidth ? '1 1 0' : '0 0 auto',
    fontFamily: theme.typography.fontFamily,
    fontSize: `${type.size}px`,
    lineHeight: `${type.line}px`,
    fontWeight: tokens.text.bodyStrong.weight,
    textTransform: 'none',
    whiteSpace: 'nowrap',
    transition: `background-color ${tokens.motion.fast}ms`,
    '&:disabled': { opacity: tokens.state.disabled, pointerEvents: 'none' },
  } as const;

  if (segmented) {
    const onFill = $selected;
    const background = $selected ? palette.accent : 'transparent';
    const under = $selected ? palette.accent : palette.fill;
    return {
      ...base,
      height: `${tokens.control.sm}px`,
      padding: `0 ${tokens.space.lg}px`,
      border: 'none',
      borderRadius: `${tokens.radius.full}px`,
      background,
      color: $selected ? palette.onAccent : palette.textSecondary,
      ...interactiveStates({
        palette,
        under,
        hover: onFill ? tokens.state.hoverOnFill : tokens.state.hover,
        pressed: onFill ? tokens.state.pressedOnFill : tokens.state.pressed,
      }),
      // The ring sits outside, because the selected pill (the tab stop) is
      // accent-coloured and an inset focus-colour ring would not show on it.
      // The list's padding is focus width plus focus offset, so the scrolling
      // list does not clip it.
      '&:focus-visible': focusRing(palette),
    };
  }

  return {
    ...base,
    height: `${tokens.control.md}px`,
    padding: `0 ${tokens.space.xs}px`,
    border: 'none',
    borderBottom: `${tokens.border.selected}px solid ${$selected ? palette.accent : 'transparent'}`,
    marginBottom: `${-tokens.border.hairline}px`,
    borderRadius: 0,
    background: 'transparent',
    color: $selected ? palette.text : palette.textSecondary,
    ...interactiveStates({
      palette,
      under: palette.surface,
      hover: tokens.state.hover,
      pressed: tokens.state.pressed,
    }),
    // The underline row has no padding to hold an outer ring, so it sits inside.
    '&:focus-visible': focusRing(palette, -tokens.border.focus),
  };
});

const Count = styled('span')({
  fontSize: `${tokens.text.tag.size}px`,
  lineHeight: `${tokens.text.tag.line}px`,
  fontWeight: tokens.text.tag.weight,
});

/**
 * Tabs with a roving tabindex: arrows, Home and End move focus and select
 * (selection follows focus); disabled tabs are skipped. Controlled by `value`.
 */
export function Tabs({
  tabs,
  value,
  onChange,
  label,
  variant = 'underline',
  fullWidth = false,
  id,
}: TabsProps): JSX.Element {
  const listRef = useRef<HTMLDivElement>(null);
  const generatedId = useId();
  const baseId = id ?? generatedId;
  const tooltipId = useDescribedBy(undefined);
  const enabled = tabs.filter((tab) => !tab.disabled);
  const selected = enabled.find((tab) => tab.id === value);
  // With no valid selection the first enabled tab stays reachable.
  const tabStop = selected?.id ?? enabled[0]?.id;

  const select = (index: number) => {
    const tab = enabled[index];
    if (tab === undefined) {
      return;
    }
    const nodes = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)');
    nodes?.[index]?.focus();
    onChange(tab.id);
  };

  // Keep the selected tab inside the scrolling list, on mount and whenever
  // `value` changes. scrollLeft, not scrollIntoView, which would scroll the page too.
  useLayoutEffect(() => {
    const list = listRef.current;
    const tab = list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!list || !tab) {
      return undefined;
    }
    const reveal = () => {
      const left = tab.offsetLeft;
      const right = left + tab.offsetWidth;
      if (left < list.scrollLeft) {
        list.scrollLeft = left;
      } else if (right > list.scrollLeft + list.clientWidth) {
        list.scrollLeft = right - list.clientWidth;
      }
    };
    reveal();
    // The webfont loads after the first layout and widens the tabs, so reveal
    // again when the selected tab changes size.
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(reveal);
    observer.observe(tab);
    return () => observer.disconnect();
  }, [value]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = enabled.findIndex((tab) => tab.id === document.activeElement?.getAttribute('data-tab'));
    if (current === -1) {
      return;
    }
    const last = enabled.length - 1;
    const targets: Record<string, number> = {
      ArrowRight: current === last ? 0 : current + 1,
      ArrowLeft: current === 0 ? last : current - 1,
      Home: 0,
      End: last,
    };
    const target = targets[event.key];
    if (target === undefined) {
      return;
    }
    event.preventDefault();
    select(target);
  };

  return (
    <List
      ref={listRef}
      id={id}
      role="tablist"
      aria-label={label}
      onKeyDown={handleKeyDown}
      $variant={variant}
      $fullWidth={fullWidth}
    >
      {tabs.map((tab) => {
        const isSelected = tab.id === value;
        return (
          <Tab
            key={tab.id}
            type="button"
            role="tab"
            id={tabElementId(baseId, tab.id)}
            aria-controls={tab.panelId}
            aria-describedby={tooltipId}
            // "Mentions, 3": a bare count would read as "Mentions3".
            aria-label={tab.count === undefined ? undefined : `${tab.label}, ${tab.count}`}
            data-tab={tab.id}
            aria-selected={isSelected}
            tabIndex={tab.id === tabStop ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => {
              if (!isSelected) {
                onChange(tab.id);
              }
            }}
            disableRipple
            $variant={variant}
            $selected={isSelected}
            $fullWidth={fullWidth}
          >
            {tab.label}
            {tab.count !== undefined && <Count>{tab.count}</Count>}
          </Tab>
        );
      })}
    </List>
  );
}
