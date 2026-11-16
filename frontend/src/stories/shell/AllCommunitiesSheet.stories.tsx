/**
 * The "All communities" sheet (shell/lounge/pieces/AllCommunitiesSheet.tsx), open over the chat
 * template with the dock: a centred panel at tablet and desktop width, a bottom sheet on a phone (with
 * Settings, Your profile and Sign out at the foot). The mock-ups' communities: Couch Co-op current and your call,
 * Lumen Studio 2 mentions, Friday LAN new messages, Wavelength both.
 */
import { useState, type JSX } from 'react';
import { AllCommunitiesSheet } from '../../shell/lounge/pieces/AllCommunitiesSheet';
import { ShellDock } from '../../shell/lounge/pieces/ShellDock';
import type { ModeName } from '../../theme/derive/derivePalette';
import { useConfirmDestructive, useWidthRange } from '../../kit';
import { SIGN_OUT_DESCRIPTION, SIGN_OUT_LABEL, SIGN_OUT_TITLE } from '../../shell/lounge/pieces/signOutText';
import { ClickOnMount } from '../fixtures/interactions';
import { LoungePiecesFrame } from '../fixtures/LoungePiecesFrame';
import {
  fixedLoad,
  LONG_NAME,
  MOCKUP_STATES,
  sampleCommunities,
  type FixedLoad,
  type SampleCommunity,
} from '../fixtures/loungeCommunities';

interface SheetStoryProps {
  mode?: ModeName;
  communities?: readonly SampleCommunity[];
  currentId?: string | null;
  canCreate?: boolean;
  load?: FixedLoad;
  filter?: string;
  /** Closed at first: the dock's All button opens it (the browser spec's story). */
  startClosed?: boolean;
  /** On a phone, press the foot's Sign out: the question over the sheet. */
  askSignOut?: boolean;
}

type SheetProps = Required<Omit<SheetStoryProps, 'mode' | 'startClosed'>> & { open: boolean; onClose(): void };

/** The sign-out question as the connected sheet asks it; nothing is signed out in a story. */
const NEVER = () => new Promise<void>(() => undefined);

/**
 * The foot's Sign out row, once it is on the page. Module-level so its identity never changes: ClickOnMount runs
 * again when `find` changes, and a new function each render would press again on every render.
 */
const findSignOutRow = (): HTMLElement | null =>
  [...document.querySelectorAll<HTMLElement>('[role="dialog"] button')].find((button) => button.textContent?.trim() === 'Sign out') ?? null;

function Sheet({ communities, currentId, canCreate, load, filter: initial, open, onClose, askSignOut }: SheetProps): JSX.Element {
  const [filter, setFilter] = useState(initial);
  const [useLoad] = useState(() => fixedLoad(load));
  const range = useWidthRange();
  const signOut = useConfirmDestructive({ title: SIGN_OUT_TITLE, description: SIGN_OUT_DESCRIPTION, confirmLabel: SIGN_OUT_LABEL, run: NEVER });
  return (
    <>
      {askSignOut && <ClickOnMount find={findSignOutRow} />}
      <AllCommunitiesSheet
        open={open}
        onClose={() => {
          setFilter('');
          onClose();
        }}
        instanceName="moss.social"
        username="alexk"
        communities={communities}
        currentId={currentId}
        canCreate={canCreate}
        useLoad={useLoad}
        filter={filter}
        onFilterChange={setFilter}
        showSettings={range === 'phone'}
        onSignOut={signOut.request}
      />
      {signOut.dialog}
    </>
  );
}

function SheetStory({
  mode = 'dark',
  communities = sampleCommunities(12, MOCKUP_STATES),
  currentId = 'c-1',
  canCreate = true,
  load = 'ready',
  filter = '',
  startClosed = false,
  askSignOut = false,
}: SheetStoryProps): JSX.Element {
  const [open, setOpen] = useState(!startClosed);
  const dockCommunities = load === 'ready' ? communities : [];
  return (
    <LoungePiecesFrame
      mode={mode}
      dock={(range) => (
        <ShellDock
          communities={dockCommunities}
          current={currentId === null ? null : { kind: 'community', id: currentId }}
          inboxCount={9}
          status={load === 'loading' ? 'loading' : load === 'error' ? 'error' : 'ready'}
          onOpenInbox={() => undefined}
          onOpenAll={() => setOpen(true)}
          allOpen={open}
          bottomBar={range === 'phone'}
        />
      )}
    >
      <Sheet
        // Loading or failed: the connected sheet has no list yet.
        communities={dockCommunities}
        currentId={currentId}
        canCreate={canCreate}
        load={load}
        filter={filter}
        open={open}
        onClose={() => setOpen(false)}
        askSignOut={askSignOut}
      />
    </LoungePiecesFrame>
  );
}

/** Twelve communities (above 8: the filter shows), each with its state line; Couch Co-op current and in your call. */
export const Twelve = () => <SheetStory />;

/** The same, light. */
export const TwelveLight = () => <SheetStory mode="light" />;

/** Eight or fewer: no filter field. Five here. */
export const Few = () => <SheetStory communities={sampleCommunities(5, MOCKUP_STATES)} />;

/** One community. */
export const One = () => <SheetStory communities={sampleCommunities(1)} />;

/** Sixty: the body scrolls; the header, the filter and the foot rows scroll with it. */
export const Sixty = () => <SheetStory communities={sampleCommunities(60, MOCKUP_STATES)} currentId="c-55" />;

/** The filter narrowed to "lan". */
export const Filtered = () => <SheetStory filter="lan" />;

/** A filter that matches nothing. */
export const NoMatch = () => <SheetStory filter="zebra" />;

/** In no community yet, and allowed to create one. */
export const Empty = () => <SheetStory communities={[]} currentId={null} load="empty" />;

/** In no community yet, and not allowed to create one: no Create row. */
export const EmptyNoCreate = () => <SheetStory communities={[]} currentId={null} load="empty" canCreate={false} />;

/** A user who cannot create communities: the list without the Create row. */
export const NoCreate = () => <SheetStory communities={sampleCommunities(5, MOCKUP_STATES)} canCreate={false} />;

/** Loading. */
export const Loading = () => <SheetStory load="loading" />;

/** The list failed to load: the error with Try again. */
export const LoadError = () => <SheetStory load="error" />;

/** Long names are cut on one line. */
export const LongNames = () => (
  <SheetStory
    communities={[
      { id: 'long', name: LONG_NAME, mentions: 12, newMessages: false, inYourCall: false },
      { id: 'long-2', name: `${LONG_NAME} (the second)`, mentions: 0, newMessages: true, inYourCall: true },
      ...sampleCommunities(3),
    ]}
    currentId="long"
  />
);

/** Closed: press All communities on the dock to open it (the browser spec drives this one). */
export const FromDock = () => <SheetStory startClosed />;

/**
 * On a phone, Sign out at the foot asks first: the question over the sheet (Cancel returns to the row). At tablet and
 * desktop the sheet has no Sign out (the user card's account menu has it), so those widths show the sheet only.
 */
export const SignOutQuestion = () => <SheetStory communities={sampleCommunities(3, MOCKUP_STATES)} askSignOut />;
