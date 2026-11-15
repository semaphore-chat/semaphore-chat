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

Each pattern has one exact definition, written in Python. Both clients copy
it, and both are tested against the same examples, called vectors. A client
that disagrees with a vector is wrong.

This means a screen never handles Escape, toasts or confirmations by hand. It
uses the pattern, and the pattern decides.

The patterns are written. The web and native versions of each are landing
next.

## Timings

The patterns take their durations from the timing tokens (see
[Tokens and colour](tokens-and-colour.md#timings)).

|Token|ms|Used by|
|---|---|---|
|typeahead|500|How long typed letters in a list add up before they start again|
|toast|4000|How long a toast stays|
|toastAction|8000|How long a toast with an action, or a danger toast, stays|

## Toast queue

**What the user sees.** One toast at a time. If more arrive, they wait their
turn. Each one leaves on its own after a while, or when the user dismisses it.
While the pointer or focus is on a toast, it stays.

Rules:

- One toast shows at a time. A toast shown while nothing is showing appears at
  once, starts its timer and is announced to screen readers.
- A toast shown while another is showing waits at the end of the queue. It is
  not announced until it shows.
- A toast with the same id as the one showing replaces it. Its timer starts
  again and the new message is announced. Use this for a toast that changes,
  such as "Uploading" then "Uploaded".
- A toast with the same id as a waiting toast replaces that one in its place.
- At most three toasts wait. When a fourth arrives, the oldest waiting toast
  that is not danger is dropped. If they are all danger, the oldest is dropped.
- A neutral or positive toast stays for the toast timing. A toast with an
  action stays for the longer toastAction timing.
- A danger toast interrupts screen readers. The others wait for a pause. A
  danger toast still leaves on its own, after the longer timing.
- Dismissing the toast that is showing brings in the next one, or nothing.
- Dismissing a waiting toast removes it. Dismissing a toast that is not there
  does nothing.
- When the pointer or focus moves onto the toast, its timer stops. When both
  have left, the timer starts again from the full time, not from the time that
  was left.
- The pause belongs to the toast area, not to one toast. If the user dismisses
  a toast while the pointer is still there, the next toast shows but does not
  start its timer until the pointer leaves. When the last toast leaves, the
  pause ends.

Parameters: `durationMs` (toast), `durationWithActionMs` (toastAction),
`maxQueued` (3).

**Example.** "Saved" appears and starts a four-second timer. A danger toast,
"Couldn't send", arrives and waits. After four seconds "Saved" leaves and
"Couldn't send" appears, interrupts the screen reader, and stays eight seconds.

## Overlay stack

**What the user sees.** Escape closes the innermost thing first. A press
outside a menu or popover closes it. A press on the dimmed page closes the
dialog. When something closes, focus goes back where it came from.

The stack holds the layers above the screen: tooltips, menus, popovers,
dialogs and sheets (see [Which overlay](components.md#which-overlay)). Each
layer knows the layer it opened from, and the control that opened it.

Rules:

- Layers stack in the order they open. A tooltip always sits on top.
- Opening a layer that is already open does nothing.
- Escape asks the topmost layer to close. One Escape closes one layer, so
  nested layers close innermost first.
- Tooltips never block Escape. Escape closes any tooltip and also does what it
  would have done without it. A tooltip that appears over a dialog does not
  cost the user an extra key press.
- Escape with nothing open goes to the screen. The screen has its own order:
  close the docked panel, then mark as read.
- A press inside a layer that opened from another layer counts as inside both.
  A select list opened from a dialog is part of the dialog.
- A press outside a popover closes it, and the press carries on to what is
  underneath.
- A press outside a menu closes the menu and goes no further. The control under
  the press is not activated.
- A press outside a dialog or sheet is a press on its dimmed page. It asks the
  dialog to close and goes no further.
- A press never closes a tooltip. A tooltip closes when the pointer or focus
  leaves its control.
- Tab closes a menu. In any other layer, Tab moves focus as usual.
- Closing is a request. The screen may refuse it, for example a form with
  unsaved changes. A layer leaves only when its screen says it has closed.
- When a layer closes while layers opened from it are still open, those close
  first, innermost first.
- When a layer closes, focus goes back to the control that opened it. If that
  control has gone, focus goes to the layer it opened from. If that has gone
  too, the screen decides.
- Closing a tooltip does not move focus.

Parameters: none.

**Example.** A dialog is open, with a menu opened from it. The user presses
Escape: the menu closes and focus goes back to the menu's button in the dialog.
Escape again: the dialog closes and focus goes back to the button that opened
it.

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

## List focus

**What the user sees.** In a menu, a picker or a channel list, the arrow keys
move between rows, Home and End jump to the ends, and typing letters jumps to a
row. Disabled rows are skipped.

Rules:

- Only enabled rows take focus.
- In an empty list, or one where every row is disabled, keys do nothing.
- Down moves to the next row and Up to the previous one. With nothing focused,
  Down goes to the first row and Up to the last.
- At the ends, Down and Up stop. A list can choose to wrap round instead.
- Home goes to the first row and End to the last.
- When focus enters the list, it goes to the selected row, or to the first row
  if nothing usable is selected. This does not change the selection.
- Typing letters jumps to the first row whose label starts with them, from the
  focused row onwards and round. Case does not matter. The letters add up for
  half a second (the typeahead timing), then start again.
- Typing the same letter again steps through the rows that start with it.
- If no row matches, focus stays where it is.
- By default, moving focus does not select. Enter or Space selects the focused
  row.
- A list can choose to select as focus moves, for example tabs in a tab list.
- Clicking a row focuses and selects it. Clicking a disabled row does nothing.
- When rows change and the focused row goes away or becomes disabled, focus
  moves to the next row, or the previous one if there is none. The selection
  does not move with it.
- When the selected row goes away, nothing is selected.

Parameters: `wrap` (off), `selectionFollowsFocus` (off), `typeaheadMs`
(typeahead).

**Example.** A list has General, Games and Random. The user types "g": focus
goes to General. They type "g" again: Games. They type "r" after a pause:
Random.

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
- Refreshing an empty screen keeps the empty state, with no busy sign.
- Refreshing after an error is the same as Try again.
- Refreshing while a load is already running does nothing.
- Try again on the error screen loads again. Anywhere else it does nothing.
- When the load succeeds, the screen shows the content, or the empty state if
  there is nothing.
- When the first load fails, the error screen replaces the skeleton.
- When a refresh fails, the content stays and a toast says what went wrong.
- A late answer from an earlier load is ignored.

Parameters: none.

**Example.** The member list loads and shows. The connection drops and the
list refreshes; the refresh fails. The members stay on screen, and a toast says
"You are offline".

## How to read a pattern file

Each pattern is a file in `design/behaviour/`, for example
`design/behaviour/toast-queue.json`. It holds:

- `pattern` and `doc`: the name and what the pattern is for.
- `params`: the settings, with defaults. A duration names its timing token,
  such as `motion.toast`.
- `state`: what the pattern remembers.
- `events`: what can happen, and what each event carries.
- `effects`: what the pattern can ask its screen to do.
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
- Effects: start timer 1 for 4000 ms, then announce "Saved", politely.

Nobody types the expected state by hand. Change a scenario or the definition,
run the generator, and the vectors follow. The web and native versions are
then tested against them.

## Adding or changing a pattern

A pattern is part of the design system, so adding one, or changing a rule, is
a decision for the project owner (see the [three rules](README.md#three-rules)).
Ask first. Do not change a pattern to suit one screen.

Once it is agreed:

1. Change the rules and scenarios in the pattern file.
2. Change the Python definition (`design/gen/behaviour_ref.py`) and its tests.
   Each rule has a test named for it.
3. Run the generator: `python3 design/gen/gen_tokens.py`.
4. Change the web and native versions until they pass the new vectors.
