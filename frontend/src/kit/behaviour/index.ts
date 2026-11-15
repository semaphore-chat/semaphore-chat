/**
 * The behaviour layer: the five interaction patterns of `design/behaviour/`,
 * ported from the reference reducers in `design/gen/behaviour_ref.py` and
 * tested against the shared vectors.
 *
 * Every module exports its own `State`, `Event`, `Effect` and `Params`, so the
 * index names them after their pattern. Not re-exported from `kit/index.ts`:
 * the patterns are plain TypeScript, not part of the rendered kit.
 */

export {
  DEFAULT_PARAMS as TOAST_QUEUE_DEFAULT_PARAMS,
  initialToastQueue,
  stepToastQueue,
} from './toastQueue';
export type {
  Effect as ToastQueueEffect,
  Event as ToastQueueEvent,
  Params as ToastQueueParams,
  Politeness,
  State as ToastQueueState,
  Toast,
  ToastTone,
} from './toastQueue';

export {
  DEFAULT_PARAMS as OVERLAY_STACK_DEFAULT_PARAMS,
  initialOverlayStack,
  stepOverlayStack,
} from './overlayStack';
export type {
  CloseReason,
  Effect as OverlayStackEffect,
  Event as OverlayStackEvent,
  FocusPosition,
  Layer,
  LayerKind,
  Params as OverlayStackParams,
  State as OverlayStackState,
} from './overlayStack';

export {
  DEFAULT_PARAMS as CONFIRM_DESTRUCTIVE_DEFAULT_PARAMS,
  initialConfirmDestructive,
  stepConfirmDestructive,
} from './confirmDestructive';
export type {
  CancelReason,
  Effect as ConfirmDestructiveEffect,
  Event as ConfirmDestructiveEvent,
  Params as ConfirmDestructiveParams,
  Phase,
  State as ConfirmDestructiveState,
} from './confirmDestructive';

export {
  DEFAULT_PARAMS as LIST_FOCUS_DEFAULT_PARAMS,
  initialListFocus,
  stepListFocus,
} from './listFocus';
export type {
  Effect as ListFocusEffect,
  Event as ListFocusEvent,
  Params as ListFocusParams,
  Row,
  State as ListFocusState,
} from './listFocus';

export {
  DEFAULT_PARAMS as LOAD_STATE_DEFAULT_PARAMS,
  initialLoadState,
  stepLoadState,
} from './loadState';
export type {
  Effect as LoadStateEffect,
  Event as LoadStateEvent,
  Params as LoadStateParams,
  State as LoadStateState,
  Status,
} from './loadState';
