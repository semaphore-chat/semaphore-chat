# Behaviour

This chapter says how things respond: how toasts queue, which layer Escape
closes, what a delete confirmation does while it works, how the keyboard moves
through a list, and what a screen shows while it loads.

## What the behaviour layer is

Semaphore Chat has two clients, the web app and the native app. They must
behave the same. A toast must stay for the same time in both, and Escape must
close the same layer.

So each interaction pattern is written down once, as a small state machine. A
pattern has a state, the events that can happen to it, and the effects it asks
for, such as "start a timer" or "ask this layer to close". Its rules say, in
plain sentences, what each event does in each state.

Each pattern has one exact definition, written in Python
(`design/gen/behaviour_ref.py`). Both clients copy it, and both are tested
against the same examples, called vectors. A client that disagrees with a
vector is wrong.

The piece that copies a pattern is called a reducer. The piece that connects a
reducer to a real screen (it sends the events, runs the timers, moves focus) is
called a host.

## Where things stand

- The reducers exist in both clients: `frontend/src/kit/behaviour/` (web) and
  `native/crates/semaphore-design/src/behaviour/` (native). Both are tested
  against the vectors.
- The web kit has the overlay stack's host (`frontend/src/kit/behaviour/hosts/`).
  Every kit Tooltip, Menu, Popover, Dialog, Sheet and SelectField list is a
  layer, and one set of page listeners sends Escape, Tab and presses to the
  stack. MUI still draws the overlays, keeps Tab inside a modal, stops the page
  scrolling and hides it from screen readers. It no longer decides when a layer
  closes or where focus goes after.
- Screens join the stack through two hooks from the kit: `useScreenEscape` adds
  a step to the screen's Escape chain (`ESCAPE_PRIORITY.panel` closes the docked
  panel, `ESCAPE_PRIORITY.conversation` marks as read), and
  `useScreenFocusTarget` names where focus goes when nothing else can take it
  (the composer on a chat screen).
- The web kit has the toast queue's host too. Screens show toasts with
  `useToasts()` (`show({id, tone, message, action})` and `dismiss(id)`) and
  never render a Toast themselves. `AppFrame` renders the toast region at the
  bottom centre of the template's main island (see
  [Layouts](layouts.md#where-toasts-sit)); a bottom-pinned element such as a
  composer lifts it above itself with `useToastClearance(ref)`.
- The other hosts (confirm, list focus, load state) do not exist yet, and the
  native client has none. They arrive with the new shell.
- Until then, today's screens still handle these things by hand, and they use
  MUI overlays, not the kit's. They behave as MUI does, which differs from these
  rules in places. For example, MUI lets an Escape pressed over a tooltip also
  close the dialog below it, and its menu typeahead resets after half a second,
  not one. The kit Menu still uses MUI's list keys, and so its half second too,
  until it moves to the list focus pattern.

When a screen moves to the new shell, it stops handling Escape, toasts and
confirmations by hand and uses the pattern instead.

## Timings

The patterns take their durations from the timing tokens (see
[Tokens and colour](tokens-and-colour.md#timings)).

|Token|ms|Used by|
|---|---|---|
|typeahead|1000|How long typed letters in a list add up before they start again|
|toast|4000|How long a toast stays|
|toastAction|8000|How long a toast with an action, or a danger toast without one, stays; the longest a waiting toast that is not danger waits|

## What a host does

This section is the contract for a host. Two hosts written from it behave the
same.

### Ids, tokens and numbers

- The host makes every id: toast ids, layer ids and opener ids (an id for the
  element focus should return to). A toast id names the subject, not the
  message: use the same id, such as `offline`, wherever the same thing is
  reported, so a second report replaces the first instead of queueing.
- The reducer makes timer tokens, fetch tokens and attempt numbers. They count
  up from 1 within one reducer. Two reducers can hand out the same token, so a
  shared timer service keys each timer by reducer and token.

### Applying a step

1. Send one event. The reducer returns the new state and a list of effects.
2. Store the new state. Then apply the effects one by one, in the order given.
3. An event the host makes while it applies an effect goes in a queue. It is
   sent after every effect of this step has been applied. It never goes back
   into the reducer while an effect is being applied. For example, an owner that
   closes a layer at once inside `requestClose` reports `closed` afterwards, as
   the next event.

Effects never fail. If the host cannot do one (an element to focus has gone),
it does what the effect's description says to do instead.

### What each effect asks

|Effect|The host must|
|---|---|
|`startTimer{token, ms}`|Start a timer. When it ends, send `timerFired{token}`.|
|`cancelTimer{token}`|Stop that timer and never send its `timerFired`. A late one is harmless: the reducer ignores a stale token.|
|`announce{message, politeness, action}`|Have screen readers read the message, then the action's label if there is one ("Message deleted. Undo"). `assertive` interrupts; `polite` waits.|
|`returnFocus{}`|Put focus back on the element that had it before focus entered the toast area. If that has gone, focus the screen's own focus target.|
|`requestClose{id, reason}`|Tell the layer's owner. For `escape`, `pressOutside`, `scrim` and `tab`, the owner may refuse (unsaved changes). For `parentClosed`, the owner must close the layer: it has already left the stack.|
|`restoreFocus{to}`|Focus the element or layer named by `to`. A layer is focused through its first control that can take focus, or its panel. `to: null` means the screen's own focus target: the main content of the screen (on a chat screen, the message composer). If the element cannot take focus after all, focus the layer its opener was in. Never focus the screen while a dialog or sheet is still open: focus the topmost one instead.|
|`passToScreen{key}`|Run the screen's own Escape chain: close the docked panel, then mark the channel as read.|
|`run{attempt}`|Start the action. Always report `succeeded{attempt}` or `failed{attempt, message}` for it, exactly once. A timeout, a lost connection or the screen going away is reported as `failed`. Without a result the dialog can never close.|
|`done{}`|The confirmed action worked. The dialog is already closed; show its result if the screen does (for example a toast).|
|`select{id}`|The row was chosen. Act on it (open the channel, choose the item).|
|`deselect{}`|Nothing is selected any more. Act on it if the screen shows the selection somewhere else.|
|`fetch{token}`|Fetch. Report `succeeded{token, empty}` or `failed{token, message}` with the same token.|
|`notify{id, message}`|Show a toast with that id and message (danger tone, no action), through the toast queue.|

### What the host reports

- **Toast queue.** `dismiss{id, focusInside}`: `focusInside` is true when focus
  is anywhere in the toast area as the toast leaves. `pause` when the first
  reason to pause starts and `resume` when the last one ends. The reasons are:
  the pointer on the toast area, focus inside it, the window hidden (minimised,
  in the background, or the tab hidden), and a modal layer open (a dialog or
  sheet makes the toast unreachable). If a reason still holds when a new toast
  appears after the queue was empty, send `pause` again. The pointer counts for
  a mouse or a pen, not a touch (a touch has no hover to end the pause). When
  the area goes (the last toast left), the pointer and focus reasons end with
  it. On the web, "the window hidden" is the page hidden or the window
  blurred.
- **Overlay stack.** `open{layer}` when a layer appears, with `parent` (the
  layer that owns it: it closes when that one closes), `opener` (the element
  focus returns to) and `openerLayer` (the layer that element is in, or null for
  the screen). A select list or menu drawn somewhere else on the page (a portal)
  is still a layer of its own, with the layer it belongs to as its parent.
  `closed{id, openerPresent, focus}` when a layer has gone: `openerPresent` says
  whether the layer's opener, as the stack holds it now, is still on the page
  and can take focus (not disabled, hidden or inert);
  `focus` is `inside` when focus is in the layer or a layer it owns, `lost` when
  focus is on the page body or went with the layer, and `outside` when the user
  moved it somewhere else. Focus in any part of a layer counts as inside it: on
  the web, a press on the dimmed page puts focus on the dialog's own container.
  `escape{composing, focusOwnsEscape}` for each Escape press: `composing` is the
  key event's composing flag, and `focusOwnsEscape` is true when the focused
  control uses Escape itself (an open mention list or autocomplete, a message
  in edit mode). On the web a control says so by calling `preventDefault()` on
  the key, not `stopPropagation()`. `pressOutside{insideId}` for a press:
  `insideId` is the innermost layer the press landed in, or null; a press on a
  popover's anchor counts as inside the popover. A press is the main button (or
  the first finger or pen on the screen) going down and coming up in the same
  layer; a right or middle press is not one, and closes nothing. So a drag from
  a dialog onto the dimmed page is not a press. `tab` for Tab or Shift+Tab.
  Escape and Tab with Ctrl, Alt or Meta held are other shortcuts (Ctrl+Tab
  switches tabs) and send nothing; a held Escape sends one `escape`, not one per
  repeat.
- **The opener when nothing had focus.** Some platforms do not focus a button
  when it is clicked (Safari). When focus is on the page body as a layer opens,
  the opener is the layer's own fallback (a Menu's anchor), else the control the
  last main press landed on, while that press is recent: from its press until
  the next key press, the next focus change, or one second after the pointer
  came up.
- **Escape that the stack used.** When `escape` asks a layer to close, or the
  screen's chain used the key, the host marks the key as handled
  (`preventDefault()` on the web), so older listeners on the page leave it
  alone. When nothing used it, the key goes on.
- **Tab in a menu.** When `tab` returns `requestClose(menu, 'tab')`, the host
  consumes the key: focus does not move on, and goes back to the opener through
  `restoreFocus` when the menu closes. When `tab` returns nothing, the key moves
  focus as usual.
- **Confirm destructive.** `request` when the user asks for the dangerous
  action, `confirm` for the dialog's confirm button, `cancel{reason}` for its
  Cancel button, Escape or the scrim, and the run's result.
- **List focus.** `setRows{rows}` whenever the rows change, with the whole list
  (not only the rows a virtualised list has drawn). `focusIn` when focus enters
  the list. Arrow keys, Home and End as `up`, `down`, `home`, `end`. A printable
  character as `type{char}`, exactly one character. Space is `type{char: " "}`
  while the `typeahead` state is not empty, and `activate` otherwise. Enter is
  `activate`. A pointer press on a row is `press{id}`.
- **Load state.** `start` when the screen opens or what it shows changes.
  `refresh{byUser}` for a refresh: `byUser` is true for a refresh button or pull
  to refresh, false for a refetch on focus or reconnect. `retry` for Try again.

### One dialog, two patterns

A confirm dialog is also a layer of the overlay stack. The host joins them:

- An overlay `requestClose(dialog, 'escape')` or `requestClose(dialog, 'scrim')`
  becomes `cancel{reason: 'escape'}` or `cancel{reason: 'scrim'}` for the
  confirm pattern.
- When the confirm pattern goes back to idle, the owner closes the dialog and
  reports `closed` to the overlay stack.
- While the action runs, the confirm pattern ignores the cancel, so the owner
  does not close the dialog and reports nothing to the overlay stack.

## Toast queue

**What the user sees.** One toast at a time. If more arrive, they wait their
turn. Each one leaves on its own after a while, or when the user dismisses it.
While the pointer or focus is on a toast, or the window is hidden, or a dialog
is open, it stays. A plain toast (no action, not a failure) that has waited
too long for its turn is dropped; nothing is dropped while it could not be
seen.

Rules:

- One toast shows at a time. A toast shown while nothing is showing appears at
  once, starts its timer and is announced to screen readers.
- A toast shown while another is showing waits at the end of the queue. It is
  not announced until it shows.
- A toast with the same id as the one showing replaces it, and its timer starts
  again. It is announced again only if its message or action changed. Use this
  for a toast that changes, such as "Uploading" then "Uploaded".
- A toast with the same id as a waiting toast replaces that one in its place.
- At most three toasts wait. When a toast arrives at a full queue, the oldest
  waiting toast with no action that is not danger is dropped. If there is none,
  the oldest waiting toast that is not danger goes. The new toast and danger
  toasts are never dropped, so the queue can grow past three.
- A neutral or positive toast stays for the toast timing; with an action, for
  the longer toastAction timing.
- A danger toast interrupts screen readers. The others wait for a pause. A
  danger toast without an action leaves after the longer timing. A danger
  toast with an action stays until the user dismisses it, and the toasts
  behind it wait.
- Dismissing the toast that is showing brings in the next one, or nothing.
- Dismissing a waiting toast removes it. Dismissing a toast that is not there
  does nothing.
- When the timer ends, the toast leaves.
- While the host has a reason to pause, the timer stops. When the last reason
  ends, the timer starts again from the full time, not from the time that was
  left.
- The pause belongs to the toast area, not to one toast. A toast that takes the
  place of a dismissed one while paused waits too.
- Every announcement includes the action's label, so a screen reader user
  knows the action is there.
- When the user dismisses a toast with focus inside the toast area, focus goes
  back to where it was before it entered the area.
- A waiting toast with no action that is not danger is dropped once it has
  waited the toastAction timing (8 seconds): by then "Saved" or "Copied" is
  stale. A toast with an action (Undo) and a danger toast are never dropped:
  they wait however long it takes. The wait starts when the toast joins the
  queue. It does not count while the toast area is paused, whatever the
  reason (the pointer or focus on the toast, the window hidden, a dialog
  open): the pause stops every wait, and when it ends each one starts again
  from the full time. So nothing raised behind a dialog is dropped unseen: it
  shows, and is announced, after the dialog closes. A toast whose turn comes
  first shows for its full time, also when its turn and its wait's end come
  at the same moment. Replacing a waiting toast with the same id keeps its
  wait (a fresher "3 new messages" keeps the clock of "2 new messages"); if
  the replacement has an action or is danger, it is not dropped when the wait
  ends.

The toast area is a landmark region named "Notifications". Keyboard users
reach it with F6, and F6 (or Shift+F6) inside it puts focus back where it was.
While a dialog or sheet is open the area is out of reach and F6 does nothing.

Parameters: `durationMs` (toast), `durationWithActionMs` (toastAction),
`maxQueued` (3), `maxWaitMs` (toastAction).

**Example.** "Saved" appears and starts a four-second timer. A danger toast,
"Couldn't send", arrives and waits. After four seconds "Saved" leaves and
"Couldn't send" appears, interrupts the screen reader, and stays eight seconds.
Had it carried a "Retry" action, it would stay until dismissed, and a "Saved"
arriving behind it would be dropped after waiting eight seconds.

|Host checklist|Done when|
|---|---|
|Timers|`startTimer` starts one keyed by token; `cancelTimer` stops it|
|Announcements|Message then action label, at the given politeness|
|Pause|One `pause`/`resume` pair for pointer, focus, hidden window and open modal; `pause` again when a new toast appears while a reason holds|
|Dismiss|`focusInside` sent; `returnFocus` puts focus back|
|Reach|The area is a landmark; F6 moves focus into it and back; nothing while a modal is open|
|Waits|A wait's `startTimer` runs like any other (the reducer cancels waits on `pause`). When a wait and the showing toast's timer end at the same moment, send the showing toast's `timerFired` first (the web host delivers an ended wait one task later)|
|Ids|Callers use one id per subject|

## Overlay stack

**What the user sees.** Escape closes the innermost thing first. A press
outside a menu or popover closes it. A press on the dimmed page closes the
dialog. When something closes and focus was in it, focus goes back where it
came from.

The stack holds the layers above the screen: tooltips, menus, popovers,
dialogs and sheets (see [Which overlay](components.md#which-overlay)). Each
layer knows the layer that owns it, the element that opened it and the layer
that element is in.

Rules:

- Layers stack in the order they open. A tooltip always sits on top.
- Opening a layer that is already open does nothing.
- Escape asks the topmost layer to close. One Escape closes one layer, so
  nested layers close innermost first.
- A tooltip takes the Escape. Escape with a tooltip showing closes only the
  tooltip. It does not close the dialog below, and it does not reach the
  screen. The tooltip stays hidden until the pointer or focus leaves its
  control and comes back (the host's job).
- Escape with nothing open goes to the screen. The screen has its own order:
  close the docked panel, then mark as read.
- Escape while an input method is composing text never reaches the stack. A
  focused control that uses Escape itself (an open mention list, a message in
  edit mode) gets it first.
- A press inside a layer owned by another layer counts as inside both. A select
  list opened from a dialog is part of the dialog.
- A press outside a popover closes it, and the press carries on to what is
  underneath.
- A press outside a menu closes the menu and goes no further. The control under
  the press is not activated.
- A press outside a dialog or sheet is a press on its dimmed page. It asks the
  dialog to close and goes no further.
- A press never closes a tooltip. A tooltip closes when the pointer or focus
  leaves its control.
- Tab closes a menu. In any other layer, Tab moves focus as usual.
- Closing is a request. The owner may refuse it, for example a form with
  unsaved changes. A layer leaves only when its owner says it has closed.
- When a layer closes, the layers it owns close with it, innermost first. That
  is a command: their owners must close them.
- When a layer closes with focus inside it, or with focus lost, focus goes back
  to the element that opened it. If that has gone, focus goes to the layer that
  element was in. If that has gone too, the screen decides. If the user had
  already moved focus somewhere else, focus stays there.
- Focus never goes back to something under an open dialog or sheet.
- A layer opened from inside another layer that has since closed takes over
  that layer's opener. So a confirm dialog opened from a menu's Delete item
  returns focus to the menu's button.
- Closing a tooltip does not move focus.

Parameters: none.

**Example.** The user opens the More menu on a message and chooses Delete.
The confirm dialog opens and the menu closes; focus stays in the dialog. The
user presses Escape: the dialog closes and focus goes back to the More button.

|Host checklist|Done when|
|---|---|
|Layers|Every tooltip, menu, popover, dialog and sheet sends `open` and `closed`, with `parent`, `opener` and `openerLayer`|
|Escape|One handler sends `escape` with `composing` and `focusOwnsEscape`; a tooltip closed by Escape stays hidden until re-entered|
|Presses|`pressOutside` with the innermost layer; the swallowed press is not passed on|
|Tab|Consumed when it closes a menu|
|Closing|`closed` reports `openerPresent` and `focus`; `parentClosed` is always obeyed|
|Focus|`restoreFocus` focuses the element, the layer, or (null) the screen's focus target|

**Where it stands.** On the web, the kit's Tooltip, Menu, Popover, Dialog, Sheet
and SelectField list meet every row (`frontend/src/kit/behaviour/hosts/overlay.ts`),
and each rule has a test that drives the real components
(`frontend/src/__tests__/kit/behaviour/hosts/overlay.test.tsx`). The focus trap
with layers inside a dialog, Escape during composition, a drag onto the dimmed
page, the press a menu swallows, focus return when a click focuses nothing, and
the live region inside the topmost layer run in real browsers
(`frontend/browser-tests/overlay-stack.spec.ts`). The native client has no host
yet.

Two things the web host does because of how MUI works, not because the pattern
asks for them. A native host need not copy them:

- A press during which a layer opened is not a press. MUI's select list opens
  when the pointer goes down, under the pointer, and would otherwise close as
  it comes up.
- When a step asks child layers to close with `parentClosed` and also moves
  focus, focus moves once the children have gone: a closing MUI menu still
  holds focus inside itself until then.

## Confirm destructive

**What the user sees.** Before something that cannot be undone, a dialog asks
"Are you sure?". While the action runs, the button shows it is busy and the
dialog cannot be closed. If it fails, the dialog stays open with the error, and
the user can try again or cancel.

Rules:

- The dialog is closed until something asks for it. Asking again while it is
  open does nothing.
- The confirm button starts the action.
- While the action runs, pressing confirm again does nothing.
- While the action runs, nothing closes the dialog: not Cancel, not Escape, not
  a press on the dimmed page. The action may already have happened.
- Before the action, and after it fails, Cancel, Escape and a press on the
  dimmed page all close the dialog.
- When the action succeeds, the dialog closes and the screen is told it is done.
- When the action fails, the dialog stays open and shows the error.
- Confirm after a failure tries again, and the error goes away while it runs.
- A late answer from an earlier try is ignored.

Parameters: none.

**Example.** The user chooses Delete channel. The dialog asks. They press
Delete: the button is busy. The server says no. The dialog shows "Couldn't
delete the channel". They press Delete again; this time it works, and the
dialog closes.

|Host checklist|Done when|
|---|---|
|Results|Every `run` reports exactly one `succeeded` or `failed`, a timeout included|
|Overlay|Escape and scrim close requests become `cancel`; `closed` is reported when the phase goes back to idle|
|Busy|The confirm button is busy while `working`|

## List focus

**What the user sees.** In a menu, a picker or a channel list, the arrow keys
move between rows, Home and End jump to the ends, and typing letters jumps to a
row. Disabled rows are skipped.

Rules:

- Only enabled rows take focus. Disabled rows are skipped, in menus too; a
  disabled item that the user needs to discover should say why in its own text
  or not be shown.
- In an empty list, or one where every row is disabled, keys do nothing.
- Down moves to the next row and Up to the previous one. With nothing focused,
  Down goes to the first row and Up to the last.
- At the ends, Down and Up stop. A list can choose to wrap round instead.
- Home goes to the first row and End to the last.
- When focus enters the list, it goes to the selected row, or to the first row
  if nothing usable is selected. This does not change the selection.
- Typing letters jumps to the first row whose label starts with them, from the
  focused row onwards and round. Case does not matter. The letters add up for
  one second (the typeahead timing), then start again.
- Typing the same letter again steps through the rows that start with it.
- If no row matches, focus stays where it is.
- By default, moving focus does not select. Enter or Space selects the focused
  row.
- A list can choose to select as focus moves, for example tabs in a tab list.
- Clicking a row focuses and selects it. Clicking a disabled row does nothing.
- When rows change and the focused row goes away or becomes disabled, focus
  moves to the next row, or the previous one if there is none. The selection
  moves with it only in a list that selects as focus moves.
- When the selected row goes away, nothing is selected.
- "Case does not matter" means each character is put in lower case on its own,
  the same way in every language (Python's `str.lower()` on one character at a
  time). Characters are then compared exactly, so an emoji only matches itself.

This pattern is for a single list with one selection. Multi-select lists and
grids are future patterns.

Parameters: `wrap` (off), `selectionFollowsFocus` (off), `typeaheadMs`
(typeahead).

**Example.** A list has General, Games and Random. The user types "g": focus
goes to General. They type "g" again: Games. They type "r" after a pause:
Random.

|Host checklist|Done when|
|---|---|
|Rows|`setRows` carries the whole list on every change|
|Keys|Arrows, Home, End, Enter; Space is `type` while the buffer is not empty|
|Typeahead|One character per `type`; the timer runs as the effects say|
|Selection|`select` and `deselect` acted on; the host reads `focused` to move real focus|

## Load state

**What the user sees.** A screen that loads from the server shows one of five
things: a skeleton while it loads, the content, an empty state, an error with
Try again, or the content while it refreshes. An error only takes over the
screen when there is nothing else to show.

Rules:

- A screen starts by loading.
- Opening the screen, or changing what it shows (another channel, for
  example), loads from scratch. Whatever was shown goes.
- Refreshing keeps the content on screen while it loads again.
- Refreshing an empty screen keeps the empty state.
- Refreshing after an error is the same as Try again.
- Refreshing while a load is already running starts no new load. A refresh the
  user started still marks that load as theirs.
- Try again on the error screen loads again. Anywhere else it does nothing.
- When the load succeeds, the screen shows the content, or the empty state if
  there is nothing.
- When the first load fails, the error screen replaces the skeleton.
- When a refresh fails, the content stays and a toast says what went wrong. The
  toast has the same id every time for that screen, so repeated failures
  replace one toast instead of stacking.
- A late answer from an earlier load is ignored.
- While a refresh the user started is running, the control that started it
  (the refresh button) shows it is busy. A refresh in the background shows
  nothing.

Parameters: `notifyId` (the toast id for this screen's refresh failures; each
screen sets its own).

**Example.** The member list loads and shows. The connection drops and the
list refreshes in the background; the refresh fails. The members stay on
screen, and a toast says "You are offline". It fails again a minute later: the
same toast is replaced, not added.

|Host checklist|Done when|
|---|---|
|Fetches|Every `fetch` reports one result with its token|
|Refresh|`byUser` set right; busy shown on the control while `refreshByUser`|
|Notify|`notify` goes to the toast queue with its id; `notifyId` set per screen|

## How to read a pattern file

Each pattern is a file in `design/behaviour/`, for example
`design/behaviour/toast-queue.json`. It holds:

- `pattern` and `doc`: the name and what the pattern is for.
- `params`: the settings, with defaults. A duration names its timing token,
  such as `motion.toast`.
- `state`: what the pattern remembers.
- `events`: what can happen, and what each event carries.
- `effects`: what the pattern can ask its host to do.
- `rules`: the behaviour in plain sentences, numbered from 1.
- `scenarios`: short stories, each a name and a list of events. `covers` says
  which rules a scenario shows. Every rule is covered by at least one scenario.

An event and an effect are written the same way: a name, then its fields.
`{"timerFired": {"token": 1}}` is the event "the timer with token 1 fired".

## How to read a vector

The generator runs each scenario through the Python definition and writes the
result to `design/vectors/behaviour.json`. That result is a vector. For each
event it gives the full state after it, and the exact effects, in order.

For example, the first step of "second toast waits":

- Event: `show` a toast "Saved".
- State: "Saved" is showing, the queue is empty, timer token 1.
- Effects: start timer 1 for 4000 ms, then announce "Saved", politely, with no
  action.

Nobody types the expected state by hand. Change a scenario or the definition,
run the generator, and the vectors follow. The web and native reducers are
then tested against them.

## Adding or changing a pattern

A pattern is part of the design system, so adding one, or changing a rule, is
a decision for the project owner (see [Extending the system](extending.md) and
the [three rules](README.md#three-rules)). Ask first. Do not change a pattern
to suit one screen.

Once it is agreed:

1. Change the rules and scenarios in the pattern file.
2. Change the Python definition (`design/gen/behaviour_ref.py`) and its tests.
   Each rule has a test named for it.
3. Run the generator: `python3 design/gen/gen_tokens.py`.
4. Change the web and native reducers until they pass the new vectors.
