import { useEffect, useRef, type JSX } from 'react';
import { Avatar, Button, ListRow, LoadState, Skeleton, Text, useLoadState, type LoadController } from '../../kit';
import type { ModeName } from '../../theme/derive/derivePalette';
import { tokens } from '../../theme/generated/tokens';
import { KitStage } from '../fixtures/kitStory';
import { ToastRegion } from '../../kit/display/ToastRegion';

const noop = () => undefined;

const state = (over: Partial<LoadController>): LoadController => ({
  status: 'ready',
  error: null,
  retryable: true,
  refreshByUser: false,
  refresh: noop,
  retry: noop,
  ...over,
});

const MEMBERS = ['Ada Lovelace', 'Grace Hopper', 'Linus Torvalds', 'Margaret Hamilton'];

function MemberSkeleton(): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.sm }}>
      {MEMBERS.map((name) => (
        <div key={name} style={{ display: 'flex', gap: tokens.space.md, alignItems: 'center' }}>
          <Skeleton shape="circle" size="md" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Skeleton shape="text" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Members({ names = MEMBERS }: { names?: string[] }): JSX.Element {
  return (
    <div role="list" aria-label="Members" style={{ display: 'flex', flexDirection: 'column' }}>
      {names.map((name) => (
        <div role="listitem" key={name}>
          <ListRow primary={name} leading={<Avatar name={name} size="md" />} />
        </div>
      ))}
    </div>
  );
}

/** A members panel: a title, a refresh button that reads `refreshByUser`, and the pattern's five faces. */
function Panel({ mode, controller, names }: { mode: ModeName; controller: LoadController; names?: string[] }): JSX.Element {
  return (
    <KitStage mode={mode}>
      <PanelBody controller={controller} names={names} />
    </KitStage>
  );
}

/** The panel without its stage, for a story whose hook must run inside the stage's KitProvider. */
function PanelBody({
  controller,
  names,
  toasts = false,
}: {
  controller: LoadController;
  names?: string[];
  /** Also render the real toast region. */
  toasts?: boolean;
}): JSX.Element {
  return (
    <>
      <div style={{ maxWidth: tokens.layout.dialogMd, width: '100%', display: 'flex', flexDirection: 'column', gap: tokens.space.md }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: tokens.space.md }}>
          <Text variant="title">Members</Text>
          <Button size="sm" loading={controller.refreshByUser} onClick={controller.refresh}>
            Refresh
          </Button>
        </div>
        <LoadState
          state={controller}
          label="Members"
          skeleton={<MemberSkeleton />}
          empty={<Text tone="secondary">No one has joined yet. Invite people to get started.</Text>}
          errorTitle="Couldn't load members"
        >
          <Members names={names} />
        </LoadState>
      </div>
      {toasts && <ToastRegion />}
    </>
  );
}

/** The first load: skeletons in the shape of the rows, a hidden "Loading members" status, a busy region. */
export const Loading = () => <Panel mode="dark" controller={state({ status: 'loading' })} />;

export const LoadingLight = () => <Panel mode="light" controller={state({ status: 'loading' })} />;

export const Ready = () => <Panel mode="dark" controller={state({})} />;

export const Empty = () => <Panel mode="dark" controller={state({ status: 'empty' })} />;

export const EmptyLight = () => <Panel mode="light" controller={state({ status: 'empty' })} />;

/** The first load failed: an alert with Try again replaces the skeleton. The title says what failed; the default body is "Try again." */
export const ErrorWithRetry = () => <Panel mode="dark" controller={state({ status: 'error', error: 'Try again.' })} />;

export const ErrorWithRetryLight = () => (
  <Panel mode="light" controller={state({ status: 'error', error: 'Try again.' })} />
);

/** The first load could not start: the device is offline. It loads by itself when the connection returns, so there is no Try again. */
export const ErrorOffline = () => (
  <Panel
    mode="dark"
    controller={state({ status: 'error', retryable: false, error: "You're offline. It will load when you're back online." })}
  />
);

/** A background refresh: the content stays and nothing else changes. */
export const Refreshing = () => <Panel mode="dark" controller={state({ status: 'refreshing' })} />;

/** A refresh the user started: the content stays and the Refresh button is busy (focusable, not disabled). */
export const UserRefreshBusy = () => (
  <Panel mode="dark" controller={state({ status: 'refreshing', refreshByUser: true })} />
);

export const UserRefreshBusyLight = () => (
  <Panel mode="light" controller={state({ status: 'refreshing', refreshByUser: true })} />
);

function LivePanel(): JSX.Element {
  // The first load fails; Try again works.
  const calls = useRef(0);
  const { state: controller, data } = useLoadState({
    notifyId: 'members',
    resetKey: 'couch-co-op',
    load: () =>
      new Promise<string[]>((resolve, reject) => {
        calls.current += 1;
        setTimeout(() => (calls.current === 1 ? reject(new Error('503')) : resolve(MEMBERS)), 800);
      }),
    isEmpty: (names) => names.length === 0,
  });
  return <PanelBody controller={controller} names={data} />;
}

/** The real hook: loads for a moment, fails, and Try again loads the list. */
export const Live = () => (
  <KitStage mode="dark">
    <LivePanel />
  </KitStage>
);

function RefreshFailsPanel(): JSX.Element {
  // The first load works; the refresh started a moment later fails, so the toast host shows the notice.
  const calls = useRef(0);
  const { state: controller, data } = useLoadState({
    notifyId: 'members',
    resetKey: 'couch-co-op',
    load: () =>
      new Promise<string[]>((resolve, reject) => {
        calls.current += 1;
        const first = calls.current === 1;
        setTimeout(() => (first ? resolve(MEMBERS) : reject(new Error('503'))), 300);
      }),
    isEmpty: (names) => names.length === 0,
    errorMessage: () => "Couldn't refresh members. Try again.",
  });
  const { status, refresh } = controller;
  const refreshed = useRef(false);
  useEffect(() => {
    if (status !== 'ready' || refreshed.current) return;
    refreshed.current = true;
    refresh();
  }, [status, refresh]);
  return <PanelBody controller={controller} names={data} toasts />;
}

/** A refresh fails: the members stay, and the real toast host shows a danger toast with the screen's notify id. */
export const RefreshFailsToast = () => (
  <KitStage mode="dark">
    <RefreshFailsPanel />
  </KitStage>
);
