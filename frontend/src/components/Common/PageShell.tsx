import React, { createContext, useContext, useLayoutEffect, useState } from "react";
import { Box, Button, ButtonBase, CircularProgress, Paper, Typography } from "@mui/material";
import {
  FORM_COLUMN_WIDTH,
  FORM_NAV_WIDTH,
  FORM_SHELL_COLLAPSE_PX,
  FORM_WIDE_COLUMN_WIDTH,
  PAGE_LIST_MAX_WIDTH,
} from "../../constants/layout";

/*
 * The two desktop page shells (see constants/layout.ts for the widths).
 * Pages use them in the desktop layout only; phone and tablet keep their own
 * full-width markup. User pages centre them in the content area
 * (`align="center"`); admin keeps them left-aligned next to its drawer.
 */

const NARROW = `@container (max-width: ${FORM_SHELL_COLLAPSE_PX - 1}px)`;

interface ShellHeaderProps {
  title?: React.ReactNode;
  /** Above the title (e.g. breadcrumbs). */
  overline?: React.ReactNode;
  /** Right of the title (e.g. an "Edit" button). */
  actions?: React.ReactNode;
}

const ShellHeader: React.FC<ShellHeaderProps> = ({ title, overline, actions }) =>
  title || overline || actions ? (
    <Box sx={{ mb: 3 }}>
      {overline}
      {(title || actions) && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mt: overline ? 1 : 0 }}>
          {title && (
            <Typography variant="h5" component="h1" sx={{ fontWeight: 700, flex: 1, minWidth: 0 }}>
              {title}
            </Typography>
          )}
          {actions && <Box sx={{ display: "flex", gap: 1, ml: "auto", flexShrink: 0 }}>{actions}</Box>}
        </Box>
      )}
    </Box>
  ) : null;

/**
 * The content width (px) of the nearest ListPageShell, measured with a
 * ResizeObserver: null before the first measurement and outside a shell. For
 * layouts that change their markup by width (Home's columns, Friends' side
 * panel); pure CSS layouts can use a container query on the shell instead.
 */
const ShellWidthContext = createContext<number | null>(null);
// eslint-disable-next-line react-refresh/only-export-components
export const useShellWidth = () => useContext(ShellWidthContext);

function useElementWidth(element: HTMLElement | null): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!element) return;
    const read = () => {
      const style = getComputedStyle(element);
      const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      const outer = element.getBoundingClientRect().width;
      // content-box width; jsdom reports 0 for everything, which reads as "unknown".
      setWidth(outer > 0 ? Math.max(0, outer - padding) : null);
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return width;
}

/** A page's title row, as the shells render it (for pages that place it themselves). */
export const PageHeader = ShellHeader;

interface ListPageShellProps extends ShellHeaderProps {
  children: React.ReactNode;
  /** Fill the content area's height (a page whose list scrolls inside itself). */
  fillHeight?: boolean;
  /** Widest the page gets (px); PAGE_LIST_MAX_WIDTH by default. */
  maxWidth?: number;
  /** "start" (default): at the content edge. "center": centred in the content area. */
  align?: "start" | "center";
}

/**
 * List pages (notifications, friends, profile, home): capped at `maxWidth`
 * (960 by default). The shell is a size container named "page", and
 * `useShellWidth()` gives its children its content width.
 */
export const ListPageShell: React.FC<ListPageShellProps> = ({
  children,
  fillHeight,
  maxWidth = PAGE_LIST_MAX_WIDTH,
  align = "start",
  ...header
}) => {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const width = useElementWidth(element);
  return (
    <Box
      ref={setElement}
      data-testid="list-page-shell"
      sx={{
        maxWidth,
        px: 3,
        py: 3,
        boxSizing: "content-box",
        containerType: "inline-size",
        containerName: "page",
        ...(align === "center" && { mx: "auto" }),
        ...(fillHeight && { height: "100%", display: "flex", flexDirection: "column", boxSizing: "border-box" }),
      }}
    >
      <ShellWidthContext.Provider value={width}>
        <ShellHeader {...header} />
        {fillHeight ? (
          <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>{children}</Box>
        ) : (
          children
        )}
      </ShellWidthContext.Provider>
    </Box>
  );
};

export interface FormPageSection {
  id: string;
  label: string;
  disabled?: boolean;
}

interface FormPageShellProps extends ShellHeaderProps {
  /** Section nav items; none → just the column. */
  sections?: FormPageSection[];
  activeSection?: string;
  onSelectSection?: (id: string) => void;
  /** Accessible name of the section nav. */
  navLabel?: string;
  /**
   * "scroll" (default): the nav jumps around one long page (a <nav> of
   * buttons). "tabs": it switches which section is shown, so it is a tablist
   * (role="tab" items, arrow keys) and the page wraps the shown section in
   * `<FormPageTabPanel>`.
   */
  navMode?: "scroll" | "tabs";
  /** A fluid column up to 1280px, for sections that are tables. */
  wide?: boolean;
  /** "start" (default): at the content edge. "center": the nav and column centred as one group. */
  align?: "start" | "center";
  children: React.ReactNode;
}

const formTabId = (id: string) => `form-section-tab-${id}`;
const formTabPanelId = (id: string) => `form-section-panel-${id}`;

/** The shown section of a `navMode="tabs"` FormPageShell. */
export const FormPageTabPanel: React.FC<{ sectionId: string; children: React.ReactNode }> = ({
  sectionId,
  children,
}) => (
  <Box role="tabpanel" id={formTabPanelId(sectionId)} aria-labelledby={formTabId(sectionId)}>
    {children}
  </Box>
);

/**
 * The element at the foot of the form column that a sticky save bar portals
 * into (see `StickySaveBar`); null outside a FormPageShell, where forms keep
 * their own inline Save button.
 */
const SaveBarSlotContext = createContext<HTMLElement | null>(null);
// eslint-disable-next-line react-refresh/only-export-components
export const useSaveBarSlot = () => useContext(SaveBarSlotContext);

/**
 * Form pages (settings, profile edit, community settings): a 220px sticky
 * section nav and a 680px column (960 with `wide`). Below ~940px of shell width
 * the nav turns into a row of tabs above the column.
 */
export const FormPageShell: React.FC<FormPageShellProps> = ({
  sections,
  activeSection,
  onSelectSection,
  navLabel = "Sections",
  navMode = "scroll",
  wide,
  align = "start",
  children,
  ...header
}) => {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const hasNav = !!sections && sections.length > 0;
  const isTabs = navMode === "tabs";

  // Tablist keys (WAI-ARIA tabs): arrows move to the previous/next enabled tab
  // and select it; Home/End jump to the first/last.
  const handleTabKeys = (event: React.KeyboardEvent<HTMLElement>) => {
    const enabled = (sections ?? []).filter((x) => !x.disabled);
    if (enabled.length === 0) return;
    const current = enabled.findIndex((x) => x.id === activeSection);
    let next: number;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        next = (current + 1) % enabled.length;
        break;
      case "ArrowUp":
      case "ArrowLeft":
        next = (current - 1 + enabled.length) % enabled.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = enabled.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = enabled[next];
    onSelectSection?.(target.id);
    document.getElementById(formTabId(target.id))?.focus();
  };
  const column = wide ? FORM_WIDE_COLUMN_WIDTH : FORM_COLUMN_WIDTH;
  const centered = align === "center";

  return (
    <Box data-testid="form-page-shell" sx={{ containerType: "inline-size", containerName: "page", px: 3, pt: 3 }}>
      <Box
        sx={{
          maxWidth: (hasNav ? FORM_NAV_WIDTH + 32 : 0) + column,
          ...(centered && { mx: "auto", [NARROW]: { maxWidth: column } }),
        }}
      >
        <ShellHeader {...header} />
      </Box>
      <Box
        sx={{
          display: "grid",
          ...(centered && { justifyContent: "center" }),
          gridTemplateColumns: hasNav ? `${FORM_NAV_WIDTH}px minmax(0, ${column}px)` : `minmax(0, ${column}px)`,
          columnGap: 4,
          alignItems: "start",
          [NARROW]: { gridTemplateColumns: `minmax(0, ${column}px)` },
        }}
      >
        {hasNav && (
          <Box
            component={isTabs ? "div" : "nav"}
            aria-label={navLabel}
            {...(isTabs && { role: "tablist", "aria-orientation": "vertical" as const, onKeyDown: handleTabKeys })}
            sx={{
              position: "sticky",
              top: 24,
              display: "flex",
              flexDirection: "column",
              gap: 0.5,
              [NARROW]: {
                top: 0,
                zIndex: 2,
                flexDirection: "row",
                overflowX: "auto",
                gap: 0,
                mb: 2,
                bgcolor: "background.default",
                borderBottom: 1,
                borderColor: "divider",
              },
            }}
          >
            {sections.map((s) => {
              const selected = s.id === activeSection;
              return (
                <ButtonBase
                  key={s.id}
                  disabled={s.disabled}
                  {...(isTabs
                    ? {
                        role: "tab",
                        id: formTabId(s.id),
                        "aria-selected": selected,
                        "aria-controls": formTabPanelId(s.id),
                        tabIndex: selected ? 0 : -1,
                      }
                    : { "aria-current": selected ? ("true" as const) : undefined })}
                  onClick={() => onSelectSection?.(s.id)}
                  sx={{
                    justifyContent: "flex-start",
                    textAlign: "start",
                    px: 1.5,
                    py: 1,
                    borderRadius: 2,
                    typography: "listItem",
                    color: selected ? "text.primary" : "text.secondary",
                    bgcolor: selected ? "action.selected" : "transparent",
                    fontWeight: selected ? 700 : 500,
                    "&:hover": { bgcolor: selected ? "action.selected" : "action.hover" },
                    "&.Mui-disabled": { opacity: 0.45 },
                    "&.Mui-focusVisible": { outline: 2, outlineColor: "primary.main", outlineStyle: "solid" },
                    [NARROW]: {
                      flexShrink: 0,
                      whiteSpace: "nowrap",
                      borderRadius: 0,
                      bgcolor: "transparent",
                      borderBottom: 2,
                      borderColor: selected ? "primary.main" : "transparent",
                      "&:hover": { bgcolor: "action.hover" },
                    },
                  }}
                >
                  {s.label}
                </ButtonBase>
              );
            })}
          </Box>
        )}
        <Box sx={{ minWidth: 0, pb: 3 }}>
          <SaveBarSlotContext.Provider value={slot}>{children}</SaveBarSlotContext.Provider>
          {/* Sticky save bars portal in here, so they stay on screen for the whole page. */}
          <Box ref={setSlot} data-testid="save-bar-slot" sx={{ position: "sticky", bottom: 16, zIndex: 3 }} />
        </Box>
      </Box>
    </Box>
  );
};

interface StickySaveBarProps {
  saving?: boolean;
  onSave: () => void;
  onReset: () => void;
  message?: string;
}

/** "Unsaved changes · Reset · Save", shown by a form while it has unsaved edits. */
export const StickySaveBar: React.FC<StickySaveBarProps> = ({
  saving,
  onSave,
  onReset,
  message = "You have unsaved changes",
}) => (
  <Paper
    role="region"
    aria-label="Unsaved changes"
    elevation={8}
    sx={{
      mt: 2,
      px: 2,
      py: 1.25,
      display: "flex",
      alignItems: "center",
      gap: 1.5,
      flexWrap: "wrap",
      // Stands apart from the card it floats over (shadows barely show in dark mode).
      border: 1,
      borderColor: "primary.main",
    }}
  >
    <Typography variant="listItem" sx={{ flex: 1, minWidth: 0 }}>
      {message}
    </Typography>
    <Button onClick={onReset} disabled={saving} color="inherit">
      Reset
    </Button>
    <Button
      variant="contained"
      onClick={onSave}
      disabled={saving}
      startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
    >
      {saving ? "Saving..." : "Save changes"}
    </Button>
  </Paper>
);
