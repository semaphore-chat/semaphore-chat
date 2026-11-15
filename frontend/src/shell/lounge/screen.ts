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
}

/** No template: the screen fills the frame on its own (the marker). */
export interface BareScreen {
  readonly template: 'bare';
  readonly Body: ComponentType<LoungeScreenProps>;
  readonly useTitle: UseScreenTitle;
}

export type LoungeScreen = ThreeIslandsScreen | BareScreen;

/** Screen-to-frame state. */
export interface ScreenChrome {
  /**
   * Whether the right content shows. Until the user (or the screen) sets it, the template's default
   * holds: shown at wide, closed below.
   */
  readonly rightOpen: boolean;
  setRightOpen(open: boolean): void;
}

const NO_CHROME: ScreenChrome = { rightOpen: false, setRightOpen: () => undefined };

export const ScreenChromeContext = createContext<ScreenChrome>(NO_CHROME);

/** For a screen's parts: the frame's state they may change (a Members button in the centre header). */
export function useScreenChrome(): ScreenChrome {
  return useContext(ScreenChromeContext);
}
