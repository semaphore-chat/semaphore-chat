/**
 * The Lounge screen contract (design report §4, PA-1).
 *
 * A registered route's module (`LoungeRoute.load`, under `lounge/screens/`) default-exports a
 * descriptor, not a component. The frame (`LoungeRoot`) renders the template the descriptor names and
 * the shell's own pieces around the screen's parts, so moving between two screens of one template
 * keeps the dock, the left island (its scroll and focus), the members island and the call bar mounted.
 * A descriptor is plain data a native shell can mirror.
 */
import { createContext, useContext, type ComponentType } from 'react';
import type { LoungeLinks } from './links';

/** Params of the matched pattern, as react-router's matchPath returns them. */
export type LoungeParams = Readonly<Partial<Record<string, string>>>;

export interface LoungeScreenProps {
  readonly params: LoungeParams;
}

/**
 * The screen's title for the route: the centre's label and what RouteFocus announces. A hook, so it
 * can read the data layer ("Couch Co-op"); null while it is not known (nothing is announced yet).
 * It runs in a component of its own per route, so two screens' hooks never mix.
 */
export type UseScreenTitle = (params: LoungeParams) => string | null;

/** The chat template (`ThreeIslands`): the shell's dock, left island, members and call bar around the screen's centre. */
export interface ThreeIslandsScreen {
  readonly template: 'threeIslands';
  /** Which of the shell's left islands shows: the community's channels and rooms, or the inbox. */
  readonly place: 'community' | 'inbox';
  /** Which pane a phone shows. */
  readonly phonePane: 'left' | 'centre';
  /** The screen's centre. Null: nothing yet (a screen that is only its left pane on a phone). */
  readonly Centre: ComponentType<LoungeScreenProps> | null;
  /** The right region: the shell's members island, the screen's own, or none. */
  readonly right: 'members' | ComponentType<LoungeScreenProps> | null;
  readonly useTitle: UseScreenTitle;
  /** Names the right island and its Sheet. Defaults to "Members" for the members island, else "Details". */
  readonly rightLabel?: string;
  /**
   * Test fixtures only (`/__lounge/...`): where the shell's community links lead, so a fixture's dock and
   * sheet stay on the fixture. A real screen leaves it out; the app's routes apply (`shell/lounge/links.ts`).
   */
  readonly links?: LoungeLinks;
}

/** No template: the screen fills the frame on its own (the marker). */
export interface BareScreen {
  readonly template: 'bare';
  readonly Body: ComponentType<LoungeScreenProps>;
  readonly useTitle: UseScreenTitle;
}

export type LoungeScreen = ThreeIslandsScreen | BareScreen;

/**
 * A screen's own panel in the right region (design §3 PR 10e, B9): a thread or the pinned messages, shown in place
 * of the region's default content (the members) at compact and wide. At wide it is the right island; below wide it is
 * the right Sheet. The screen renders the panel's content itself, into `ScreenChrome.panelTarget` with a portal, so the
 * content keeps the screen's own state and context; the frame owns where it shows.
 */
export interface RightPanel {
  /** Names the right island and its Sheet ("Thread", "Pinned messages"). */
  readonly label: string;
  /** The content brings its own header, scrolling and padding (a thread: its list and composer). */
  readonly fill?: boolean;
  /** The frame asks the screen to close the panel: Escape at wide, or the Sheet's Escape, scrim or Close below. */
  readonly onClose: () => void;
  /**
   * Closes every panel the screen has stacked in the right region (a thread over a search), not only this one. The
   * frame uses it when the members are asked for, so they really show; absent, `onClose` is all there is.
   */
  readonly closeAll?: () => void;
}

/** Screen-to-frame state. */
export interface ScreenChrome {
  /**
   * Whether the right content shows. Until the user (or the screen) sets it, the template's default
   * holds: shown at wide, closed below. A screen's panel shows whatever this says.
   */
  readonly rightOpen: boolean;
  setRightOpen(open: boolean): void;
  /**
   * Opens the right content and moves focus into it once shown (a Members button that goes away as the island
   * appears hands focus to the island, never to the page).
   */
  showRight(): void;
  /** The screen's panel in the right region, or null for the region's default content. */
  readonly panel: RightPanel | null;
  /** Sets or clears the screen's panel. A screen clears its own when it goes (an effect's cleanup). */
  setPanel(panel: RightPanel | null): void;
  /** Where the screen portals the open panel's content; null while no panel is shown. */
  readonly panelTarget: HTMLElement | null;
}

/** What a part sees outside a frame (and the base a test spreads its own state over). */
export const NO_SCREEN_CHROME: ScreenChrome = {
  rightOpen: false,
  setRightOpen: () => undefined,
  showRight: () => undefined,
  panel: null,
  setPanel: () => undefined,
  panelTarget: null,
};

export const ScreenChromeContext = createContext<ScreenChrome>(NO_SCREEN_CHROME);

/** For a screen's parts: the frame's state they may change (a Members button in the centre header). */
export function useScreenChrome(): ScreenChrome {
  return useContext(ScreenChromeContext);
}
