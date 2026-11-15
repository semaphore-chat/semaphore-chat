# Components

The kit is the app's own set of components. The web client and the native
client use the same names and the same options, so a screen built from the
kit looks and behaves the same in both.

Screens are built only from kit components. Do not make a one-off button,
field or label for a single screen. If you need something the kit does not
cover, do not improvise: follow [Extending the system](extending.md). The kit's provider supplies the colours and fonts to everything
inside it.

The live examples are the kit stories in `frontend/src/stories/kit/`. A story
id is the file name plus the export name, in lower-case words joined by
hyphens. The export `States` in `KitButton.stories.tsx` is `kit-button--states`.
The stories show each component in dark, light and tinted colour, and in its
states. Copy from them, not from a picture.

Thirty-seven components exist so far: Text, Button, Icon, IconButton, KeyCap,
Tabs, Switch, Checkbox, RadioGroup, Slider, TextField, SelectField, Avatar,
AvatarStack, MediaTile, Badge, Pill, Spinner, LinearProgress, Skeleton, Alert, LoadState,
Toast, ListRow, Table, Menu, Popover, Tooltip, Dialog, ConfirmDialog, Island,
Card, Sheet, Dock, DockDivider, DockItem and Stack.

## Rules every component follows

- **Props are a closed list.** A component takes only the variants and sizes
  listed for it. There is no per-use styling: no custom colour, width or
  padding. If none of the listed options fits, the system needs extending.
- **Every interactive control has a label.** The label may be hidden from the
  eye (`labelHidden`, or the `label` of an icon button), but it is never
  missing. Screen readers and keyboard users depend on it.
- **Hover only on devices that hover.** A touch screen never shows a stuck
  hover. Pressed and keyboard focus always show.
- **Disabled takes a control out of the tab order** and dims it.
- **Loading is not disabled.** A busy control stays focusable and reachable by
  keyboard. It tells assistive technology that it is busy, and it ignores
  clicks and Enter. Use `loading` for work in progress. Use `disabled` only
  when the action is not available. If both are set, `disabled` wins: the
  control is disabled and shows no spinner.
- **Motion is small and optional.** Animations only fade or move, use the
  timing tokens, and stop for people who ask their system for reduced motion.
- **Colours and sizes come only from the tokens and palette roles** described
  in [Tokens and colour](tokens-and-colour.md).

## How a screen is built

The ground is the page. Islands float on the ground and hold everything: a
screen is a few islands and nothing outside them. Inside an island go rows,
cards, text and controls. Overlays float above everything, and they are the
only thing that does.

|Layer|What it is|Palette role|
|---|---|---|
|Ground|The page behind everything|`ground`|
|Island|A large rounded panel that floats on the ground|`surface`|
|Card|A soft block inside an island|`fill`|
|Overlay|A Dialog, a Sheet or another floating panel|`surface`, with a border and a shadow|

The gap between islands belongs to the layout, not to the island. See
[Tokens and colour](tokens-and-colour.md) for the palette roles. The layout
templates that arrange islands into a screen are in [Layouts](layouts.md).

Kit pieces know which layer they sit on and adjust their own colours, so a
designer never picks a different colour for a button because it is on a card.
A soft Button on the ground or an island is `fill`; on a Card (itself `fill`)
it is `surface`; inside a Dialog opened from that Card it is `fill` again,
because an overlay panel is its own layer. A selected ListRow is the accent
layer, and the pieces in it switch to the colours that read on the accent.

## Text

All words on a screen that are not inside another component. It sets the type
style and the colour role of the words.

**Use it when** you show a title, a name, body copy, a small note or a tag.

**Do not use it when** the words are the label of a control. Pass them to that
control as its label. Do not use it to make a link or a button. Use a Button
with the `text` variant.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`variant`|`title`, `section`, `name`, `body`, `bodyStrong`, `meta`, `small`, `tag`|`body`|The type style. The sizes are in the Tokens and colour chapter.|
|`tone`|`default`, `secondary`, `dim`, `accent`, `danger`|`default`|The colour role of the words.|
|`as`|`span`, `p`, `div`, `label`, `h1` to `h6`|none|The page element, for structure. It does not change the look.|
|`truncate`|true, false|false|Cuts long text to one line with an ellipsis.|

Stories: `kit-text--variants`, `kit-text--tones`, `kit-text--truncated`,
`kit-text--variants-light`, `kit-text--tones-tinted`.

## Button

A control with a text label that starts an action.

**Use it when** the user does something: save, send, join, delete.

**Do not use it when** the control shows only an icon. Use IconButton. Do not
use it to switch between views or modes. Use Tabs. Do not use it to turn a
setting on or off. Use Switch.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`variant`|`primary`, `soft`, `ghost`, `danger`, `quietDanger`, `text`|`soft`|How loud the button is. See the guide below.|
|`size`|`sm`, `md`, `lg`|`md`|The size of the button.|
|`startIcon`|an icon|none|An icon before the label.|
|`fullWidth`|true, false|false|Stretches the button to the width of its space.|
|`loading`|true, false|false|The button is busy. See the rules above.|
|`disabled`|true, false|false|The action is not available.|
|`aria-disabled`|true, false|false|Not available right now, but still focusable: it reads as unavailable, looks dimmed and ignores clicks. Use it when focus may already sit on the button (Cancel while a ConfirmDialog works).|
|`type`|`button`, `submit`|`button`|Use `submit` for the button that sends a form.|

### Which variant

- `primary`: the one main action on a surface. Use one per surface.
- `soft`: ordinary actions.
- `ghost`: low-emphasis actions in toolbars and rows.
- `danger`: a destructive action that is the main action of a confirmation.
- `quietDanger`: a destructive action that sits among other actions.
- `text`: an inline action that reads like a link.

Stories: `kit-button--variants`, `kit-button--states`,
`kit-button--long-label`, `kit-button--focused`,
`kit-button--focused-ghost`, `kit-button--focused-danger`,
`kit-button--variants-light`, `kit-button--variants-tinted`.

## Icon

A small picture from the app's icon set. It is for looking at, not pressing.

**Use it when** an icon sits beside text or on its own as a plain symbol.

**Do not use it when** the user can press it. Use IconButton. Do not draw an
icon that is not in the set. Ask for it to be added.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`name`|a name from the icon set|none (required)|Which icon.|
|`size`|`xs`, `sm`, `md`, `lg`, `xl`|`md`|14, 16, 18, 20 or 24 pixels.|
|`tone`|`inherit`, `default`, `secondary`, `dim`, `accent`, `danger`, `positive`, `warning`|`inherit`|The colour role. `inherit` takes the colour of the text around it.|
|`label`|text|none|Names the icon. Give one when the icon alone carries meaning. Without one it is decoration.|

Stories: `kit-icon--all`, `kit-icon--sizes`, `kit-icon--tones`,
`kit-icon--all-light`.

## IconButton

A button that shows only an icon.

**Use it when** the action is well known from its icon and space is tight,
such as a toolbar or a row of actions.

**Do not use it when** the action needs words to be understood. Use Button.

It always needs a `label`. The label is not shown. It names the button for
screen readers.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`icon`|a name from the icon set|none (required)|Which icon.|
|`label`|text|none (required)|The accessible name.|
|`variant`|`ghost`, `soft`, `primary`, `danger`|`ghost`|The same looks as the Button variants of those names.|
|`size`|`sm`, `md`, `lg`|`md`|The size of the button.|
|`selected`|true, false|not set|Marks a toggle as on. It fills the button and gives the icon the accent colour.|
|`loading`|true, false|false|The button is busy. See the rules above.|
|`disabled`|true, false|false|The action is not available.|
|`focus`|`rowFocus(id)` from `useListFocus`|none|Joins a keyboard list: today the Dock's. The button is then one stop of the list's single Tab stop. A disabled button ignores it. See [Dock](#dock).|
|`badge`|a number|none|A count over the button's corner, the same danger Badge a DockItem shows (the Dock's Inbox). 0, or a number that is not finite, shows nothing. The count is added to the name: "Inbox, 9 unread".|
|`badgeMeaning`|`unread`, `mentions`|`unread`|What `badge` counts, in the name: "9 unread", or "1 mention" / "2 mentions".|
|`current`|true, false|false|The place you are in, for an item on the Dock: the accent ring a current DockItem has (a surface gap, then the accent), ", current" in the name before the count, and `aria-current="page"`. Not a toggle: use `selected` for that. With keyboard focus the focus ring moves outside the current ring (its usual offset, past the ring), so the two never overlap. Web kit only so far.|
|`hold`|`{ onStart, onEnd }`|none|Makes it a press-and-hold control (hold to talk). See below.|

**Press and hold.** With `hold` the button is held, not clicked: `onStart` runs
when a finger, pen or the main mouse button goes down on it, and `onEnd` runs
exactly once when that hold ends. The pointer is captured, so sliding off the
button keeps the hold, and lifting it anywhere ends it. The hold also ends when
the pointer is cancelled (a call, the system taking the gesture), when capture
is lost, when the button becomes disabled or stops being a hold control, and
when it unmounts, so nothing is left held with no finger on it. The button does
not scroll the page, select text or open the long-press menu. It has no pressed
state of its own: show a hold that is running with `variant` (the call bar uses
`primary` while it transmits). Keys do not hold it. Use it only where holding is
the action (hold to talk); for anything else use a plain button.

Web kit only so far; the native kit has not caught up (see
[Extending the system](extending.md#the-native-kit-is-catching-up)).

Stories: `kit-icon-button--variants`, `kit-icon-button--states`,
`kit-icon-button--focused`, `kit-icon-button--variants-light`,
`kit-icon-button--variants-tinted`, `kit-icon-button--badge-and-current`,
`kit-icon-button--badge-and-current-light`, `kit-icon-button--badge-and-current-tinted`,
`kit-icon-button--current-focused`, `kit-icon-button--current-focused-light`,
`kit-icon-button--current-focused-tinted`, `kit-icon-button--hold`,
`kit-icon-button--hold-light`.

## KeyCap

A small key shape that shows one keyboard key, such as a shortcut hint.

**Use it when** you tell the user which key to press.

**Do not use it when** the text is not a key. Use Text.

It takes one string as its content and has no options.

Stories: `kit-key-cap--keys`, `kit-key-cap--keys-light`.

## Tabs

A row of choices where exactly one is selected.

**Use it when** the user picks one of a few views or options, and the choice
stays visible.

**Do not use it when** the choice is a setting to turn on or off (use Switch),
one option out of a form that needs descriptions (use RadioGroup), or a long
list of options (use SelectField).

Each tab has an `id`, a `label`, and optionally a `count`, `disabled` and
`panelId`. The `label` prop names the whole row for screen readers. A tab with a
count is named "Mentions, 3" for screen readers; the eye sees the label and the
count as they are drawn. Clicking the tab that is already selected does nothing.

To link a tab to the panel it controls, give the tab a `panelId` (it becomes
`aria-controls`) and label the panel by the tab: every tab gets the id
`<list id>-tab-<tab id>`, and `tabElementId(listId, tabId)` returns it. Pass
your own `id` to Tabs so the screen can build the panel's `aria-labelledby`
with that helper. Without an `id`, Tabs makes one of its own, and the tab ids
are still unique on the page.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`variant`|`underline`, `segmented`|`underline`|The look. See below.|
|`fullWidth`|true, false|false|Spreads the tabs across the width of their space.|
|`value`|a tab id|none (required)|The selected tab.|
|`id`|text|made for you|The id of the row. Also the start of every tab's id.|

A row that is wider than its space scrolls inside it, with a thin scrollbar,
and starts scrolled so the selected tab is visible, also when `value` changes
from outside. Tabs takes no `ref`.

Keys come from the list focus pattern ([Behaviour](behaviour.md#list-focus)):
the row is one Tab stop (the selected tab), Left and Right and also Up and Down
move to the next or previous tab and select it, wrapping round, Home and End go
to the ends, and disabled tabs are skipped. There is no typeahead. When focus
comes back to the row, it lands on the selected tab, also if `value` changed
while focus was elsewhere. Tabbing in never changes the tab, and a tab is
chosen on click, not when the pointer goes down.

### Underline or segmented

- `underline`: switch between views of a page, such as the sections of a
  settings screen.
- `segmented`: filter or switch mode within one view. Keep it to a few short
  options.

Stories: `kit-tabs--underline`, `kit-tabs--segmented`,
`kit-tabs--with-counts`, `kit-tabs--overflow`, `kit-tabs--last-tab-selected`,
`kit-tabs--segmented-focused`, `kit-tabs--segmented-focused-light`,
`kit-tabs--segmented-light`, `kit-tabs--segmented-tinted`.

## Switch

A control that turns one setting on or off at once.

**Use it when** the change takes effect immediately, such as muting a sound.

**Do not use it when** the choice is part of a form that is saved later, or
when the user may choose several items from a list. Use Checkbox.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`checked`|true, false|none (required)|On or off.|
|`label`|text|none (required)|The name of the setting.|
|`description`|text|none|A line of help under the label.|
|`labelHidden`|true, false|false|Hides the text from the eye. It still names the switch.|
|`disabled`|true, false|false|The setting is not available.|

Stories: `kit-switch--states`, `kit-switch--focused`,
`kit-switch--long-label`, `kit-switch--switch-light`,
`kit-switch--switch-tinted`.

## Checkbox

A box the user ticks to include or exclude an item.

**Use it when** the user picks any number of items from a list, or agrees to
something in a form.

**Do not use it when** the change takes effect at once (use Switch) or when
exactly one option must be chosen (use RadioGroup).

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`checked`|true, false|none (required)|Ticked or not.|
|`indeterminate`|true, false|false|Shows a dash (the Minus icon) for a parent whose children are only partly ticked. The dash stays for as long as you pass `true`, also after a click: your `onChange` decides what happens next.|
|`label`|text|none (required)|The name of the choice.|
|`description`|text|none|A line of help under the label.|
|`labelHidden`|true, false|false|Hides the text from the eye. It still names the checkbox.|
|`disabled`|true, false|false|The choice is not available.|

Stories: `kit-checkbox--states`, `kit-checkbox--focused`,
`kit-checkbox--long-label`, `kit-checkbox--checkbox-light`,
`kit-checkbox--checkbox-tinted`.

## RadioGroup

A set of options where exactly one is chosen.

**Use it when** there are a few options and the user should see them all at
once, perhaps each with a description.

**Do not use it when** there are many options (use SelectField), when the
options are views of a page or a filter (use Tabs), or when the choice is a
single on or off (use Switch or Checkbox).

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`label`|text|none (required)|Names the group. Shown above the options unless `labelHidden`.|
|`labelHidden`|true, false|false|Hides the group label from the eye. It still names the group.|
|`options`|a list of `value`, `label`, and optionally `description` and `disabled`|none (required)|The choices.|
|`orientation`|`vertical`, `horizontal`|`vertical`|How the options are laid out.|
|`disabled`|true, false|false|The whole group is not available.|

Stories: `kit-radio-group--states`, `kit-radio-group--focused`,
`kit-radio-group--long-label`, `kit-radio-group--radio-group-light`,
`kit-radio-group--radio-group-tinted`.

## Slider

A control for choosing a number in a range by dragging.

**Use it when** the exact number matters less than the feel, such as a
volume.

**Do not use it when** the user must type an exact value. Number entry will be
its own component; TextField takes text only.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`label`|text|none (required)|Names the slider. Shown above it unless `labelHidden`.|
|`min`, `max`|numbers|0 and 100|The ends of the range.|
|`step`|a number|1|The size of one step. Values snap to the grid of steps counted from `min`, so a step of 0.1 gives 0.3 and not 0.30000000000000004.|
|`formatValue`|a function from number to text|none|Turns the value into the text shown beside the label, for example "80%". It is also what screen readers read.|
|`labelHidden`|true, false|false|Hides the label row from the eye. It still names the slider.|
|`disabled`|true, false|false|The slider is not available.|
|`ref`|a ref to an input element|none|Reaches the slider's input, so a form can focus it.|

The label uses the same style as the labels of fields.

Stories: `kit-slider--states`, `kit-slider--focused`,
`kit-slider--focused-at-min`, `kit-slider--focused-at-max`,
`kit-slider--formatted`, `kit-slider--long-label`,
`kit-slider--slider-light`, `kit-slider--slider-tinted`.

## TextField

A field where the user types text, on one line or on several.

**Use it when** the user enters a name, a message, a search, a password or any
free text.

**Do not use it when** the answer is one of a fixed list. Use SelectField or
RadioGroup.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`label`|text|none (required)|Names the field. Shown above it unless `labelHidden`.|
|`placeholder`|text|none|A hint inside the empty field. It does not replace the label.|
|`helper`|text|none|A line of help under the field.|
|`error`|text|none|An error message. It marks the field invalid and replaces the helper.|
|`required`|true, false|false|Marks the field as required.|
|`disabled`|true, false|false|The field is not available.|
|`labelHidden`|true, false|false|Hides the label from the eye. It still names the field.|
|`shape`|`field`, `round`|`field`|`field` is the standard shape. `round` is the fully rounded shape.|
|`type`|`text`, `password`, `email`, `search`, `url`|`text`|The kind of text. Numbers have no type here: number entry will be its own component.|
|`multiline`, `rows`|true, false; a number|false|Makes the field several lines tall.|
|`startIcon`|a name from the icon set|none|An icon at the start of the field.|

A multiline field without `rows` starts three rows tall and grows with its
text; one with `rows={1}` is as tall as a single-line field. The error message
is not a live region: an error that appears after a submit is read out when the
field gets focus again, not when it appears. Move focus to the first invalid
field after a failed submit.

Stories: `kit-text-field--states`, `kit-text-field--shapes`,
`kit-text-field--multiline`, `kit-text-field--narrow`,
`kit-text-field--states-light`, `kit-text-field--states-tinted`.

## SelectField

A field where the user picks one option from a list that opens on demand.

**Use it when** there are more options than fit on the screen, or the field
sits in a form beside other fields.

**Do not use it when** there are only a few options and they should all be
visible (use RadioGroup), or when the choice switches a view (use Tabs).

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`label`|text|none (required)|Names the field. Shown above it unless `labelHidden`.|
|`options`|a list of `value`, `label`, and optionally `disabled`|none (required)|The choices.|
|`placeholder`|text|none|Shown while the value matches no option.|
|`helper`|text|none|A line of help under the field.|
|`error`|text|none|An error message. It marks the field invalid and replaces the helper.|
|`disabled`|true, false|false|The field is not available.|
|`labelHidden`|true, false|false|Hides the label from the eye. It still names the field.|
|`ref`|a ref to an element|none|Receives the combobox element, so a form can focus the first invalid field.|

Clicking the label focuses the field without opening the list, as a native
select does. A `value` that matches no option shows the placeholder, and in
development MUI logs a warning about it; pass a value from `options` or an empty
string. The list's shadow is lighter in light mode than in dark mode.

Stories: `kit-select-field--states`, `kit-select-field--open`,
`kit-select-field--open-light`, `kit-select-field--long-options`,
`kit-select-field--select-field-light`,
`kit-select-field--select-field-tinted`.

## Avatar

A person's or community's picture. When there is no picture, it shows their
initials.

**Use it when** you show who someone is, or which community something belongs
to, beside a name, a message or a row.

**Do not use it when** the picture is a plain symbol. Use Icon. Do not use it
for a group of people. Use AvatarStack.

A person's or community's own colour is the one colour in the system that
comes from data, not from the palette. The app may show it a little lighter or
darker than they chose, so that the initials stay readable. People are
circles. Communities are rounded squares. If the picture is missing or fails
to load, the initials stay in its place and the layout does not move. A blank
name gives a person icon.

Presence is shown by a small dot at the bottom right, and each state has its
own shape as well as its own colour. `online` is a filled green dot. `away` is
a filled amber dot with a bar across it. `offline` is a hollow grey ring. For
`speaking` the whole avatar gets a green ring. The state is always also in the
accessible name, for example "Ana Ruiz, away".

When the picture has loaded, the initials are no longer painted, so a logo with
a transparent background shows no letters through it. The community colour still
shows behind such a logo. Before the picture loads, and when it fails, the
initials show. Punctuation and symbols at the start of a name are skipped, so
"(mike)" gives "MI".

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`name`|text|none (required)|Who it is. It is the accessible name and the source of the initials.|
|`src`|an image address|none|The picture, shown over the initials.|
|`colour`|a colour as `#rrggbb`|none|The person's or community's own colour. Without it the avatar uses the neutral fill.|
|`size`|`xs`, `sm`, `md`, `lg`, `xl`|`md`|20, 28, 36, 44 or 64 pixels. See Avatar sizes in the Tokens and colour chapter.|
|`shape`|`circle`, `rounded`|`circle`|`circle` for people, `rounded` for communities.|
|`presence`|`online`, `away`, `offline`, `speaking`|none|The dot or ring, and the state in the accessible name.|
|`decorative`|true, false|false|Hides the avatar from screen readers. Use it only when the person's name is written right beside it.|

Stories: `kit-avatar--sizes`, `kit-avatar--presence`,
`kit-avatar--communities`, `kit-avatar--fallbacks`, `kit-avatar--transparent-image`,
`kit-avatar--sizes-light`, `kit-avatar--presence-tinted`.

## AvatarStack

A few avatars overlapping in a row, with the rest counted as "+N".

**Use it when** you show who is in a group, such as the people in a voice
channel or the members of a conversation, in a small space.

**Do not use it when** each person needs to be read or pressed on their own.
Use a list of rows with an Avatar each.

The stack is named as a whole, for example "Ana, Ben and 2 more". It is one
image to a screen reader, and the avatars inside it are decorative. A blank name
is read as "Unknown user". A stack with no people shows nothing.

A person who is talking (`speaking`) wears the same green ring as an Avatar with
`presence="speaking"`, and the name says so after the names: "pri, dropbear and
aiko, dropbear is talking", or "pri and dropbear are talking" for two or more. The
name counts everyone who is talking, also someone behind the "+N", who has no ring
to show. More than three speakers are "A, B and 4 more are talking". A `label`
replaces the whole name, so it must say who is talking itself. A speaking avatar
does not overlap its neighbours: it and the avatar after it sit a ring's width
apart, so the ring is whole and covers no one's initials; the stack is its own
stacking context, so it never paints over anything outside it. (Avatar and MediaTile say ", speaking" in their
names; the stack says "is talking" because it names a group.)

Web kit only so far; the native kit has not caught up (see
[Extending the system](extending.md#the-native-kit-is-catching-up)).

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`people`|a list of `name`, and optionally `src`, `colour` and `speaking`|none (required)|Who is in the group. `speaking` draws the speaking ring on that avatar and adds them to the name.|
|`max`|a number|3|How many avatars to show before the "+N".|
|`size`|`xs`, `sm`, `md`, `lg`, `xl`|`sm`|The size of each avatar.|
|`label`|text|the shown names and "and N more"|The accessible name of the group.|

Stories: `kit-avatar--stack`, `kit-avatar--stack-speaking`,
`kit-avatar--stack-speaking-light`, `kit-avatar--stack-speaking-tinted`.

## MediaTile

A 16:9 rounded box for one participant's video, a shared screen, or, when they
have no video, their avatar.

**Use it when** you show a video call's picture of one person or one shared
screen: the call surface, the voice room.

**Do not use it when** you show a person in a list (use ListRow with an Avatar)
or a small round picture (use Avatar). It draws no controls: put buttons beside
it, not in it.

The tile is one group named by its `label`, with ", speaking" added while
`speaking` is on; the ring is the same green ring Avatar uses for speaking, so
the state is in the name as well as the colour. The tile has no video of its own:
give it `videoRef` and it renders a muted, inline, auto-playing `<video>` that
fills the tile (a `screen` is shown whole, a `camera` fills the box), and the
label moves to a chip at the bottom left, so it reads on any picture. Without
`videoRef`, or for `avatar`, the label is centred, with a large Avatar above it
for `avatar`. A long label is cut with an ellipsis. The box is always 16:9 and
as wide as its container; the container sets the size. A blank label reads
"Unknown user".

**Attaching a video.** `videoRef` is a callback ref, not a ref object. The
`<video>` element is drawn only while `videoRef` is set and `kind` is not
`avatar`, and a new element is made whenever that changes (and when the tile
remounts, for example when a keyed grid reorders). So attach the stream in the
callback and detach on `null`:

```tsx
const shown = useRef<HTMLVideoElement | null>(null);
const attach = useCallback(
  (element: HTMLVideoElement | null) => {
    if (element !== null) track.attach(element); // or element.srcObject = stream
    else if (shown.current !== null) track.detach(shown.current);
    shown.current = element;
  },
  [track],
);
<MediaTile kind="camera" label="pri" videoRef={track ? attach : undefined} />
```

Pass `videoRef` only while the track is live. When the track ends, or the person
turns the camera off, pass `undefined` (and, for a camera, change `kind` to
`avatar`): the tile falls back to the label or the avatar and the callback gets
`null`. When `kind` changes between `screen` and `camera` the same element stays
and its `object-fit` changes. Until the first frame the tile shows only its fill
and the chip.

**Small tiles.** The tile measures its own width (a container query, widths
from the avatar, spacing and text tokens). An avatar tile below about 203 px steps
the avatar from `xl` to `lg`, below about 168 px it also takes the smaller
padding (`md` avatar from about 139 px), and below that the name under the avatar
goes: it is still the group's name. Nothing is cut off at any width, so two tiles
side by side on a phone are fine.

**Room for the ring.** The speaking ring is drawn outside the box by two
`border.selected`. A container that clips (`overflow` hidden or auto) must leave
that much room around the tile, or the ring is cut at the edges.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`label`|text|none (required)|Whose tile or what it shows. The accessible name, the caption and the source of an avatar tile's initials.|
|`kind`|`screen`, `camera`, `avatar`|none (required)|What the tile is. `avatar` never draws a video.|
|`speaking`|true, false|false|The speaking ring, and ", speaking" in the name.|
|`videoRef`|a callback `(element: HTMLVideoElement or null) => void`|none|Draws a `<video>` for `screen` and `camera` and hands it to you; called with `null` when it goes. See above.|

Stories: `kit-media-tile--kinds`, `kit-media-tile--kinds-light`,
`kit-media-tile--kinds-tinted`, `kit-media-tile--speaking`,
`kit-media-tile--speaking-light`, `kit-media-tile--long-label`,
`kit-media-tile--small-tiles`, `kit-media-tile--small-tiles-light`,
`kit-media-tile--phone-pair`.

Web kit only so far; the native kit has not caught up (see
[Extending the system](extending.md#the-native-kit-is-catching-up)).

## Badge

A count, or a dot, attached to something else.

**Use it when** you show how many unread messages, mentions or requests an item
has, or that something needs attention.

**Do not use it when** you name a state or a category in words. Use Pill. A
Badge is not clickable. Put it on an item that is.

A count of 0 shows nothing. A count above `max` reads "99+". The number alone
does not say what it counts, so a Badge always has a `label`, such as
"3 unread".

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`label`|text|none (required)|What it means. It is the accessible name.|
|`count`|a number|none|The number to show.|
|`max`|a number|99|The largest number shown. Above it the badge reads, for example, "99+".|
|`dot`|true, false|false|A small dot with no number. It shows even when there is no count.|
|`tone`|`accent`, `danger`|`danger`|The colour role.|

Stories: `kit-badge--counts`, `kit-badge--counts-light`,
`kit-badge--counts-tinted`.

## Pill

A short word that names a state or a category.

**Use it when** you label a role, a status or the selected item: "Admin",
"Live", "Muted".

**Do not use it when** you show a count. Use Badge. Do not use it as a button
or a filter. A Pill is not clickable. Use Button, or Tabs for filters. Keep the
text to a word or two.

The text always carries the meaning. The dot or icon is decoration. A tone
other than `accent` colours the text on the neutral fill, so the word stays
readable.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`children`|text|none (required)|The word.|
|`tone`|`neutral`, `accent`, `danger`, `positive`, `warning`|`neutral`|The colour role.|
|`dot`|true, false|false|A dot before the text, in the colour of the tone.|
|`icon`|a name from the icon set|none|An icon before the text.|
|`size`|`sm`, `md`|`md`|The size of the pill.|

Stories: `kit-pill--tones`, `kit-pill--tones-light`, `kit-pill--tones-tinted`.

## Spinner

A small turning ring that shows something is working.

**Use it when** a short wait happens inside a control or a small panel, such as
a button that is busy. For a button, use its `loading` option, which uses a
Spinner for you.

**Do not use it when** content is loading in place and you know its shape. Use
Skeleton. Do not use it when the wait spans a region or has a known length. Use
LinearProgress.

It takes the colour of the text around it. The ring is a fixed arc that turns;
it does not grow and shrink, and it stops under reduced motion. Without a `label` it is decoration
and is hidden from screen readers. Give a `label` when the spinner is the only
sign that something is busy.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`size`|`xs`, `sm`, `md`, `lg`, `xl`|`sm`|The same sizes as Icon.|
|`label`|text|none|Names the busy state for screen readers.|

Stories: `kit-spinner--sizes`.

## LinearProgress

A thin bar that shows a wait across a region, such as an upload or a page.

**Use it when** the wait spans a region. Give it a `value` when you know how far
along it is. Leave the value out when you do not, and the bar slides.

**Do not use it when** the wait is short and sits inside a control. Use
Spinner. Do not use it when content is loading in place. Use Skeleton.

It always has a `label` that says what is in progress. A value outside 0 to 100
is held to that range. The bar keeps rounded ends at every value. Under reduced
motion the sliding bar becomes a full, dimmed bar, which reads as "busy" and
not as a number.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`label`|text|none (required)|What is in progress. It is the accessible name.|
|`value`|0 to 100|none|How far along it is. Without it the bar has no known length.|
|`tone`|`accent`, `positive`, `danger`|`accent`|The colour role of the bar.|

Stories: `kit-linear-progress--values`, `kit-linear-progress--values-light`,
`kit-linear-progress--values-tinted`.

## Skeleton

A grey placeholder in the shape of content that is still loading.

**Use it when** content is loading in place and you know its shape: lines of
text, a round picture, a block.

**Do not use it when** the shape is not known, or the wait is inside a control.
Use Spinner. Do not use it for a wait that spans a region. Use LinearProgress.

A Skeleton is hidden from screen readers. Name the loading state somewhere else
on the screen, for example with a Spinner that has a `label`. The `shape`
decides which other option applies.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`shape`|`text`, `circle`, `rect`|none (required)|The shape of the placeholder.|
|`lines`|a number|1|For `text`: how many lines, from 1 to 20 (anything else is held to that range). Each line is as tall as a line of body text.|
|`size`|`xs`, `sm`, `md`, `lg`, `xl`|`md`|For `circle`: the same sizes as Avatar.|
|`height`|`sm`, `md`, `lg`|`lg`|For `rect`: the same heights as a control, 32, 40 or 48 pixels.|

Stories: `kit-skeleton--shapes`, `kit-skeleton--shapes-light`.

## Alert

A message that belongs to a place on the page.

**Use it when** you tell the user something about the screen they are on, and it
should stay until the situation changes or they dismiss it: a connection
problem, a warning above a form, a note about a setting.

**Do not use it when** the message is about something that just happened and
can pass. Use Toast. Do not use it for an error on one field. Use the `error` of
that field.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`severity`|`info`, `success`, `warning`, `danger`|none (required)|What kind of message. It sets the icon and its colour.|
|`title`|text|none|A bold first line.|
|`children`|text or content|none (required)|The message.|
|`action`|a `label` and an `onClick`|none|One action, shown as a text button under the message.|
|`secondaryAction`|a `label` and an `onClick`|none|A second text button beside `action` (Join and Decline on an incoming call). It is a choice, not a dismiss: dismissing is `onClose`. The buttons wrap onto a second line when they do not fit.|
|`onClose`|a function|none|Adds a Dismiss button. Without it the alert cannot be dismissed.|
|`announce`|true, false|true|Whether screen readers speak it when it appears.|

`warning` and `danger` interrupt screen readers when they appear. `info` and
`success` wait for a pause. Screen readers speak a live message when it shows
up, so a banner that is already on the page when it loads would be read out on
every visit. For those, pass `announce={false}`: the alert becomes a quiet note.
Leave it on for an alert that appears because something happened.

Stories: `kit-alert--severities`, `kit-alert--severities-light`,
`kit-alert--severities-tinted`, `kit-alert--with-actions`,
`kit-alert--long-text`, `kit-alert--secondary-action`,
`kit-alert--secondary-action-light`, `kit-alert--secondary-action-long`,
`kit-alert--secondary-action-one-long`.

Web kit only so far; the native kit has not caught up (see
[Extending the system](extending.md#the-native-kit-is-catching-up)).

## LoadState

What a screen shows while it loads from the server: a skeleton, the content, an
empty state, an error, or the content while it refreshes.

**Use it when** a region of a screen fetches its data and has to show all of
those faces. Pass it the controller from `useLoadState` or `useQueryLoadState`
(see [Behaviour](behaviour.md#load-state)).

**Do not use it when** the wait is inside a control (a button's own `loading`),
or when the content has no empty or error face worth drawing.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`state`|the controller from `useLoadState` or `useQueryLoadState`|none (required)|Which face to show, and what Try again calls.|
|`label`|text|none (required)|Names the region: "Members" reads "Loading members".|
|`skeleton`|content|none (required)|Skeletons in the shape of the content.|
|`empty`|content|none (required)|What shows when there is nothing to show.|
|`errorTitle`|text|none (required)|The first line of the error: "Couldn't load members".|
|`children`|content|none (required)|The content, shown when ready and while refreshing.|

- Loading: the skeleton and `aria-busy` on the region. A visually hidden `status`
  reads "Loading members". It sits outside the busy region (a screen reader may
  hold back changes inside one), is on the page on every face, and gets its text
  one commit after it mounts, so it is announced. The Skeleton itself is hidden
  from screen readers.
- The region is a `group` named by `label`, focusable by script only
  (`tabIndex={-1}`). Try again moves focus to it as the button goes, so focus
  does not fall to the page, but only if focus is still on the page body then:
  focus the user moved elsewhere stays. It shows the kit focus ring on
  `:focus-visible` (after a keyboard Try again), none after a pointer press.
- The error face offers Try again only when `state.retryable` (an offline
  first load has none: it loads by itself when the connection returns).
- Error: a `danger` Alert with `errorTitle` and a Try again button, and the
  controller's message as its body when there is one (a screen's
  `errorMessage`, or the offline text). The default failure has no body: the
  title says what failed and the button what to do. It only shows when there
  is nothing else to show.
- Refreshing: the content stays, with `aria-busy`. The refresh button reads
  `state.refreshByUser` for its own `loading`, so only a refresh the user started
  shows busy.
- A failed refresh does not replace the content. The toast host shows it.

Stories: `kit-load-state--loading`, `kit-load-state--loading-light`,
`kit-load-state--ready`, `kit-load-state--empty`, `kit-load-state--empty-light`,
`kit-load-state--error-with-retry`, `kit-load-state--error-with-retry-light`,
`kit-load-state--error-with-message`,
`kit-load-state--refreshing`, `kit-load-state--user-refresh-busy`,
`kit-load-state--user-refresh-busy-light`, `kit-load-state--error-offline`,
`kit-load-state--live`, `kit-load-state--refresh-fails-toast`.

## Toast

A passing notice about something that just happened.

**Use it when** you confirm or report the result of an action: "Message sent",
"Could not save".

**Do not use it when** the message belongs to a place on the page or must stay
until the user acts. Use Alert.

A Toast is only the look of one notice. How long toasts stay and how they queue
belong to the [Behaviour](behaviour.md#toast-queue) chapter.

A `danger` toast interrupts screen readers when it appears. The others wait for
a pause. `announce={false}` makes a toast a quiet note, for one that is already
on the page at load.

**Screens never render a Toast.** They call `useToasts()` from the kit, from
event handlers and effects (never while rendering):
`show({ id, tone, message, action })` returns the toast's id, and `dismiss(id)`
takes it away. `action` is `{ label, onAction }`; pressing it dismisses the
toast and then runs `onAction`, so a follow-up shown under the same id (Retry
failing again) stays. An action that throws or rejects is reported and the
queue carries on. Use one `id` per subject (`'offline'`,
`` `upload-${fileId}` ``), so a second report replaces the first. `AppFrame`
renders the toast region where [Layouts](layouts.md#where-toasts-sit) says, and
the host announces each toast, so the region's Toast is quiet. A screen's
bottom-pinned element (the composer) calls `useToastClearance(ref)` so toasts
sit above it. Rendering `Toast` directly is for the kit and its stories.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`message`|text|none (required)|What happened.|
|`tone`|`neutral`, `positive`, `danger`|`neutral`|The colour role. `positive` and `danger` add an icon.|
|`action`|a `label` and an `onClick`|none|One action, shown as a text button, such as "Undo".|
|`onClose`|a function|none|Adds a Dismiss button.|
|`announce`|true, false|true|Whether screen readers speak it when it appears.|

Stories: `kit-toast--tones`, `kit-toast--tones-light`,
`kit-toast--tones-tinted`, `kit-toast--long-message`; the region on the
templates: `kit-toast-region--in-call` and the others listed in
[Layouts](layouts.md#where-toasts-sit).

## ListRow

One row in a list of channels, people or places. It is the row of every list
the user can move through or pick from.

**Use it when** you show a list of things the user opens, picks or just reads:
channels, direct messages, members, settings pages.

**Do not use it when** you compare records by column (use Table), or when the
row is a free-form card with its own layout.

A row takes one of three forms, set by what you pass it:

- A link, when it goes somewhere. Pass `href`.
- A button, when it does something. Pass `onClick`.
- Plain, when it only shows information. Pass neither.

The whole row is the hit area of a link or a button: a press on the padding or
the gap beside the text counts too, and so does the pointer cursor. `trailing`
sits beside the link or button, not inside it, so it may hold buttons of its
own. It sits above the row's hit area, so a press on one of those buttons is
that button's, and it does not show the row as pressed. The focus ring outlines
the whole row. On a selected row it is drawn in the ink that reads on the
accent, just inside the pill, because a ring in the focus colour would vanish
into the accent (and the selected row is a keyboard list's Tab stop).

`selected` draws the solid accent pill. It is the system's "selected row": it
means "this is the current item", such as the channel you are in. Use it on one
row of a list. It also tells assistive technology which item is current. On a
selected row the text takes the colour that reads on the accent, so `unread` and
`muted` do not change how it looks.

Kit components in `leading` and `trailing` know which layer they sit on. On the
accent pill (a selected row) they switch to the colours that read on it: an
Icon, Text or ghost or soft IconButton takes the on-accent ink, and an accent
Badge or Pill turns round (an on-accent fill with accent text) so it stays
visible. A danger Badge and the status Pills keep their own colours. An
unselected row does not reset the layer: it keeps what is around it, so a row
inside a Card is on the Card (its hover and pressed tint are mixed over the
Card's fill, and a soft IconButton in `trailing` draws on `surface`). A Menu or
Popover opened from a button in the row is its own layer and draws normally,
even from a selected row. Content that is not a kit component does not get any
of this, so keep it out of the slots of a selected row, or give it colours that
read on the accent.

`unread` makes the main line bolder and brings it to the full text colour. `muted`
dims both lines. Disabled dims the row and a disabled link or button cannot be
used.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`primary`|text|none (required)|The main line. It is cut to one line with an ellipsis.|
|`secondary`|text|none|A second, smaller line. It is cut to one line too.|
|`leading`|an Avatar or an Icon|none|What sits before the text. See below.|
|`trailing`|a Badge, a Pill or an IconButton|none|What sits at the end of the row. See below.|
|`size`|`md`, `lg`|`md`|`md` is one line high and fully rounded. `lg` has room for two lines and rounded corners like a card.|
|`selected`|true, false|false|The current item: the solid accent pill.|
|`unread`|true, false|false|A bolder main line in the full text colour, and ", unread" in the row's name.|
|`trailingLabel`|text|none|What the trailing slot means, added to the row's name ("2 mentions", "admin"). See below.|
|`muted`|true, false|false|Both lines dimmed.|
|`disabled`|true, false|false|The row is not available.|
|`href`|an address|none|Makes the row a link.|
|`onClick`|a function|none|Makes the row a button.|
|`focus`|`rowFocus(id)` from `useListFocus`|none|Joins a keyboard list. See below.|

`leading` holds an Avatar (a person or a community) or an Icon (a channel, a
setting). The text lines up in the same place whichever you use. `trailing`
holds a Badge for an unread count, a Pill for a short tag, or an IconButton for
a row action such as "More". Put one thing there, or a few small ones. The slot takes at most half
the row: a long tag (a role written out in full) cuts with an ellipsis instead of
squeezing the name (`kit-list-row--long-trailing-pill`). Web kit only so far; the
native kit has not caught up (see [Extending the system](extending.md#the-native-kit-is-catching-up)).

`trailing` sits outside the row's link or button, so its meaning is not in the row's
name. Pass it as words in `trailingLabel` ("2 mentions", "admin"): the row adds them
to its accessible name after the main line, and `unread` adds ", unread". A channel
row reads "clips, unread, 2 mentions"; a member row "Samira, admin, keeping the
server warm". Never put a per-screen `aria-label` on a row instead. Web kit only so
far.

### A keyboard list

A list the user moves through with the keyboard (a channel list, a member
list, a picker) is built with `useListFocus` and the `focus` prop. The list is
then one Tab stop: Up and Down move between rows, Home and End jump to the
ends, typing a name jumps to it, and Enter or Space (or a click) chooses the
row. Disabled rows are skipped.

```tsx
const list = useListFocus({
  rows: channels.map((c) => ({ id: c.id, label: c.name, disabled: c.locked })), // every row, also unrendered ones
  selected: currentChannelId,           // the route: the pattern follows it, it never moves focus
  onSelect: (id) => markOpened(id),     // optional for links: the link has already navigated
});
<nav aria-label="Channels">
  <div {...list.listProps}>
    {channels.map((c) => (
      <ListRow key={c.id} primary={c.name} href={`/c/${c.id}`} selected={c.id === currentChannelId}
        disabled={c.locked} focus={list.rowFocus(c.id)} />
    ))}
  </div>
</nav>
```

- Rows in a keyboard list are links or buttons; a plain row ignores `focus`.
  Keep `disabled` on the row and in `rows` the same.
- `focus` is opaque: pass what `rowFocus(id)` returns, nothing else. The row's
  own `onClick` still runs; put an action in `onClick` or in `onSelect`, not in
  both.
- Controls in `trailing` leave the Tab order while the row is in a keyboard
  list: Right moves from the row into them and Left back, and Up or Down go on
  to the next row. A row action that matters must also be reachable some other
  way (the row's menu, the opened page).
- `orientation: 'horizontal'` adds Left and Right as movement (as Tabs does);
  `wrap`, `selectionFollowsFocus` and `typeahead` are the pattern's parameters.
- A virtualised list passes the whole list as `rows` and a `reveal(id)` that
  scrolls the row into the rendered window; the host focuses it once it is there.

Stories: `kit-list-focus--channel-list`, `kit-list-focus--channel-list-light`,
`kit-list-focus--channel-list-focused`, `kit-list-focus--channel-list-focused-light`,
`kit-list-focus--button-rows`, `kit-list-focus--selection-from-outside`,
`kit-list-focus--selection-from-outside-light`.

Stories: `kit-list-row--states`, `kit-list-row--channels`,
`kit-list-row--people`, `kit-list-row--long-names`,
`kit-list-row--states-light`, `kit-list-row--states-tinted`,
`kit-list-row--selected-with-trailing`,
`kit-list-row--selected-with-trailing-light`.

## Table

Records laid out in rows, with one column for each kind of fact.

**Use it when** the user compares records by column: members and their roles,
invites and their expiry dates.

**Do not use it when** you want to lay out a page. A table is for data only. Do
not use it for a list of channels or people with an icon and a name each. Use
ListRow.

The table has real table structure, so screen readers announce the columns. It
has a thin line between rows, no stripes and no outer border. A cell takes text
or kit components, such as a Pill or an IconButton. A table that is too wide for
its space scrolls sideways inside its own box and not the page. The box can take
keyboard focus, so a keyboard user can scroll it.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`label`|text|none (required)|Names the table for screen readers. It is not shown.|
|`columns`|a list of `id`, `header` and optionally `align`|none (required)|The columns. `align` is `start` or `end`; use `end` for numbers.|
|`rows`|a list of `id` and `cells`|none (required)|The records. `cells` holds one entry for each column `id`.|
|`empty`|text|none|Shown across the whole table when there are no rows.|

Stories: `kit-table--basic`, `kit-table--empty`, `kit-table--narrow`,
`kit-table--basic-light`, `kit-table--basic-tinted`.

## Stack

Children one under the other with a fixed space between them.

**Use it when** a few blocks inside an island, a Card or an overlay's body need
the system's vertical rhythm: a heading, a field, then a list.

**Do not use it when** the rows are a list (ListRows sit flush, with no gap),
or you need a whole screen arranged (use a layout template).

It is layout only: no surface, no padding, no semantics of its own.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`gap`|`xs`, `sm`, `md`, `lg`, `xl`|none (required)|The space between the children: 4, 8, 12, 16 or 24 pixels.|
|`children`|content|none (required)|The blocks.|
|`direction`|`column`, `row`|`column`|`row` puts the children side by side, centred on the cross axis, each keeping its own width (an Avatar, a button), except a Stack with `fill`.|
|`fill`|true, false|false|In a row: this Stack takes the room the others leave, and text in it can cut with an ellipsis (`truncate`). Use it for the name and line beside an avatar. It is for a child of a row only.|
|`align`|`stretch`, `start`|`stretch`|In a column: `start` keeps each child its own width (a Pill under a name), never wider than the Stack.|

A row is for a few pieces that belong together on one line: an avatar, a name with
its line under it, and a control at the end (a header, the user's card, a voice
room's title). A list of things is still ListRows. A row centres its children on the
cross axis; there is no justify or wrap.

`direction`, `fill` and `align` are web kit only so far; the native kit has not
caught up (see [Extending the system](extending.md#the-native-kit-is-catching-up)).

Web kit only so far; the native kit has not caught up (see
[Extending the system](extending.md#the-native-kit-is-catching-up)).

Stories: `kit-stack--gaps`, `kit-stack--gaps-light`, `kit-stack--gaps-tinted`, `kit-stack--rows`,
`kit-stack--rows-light`, `kit-stack--rows-tinted`.

## Which overlay

Five components float above the page. Choose by what the thing holds and by
how much it should stop the user. For a message about something that happened,
use Toast or Alert instead.

|Overlay|What it holds|Blocks the rest of the page?|How it closes|
|---|---|---|---|
|Tooltip|A few words of text|No|It closes on its own when the pointer or focus leaves, or on Escape.|
|Menu|A list of actions on one thing|Yes, until it closes|Choosing an item, Escape, a press outside, or Tab.|
|Popover|A small piece of interface: a short form, a picker, a few controls|No|Escape or a press outside.|
|Dialog|A decision that needs an answer|Yes|A button in it, Escape, or a press on the dimmed page.|
|Sheet|Browsing many things, or a longer task|Yes|Its Close button, a button in it, Escape, or a press on the dimmed page.|

Overlays stack in the order they were opened, and a tooltip sits above all of
them. A Menu, a select list or a Popover that opens from inside a Dialog is on
top of the Dialog, and Escape closes the innermost layer first. A layer opened
from inside another closes with it: when the Dialog closes, the Popover open in
it closes too, and its `onClose` is called. Nothing in a screen sets a layer
number, and no screen handles Escape or a press outside for an overlay: the
overlay stack does (see [Overlay stack](behaviour.md#overlay-stack)).

Inside a Dialog, a Popover, Tooltip, Menu or select list is drawn within the
Dialog, so its focus trap lets focus into them. The other way round, a Dialog
opened from a Popover works too (and the Popover stays open under it).
## Menu

A short list of actions that opens from a control, such as a "More" button.

**Use it when** the user picks one action to do to a thing: rename, copy a link,
delete.

**Do not use it when** the user picks a value for a field (use SelectField), or
when the panel needs controls other than actions (use Popover). A Menu closes
after one choice.

The menu opens from an `anchor`, which is the element that opened it. Each item
has a label and does one thing when chosen. An item may have an icon, keyboard
shortcut keys shown as KeyCaps, a `danger` tone for a destructive action, and a
disabled state. A divider groups items. Put the destructive item last, apart
from the rest.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`open`|true, false|none (required)|Whether the menu is showing.|
|`anchor`|the element it opens from|none (required)|Where the menu sits.|
|`onClose`|a function|none (required)|Called when the menu should close.|
|`label`|text|none (required)|Names the menu for screen readers.|
|`items`|a list of entries|none (required)|Each entry is an item or a divider. See below.|
|`placement`|`bottom-start`, `bottom-end`, `top-start`, `top-end`|`bottom-start`|Which side of the anchor, and which edge it lines up with.|

An item has an `id`, a `label` and an `onSelect` function, and optionally an
`icon`, a `shortcut` (a list of keys, one KeyCap each), a `tone` (`default` or
`danger`) and `disabled`. A divider is an entry with an `id` and `divider` set
to true.

Stories: `kit-menu--open`, `kit-menu--placements`, `kit-menu--open-light`,
`kit-menu--open-tinted`.

## Popover

A small floating panel tied to a control. It holds a little interface of its
own.

**Use it when** the user needs a few controls close to the thing they act on:
an emoji picker, a short form, a set of filters.

**Do not use it when** the content is a list of actions (use Menu), a few
words of explanation (use Tooltip), or a decision the user must answer before
going on (use Dialog). A Popover may open from a control inside a Dialog: it is
drawn within the Dialog and takes focus there.

A Popover does not block the page. It has no dimmed backdrop, and the page
behind it can still scroll. It is opened from an `anchor`, the element that
opened it. It must always have a `label`, which names the panel for screen
readers. The panel flips to the other side of the anchor when there is no room.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`open`|true, false|none (required)|Whether the popover is showing.|
|`anchor`|the element it opens from|none (required)|Where the popover sits. Focus returns to it on close.|
|`onClose`|a function|none (required)|Called on Escape and on a press outside.|
|`label`|text|none (required)|Names the panel for screen readers.|
|`placement`|`bottom-start`, `bottom-end`, `top-start`, `top-end`|`bottom-start`|Which side of the anchor, and which edge it lines up with.|
|`padding`|`none`, `md`, `lg`|`md`|The space inside the panel. Use `none` when the content brings its own, such as a list of rows.|

Other overlays can open from inside a Popover: a select list, a Menu or a
Dialog. A press or an Escape in them belongs to them. The Popover closes only
when the press or the key is outside all of them. A tall Popover has no maximum
height; keep its content short.

Stories: `kit-popover--open`, `kit-popover--open-compact`,
`kit-popover--open-light`, `kit-popover--inside-dialog`.

## Tooltip

A few words of text that name or explain a control.

**Use it when** a control shows only an icon and a short name helps, or when a
control needs one line of explanation.

**Do not use it when** the text is long, holds a link or a button, or is the
only place a piece of information lives. A Tooltip holds text only. Make it a
few words. People on touch screens never see tooltips. So a tooltip repeats or
explains what the control is called. It never carries something the user must
know. Put that on the page, or in a Popover.

A Tooltip wraps one control. The control keeps its own name for screen readers.
The tooltip adds its text as a description while it is showing. It is added to
the element that takes focus (the input of a field, the button of a Switch) and
sits beside any description the control already has, such as helper text.

A tooltip on a disabled control will not show: a disabled control takes no
focus, and some browsers send it no pointer events. Put that text beside the
control instead. The panel cannot be hovered, so it closes as soon as the
pointer leaves the control. That is fine for a few words; it is one more reason
not to put more in it. A tap on a text field never opens it.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`label`|text|none (required)|The text. Never anything clickable.|
|`placement`|`top`, `bottom`, `left`, `right`|`top`|Which side of the control. It moves to the other side when there is no room.|

Stories: `kit-tooltip--shown`, `kit-tooltip--long-label`,
`kit-tooltip--shown-light`.

## Dialog

A box that interrupts the screen to ask for a decision.

**Use it when** the user must answer before going on: confirm a deletion, give a
name, accept a choice. It is the modal for a decision. It dims the page and
nothing behind it can be used until it closes.

**Do not use it when** the information can sit on the page (use Alert), when it
is a passing notice (use Toast), or when the user can carry on without
answering (use Popover).

Rules for the actions:

- Put the safe action first, such as "Cancel". Focus starts on the first action,
  so a stray Enter does the safe thing. On a phone the buttons stack in the same
  order, with the safe action on top.
- A destructive confirmation names what will be lost, in its title or its
  description: "Delete #general?", "This removes 214 messages for everyone."
  A bare "Are you sure?" is not enough.
- Use a Button with the `danger` variant for the destructive action.

The parent decides whether the dialog closes. `onClose` is called on Escape and
on a press on the dimmed page, and the dialog stays open until `open` is false.
`onClose` says why: `'escape'` or `'scrim'`, which the parent may refuse (unsaved
changes), or `'parentClosed'`. A dialog opened from inside another layer (a
Popover, say) closes when that layer closes; then `onClose('parentClosed')` is a
notice, not a request: the dialog is already closed whatever `open` says, so set
`open` to false, even when there are unsaved changes.

A select list, a Menu, a Popover or a Tooltip may open from inside a Dialog.
Escape closes that layer first and the Dialog on the next press. The dialog has
the role `dialog`, not `alertdialog`, so a scrim press closes a destructive
confirmation too; keep the safe action first.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`open`|true, false|none (required)|Whether the dialog is showing.|
|`onClose`|a function, given `'escape'`, `'scrim'` or `'parentClosed'`|none (required)|Called on Escape, on a press on the dimmed page, and when the layer it was opened from closes.|
|`title`|text|none (required)|Names the dialog. It is the heading.|
|`description`|text|none|A line under the title that says more.|
|`children`|content|none|The body, such as a field. It sits between the description and the actions.|
|`actions`|Buttons|none (required)|The buttons, safe action first.|
|`size`|`sm`, `md`|`sm`|The width. `sm` is 400 pixels and `md` is 560. On a narrow screen the dialog keeps the page gutter on both sides.|

Stories: `kit-dialog--confirm`, `kit-dialog--with-content`,
`kit-dialog--phone`, `kit-dialog--confirm-light`,
`kit-dialog--confirm-tinted`, `kit-dialog--with-select`,
`kit-dialog--from-card`.

## ConfirmDialog

The dialog that asks before something cannot be undone, runs the action, and
stays open with the error if it fails.

**Use it when** the user asks for an irreversible action (delete a channel, leave
a community). Get it from `useConfirmDestructive`, which owns the phases (see
[Behaviour](behaviour.md#confirm-destructive)); the hook's `dialog` is this
component.

**Do not use it when** the action can be undone (offer Undo in a Toast), or when
the dialog asks for more than a yes (use Dialog).

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`phase`|`idle`, `confirming`, `working`, `failed`|none (required)|`idle` is closed.|
|`error`|text or null|none (required)|The failure shown while `phase` is `failed`.|
|`title`|text|none (required)|Names what is lost: "Delete #general?".|
|`description`|text|none (required)|What goes with it: "This removes 214 messages for everyone."|
|`confirmLabel`|text|none (required)|The danger button, and the retry button after a failure: "Delete channel".|
|`onConfirm`|a function|none (required)|The confirm button.|
|`onCancel`|a function, given `'button'`, `'escape'` or `'scrim'`|none (required)|Cancel, Escape or a press on the dimmed page.|
|`onPresence`|a function, given `true` or `false`|none (required)|`false`: the dialog went away without an answer (the layer it was opened from closed, or it left the page). `true`: it is on the page again.|

- Cancel comes first and takes focus; the danger button is second.
- While working, the danger button is busy (it keeps focus and its name) and
  Cancel is `aria-disabled`: unavailable, but still focusable, so focus that
  sits on it does not fall to the page. Escape and a press on the dimmed page
  do nothing.
- After a failure the error shows as a `danger` Alert in the body, Cancel works
  again, and the same button retries.
- Rendered inside a Popover, Sheet or other layer that can close while the
  action works, a failure after that close shows only as a danger toast: the
  screen must render the toast region (`AppFrame` always does; a story or test
  outside it renders `<ToastRegion />`).
- Words: [Writing](writing.md#confirm-a-destructive-action-by-naming-what-is-lost).

Stories: `kit-confirm-dialog--confirming`, `kit-confirm-dialog--confirming-light`,
`kit-confirm-dialog--working`, `kit-confirm-dialog--working-light`,
`kit-confirm-dialog--failed`, `kit-confirm-dialog--failed-light`,
`kit-confirm-dialog--timed-out`, `kit-confirm-dialog--failed-long-text`,
`kit-confirm-dialog--from-menu`,
`kit-confirm-dialog--from-menu-never-ends`, `kit-confirm-dialog--parent-closes-then-fails`.

## Island

The large surface of the app: a rounded panel that floats on the ground and
holds a part of the screen.

**Use it when** you group a part of a screen: a list of channels, the messages,
a member list. Every part of a screen sits on an island.

**Do not use it when** you want a block inside an island. Use Card. Do not put
an island inside an island.

An island has no border and is lifted by a shadow. It does not set the gap to
the next island. The layout does. In a row of islands, give each one its width
from the layout, because an island is only as wide as its content.

### Which label and element

An island is a page region only when it has a `label`. Give it one when the
part is something people jump to, and then pick the element with `as`:

- `nav`: places to go, such as the list of channels. It must have a `label`:
  several unnamed navigation landmarks cannot be told apart.
- `aside`: supporting content beside the main content, such as a member list.
  It must have a `label`.
- `main`: the main content of the page. Use it once per page.
- `section`: any other named part. This is the default. Without a `label` it is
  only a box, not a region.
- `div`: a plain box, with no meaning for screen readers. It cannot have a
  `label`, because a name on a box with no role is not allowed.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`children`|content|none (required)|What the island holds.|
|`as`|`section`, `aside`, `nav`, `main`, `div`|`section`|The page element. See above.|
|`label`|text|none|Names the region for screen readers. Required for `nav` and `aside`, not allowed for `div`.|
|`padding`|`none`, `md`, `lg`|`lg`|The space inside. Use `none` when the content brings its own, such as a list of rows.|
|`scroll`|true, false|false|The island fills the height its parent gives it, and its content scrolls inside it, never the page.|
|`footer`|content|none|A block that stays at the island's foot while the content above it scrolls (the user's own card in the left island). It sits inside the island's padding, a small gap below the content. Pass `null` while there is nothing to show: the island keeps its structure, so its content is never rebuilt. A footer taller than the island is cut off (the body shrinks to nothing first), and it adds no safe-area inset of its own. Web kit only so far; the native kit has not caught up (see [Extending the system](extending.md#the-native-kit-is-catching-up)).|
|`id`|text|none|The id of the element.|

Without `scroll`, whatever is wider or taller than the island is cut off. With
`scroll`, the parent must give the island a height. An island is the `surface`
layer for everything inside it.

Stories: `kit-island--layout`, `kit-island--scrolling`, `kit-island--with-footer`,
`kit-island--with-footer-light`, `kit-island--with-footer-tinted`, `kit-island--paddings`,
`kit-island--layout-light`, `kit-island--layout-tinted`.

## Card

A soft-filled block inside an island. It is plain, or it is one button or one
link that covers the whole card.

**Use it when** you show a self-contained thing in an island with its own
content: a voice room with the people in it, a block of settings.

**Do not use it when** the thing is one row in a list. Use ListRow. Do not put
a Card on the ground, or inside another Card.

A card that is a button or a link is one control, named by its text. If the
text is not enough, give it a `label`. Because the whole card is the control, a
clickable Card holds no other controls: a button inside a button is invalid and
its clicks would reach the card. Types cannot see inside `children`, so in
development the Card logs one error that names it when it finds a button, link,
input, select, textarea or element with a `tabindex` inside it. Use a plain Card
with the controls inside, or a ListRow with a trailing control. A plain card may
hold any kit components.

Kit pieces adapt on their own when they sit on a Card, which is the `fill`
layer. A soft Button, a neutral Pill, a field, a segmented Tabs track, a KeyCap,
a Skeleton, an Alert, an AvatarStack "+N", the initials of an Avatar and the rail
of a Slider or LinearProgress draw on the surface colour instead of the fill, so
they stay visible; hover tints on ghost and text buttons, tabs, checks and rows
are mixed over the Card's fill. A Card inside a Card is `surface`, not fill on
fill (but avoid it: see above). A Dialog, Sheet, Menu or Popover opened from
inside a Card is its own `surface` layer and draws normally. You do not do
anything for this.

### Two signs for "this one"

The Card and the ListRow each have a sign for the current thing, and they mean
different things. Never swap them.

|Sign|Where|What it means|
|---|---|---|
|Accent outline|`selected` on a Card|You are in this (a voice room you joined), or this is the current item.|
|Solid accent pill|`selected` on a ListRow|The selected row in a list, such as the channel you are in.|

The outline is drawn as a border that is always there and is clear when the
card is not selected, so selecting never changes the size of the card. A
selected card is announced as current.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`children`|content|none (required)|What the card holds.|
|`selected`|true, false|false|The accent outline.|
|`padding`|`md`, `lg`|`md`|The space inside.|
|`onClick`|a function|none|Makes the card a button.|
|`href`|an address|none|Makes the card a link. Do not pass both `onClick` and `href`.|
|`label`|text|none|The accessible name of a button or link card, when its text is not enough.|
|`id`|text|none|The id of the element.|

Stories: `kit-card--voice-rooms`, `kit-card--clickable`, `kit-card--paddings`, `kit-card--nested`, `kit-card--nested-light`,
`kit-card--voice-rooms-light`, `kit-card--voice-rooms-tinted`.

## Dock

The bar where the user moves between communities and goes to the inbox. It is a
pill-shaped bar of DockItems, icon buttons and dividers.

**Use it when** you build the community switcher of a screen.

**Do not use it when** you need tabs for views of a page (use Tabs) or a list
of places with names (use ListRow in an island).

A Dock must have a `label`. It names the navigation for screen readers.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`label`|text|none (required)|Names the navigation.|
|`children`|DockItems, IconButtons and DockDividers|none (required)|What is on the bar.|
|`bottomBar`|true, false|false|The bar is the bottom edge of a phone screen. It adds the home-indicator inset (`env(safe-area-inset-bottom)`) as a bottom margin, so it does not sit under the indicator. Leave it off when the bar is mid-layout.|
|`start`|IconButtons and DockDividers|none|Items fixed at the start of the bar, such as the Inbox: they never scroll out of sight.|
|`end`|IconButtons and DockDividers|none|Items fixed at the end of the bar, such as "All communities": they never scroll out of sight.|

Only the `children` scroll, between `start` and `end`. The scrolling region keeps
`space.sm` inside each edge, so a count or a dot at the edge item is never cut
off, and an edge with more beyond it fades out (`space.xl` wide), which says
there is more to scroll to. Use `start` and `end` for the items a user must
always reach (the inbox, "All communities") whenever the communities may not
fit. Web kit only so far for `start`, `end`, the inset and the fade.

Put an IconButton on the bar for a thing that is not a community, such as the
inbox. Use a DockDivider between groups: it is a thin vertical line, and it has
no options and is hidden from screen readers. A bar that holds more than fits
scrolls sideways, and keeps the current item in view, again when the bar changes
size (a rotation). See "What the browser does for us". Its items draw on the
`surface` layer. Where the bar sits on screen, and keeping page content clear of
it, belong to the app shell.

**A keyboard Dock.** With many communities the bar is one list, not one Tab stop
per item. Build it like [a keyboard list](#a-keyboard-list), with
`orientation: 'horizontal'`: pass `useListFocus(...).bar` as the Dock's `focus`,
and `rowFocus(id)` as the `focus` of every DockItem and IconButton on the bar.
Tab then enters on the selected (current) item, Left, Right, Home and End move
along the bar, typing a name jumps to it, and the next Tab leaves the bar. The
focused item scrolls into view inside the bar, never the page. The bar itself is
then `tabindex="-1"`, because Firefox would otherwise make a scrolling bar a Tab
stop of its own. The same on a phone's bottom bar (`bottomBar`).

```tsx
// rows: every item on the bar, in the order they are drawn: Inbox, each community, All.
// Each id is the id the item gets from rowFocus(id); label is what typeahead matches.
const rows = [
  { id: 'inbox', label: 'Inbox', disabled: false },
  ...communities.map((c) => ({ id: c.id, label: c.name, disabled: false })),
  { id: 'all', label: 'All communities', disabled: false },
];
const list = useListFocus({
  rows,
  selected: currentId,                  // the current community's id, or null
  orientation: 'horizontal',
  onSelect: (id) => id === 'all' && openAllSheet(),   // see below
});
<Dock
  label="Communities"
  focus={list.bar}
  start={<IconButton icon="Inbox" label="Inbox" badge={9} focus={list.rowFocus('inbox')} />}
  end={<IconButton icon="LayoutGrid" label="All communities" focus={list.rowFocus('all')} />}
>
  {communities.map((c) => (
    <DockItem key={c.id} name={c.name} href={`#/community/${c.id}`} current={c.id === currentId}
      unread={c.mentions} unreadLabel="mentions" focus={list.rowFocus(c.id)} />
  ))}
</Dock>
```

- `rows` must hold the Inbox and All items as well as the communities. An item
  whose id is not in `rows` gets `tabindex="-1"` and is skipped by every key: it
  cannot be reached with the keyboard.
- A disabled IconButton ignores `focus`, so its row must say `disabled: true` as
  well, or an arrow lands on a button that cannot take focus and the next arrow
  counts from the wrong place. Keep `disabled` on the item and in `rows` the same.
- `onSelect(id)` is called with the id of the item that was chosen (Enter, Space
  or a click), and it is called for the Inbox and All items too. A link has
  already navigated; a button (All) does its work in its own `onClick`, so put an
  action in the `onClick` or in `onSelect`, not in both.
- There is no helper to build `rows`: the ids and labels are the app's own, and
  a helper would only be the `map` above. The mistakes are in leaving items out,
  and the guide and the tests say so.
- Clicking in the gap between two items of the scrolling middle focuses that
  region; the arrows then scroll it sideways like any scroller until the next Tab
  or click puts focus on an item. A click in the gap beside a `start` or `end`
  item focuses nothing.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`focus`|`useListFocus(...).bar`|none|Makes the bar one keyboard list. Opaque: pass what `bar` returns, nothing else. Without it the items keep their own Tab stops.|

Stories: `kit-dock--communities`, `kit-dock--overflow`, `kit-dock--phone-bar`,
`kit-dock--communities-light`, `kit-dock--communities-tinted`,
`kit-dock--focus-twelve`, `kit-dock--focus-twelve-light`, `kit-dock--focus-sixty`,
`kit-dock--focus-sixty-phone`, `kit-dock--fixed-ends`, `kit-dock--fixed-ends-light`,
`kit-dock--fixed-ends-phone`, `kit-dock--fixed-ends-tinted`.

Web kit only so far; the native kit has not caught up (see
[Extending the system](extending.md#the-native-kit-is-catching-up)).

## DockItem

One community on the Dock: a round button, or a link, that holds its picture.

**Use it when** the item is a community in a Dock.

**Do not use it when** you show a community in a list or a row. Use ListRow
with an Avatar. Do not use it outside a Dock.

What the picture shows is also in the name, so a screen reader hears all of it.
The name is the community's name, then ", current", then ", 3 unread" or ", new
messages", then ", reconnecting", for each that applies. The name also shows in a tooltip on
hover and on keyboard focus; the tooltip only repeats the name, so it is not
added to the item's description. A count that is not a finite number shows
nothing.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`name`|text|none (required)|The community. It is the accessible name, the tooltip and the source of the initials.|
|`src`|an image address|none|The picture.|
|`colour`|a colour as `#rrggbb`|none|The community's own colour, as for Avatar.|
|`current`|true, false|false|The community you are in: an accent ring.|
|`unread`|a number|0|A count on the item. 0 shows nothing.|
|`unreadLabel`|`unread`, `mentions`|`unread`|What the count means, in the name and the badge's label: ", 3 unread", or ", 1 mention" / ", 2 mentions". Use `mentions` when the number counts mentions. Web kit only so far.|
|`newMessages`|true, false|false|There are new messages that do not mention you: a small accent dot at the top right, and ", new messages" in the name. With an `unread` count the badge is shown instead and the dot is not.|
|`status`|`reconnecting`|none|A warning dot, and the picture dimmed.|
|`onClick`|a function|none|Makes the item a button.|
|`href`|an address|none|Makes the item a link.|
|`id`|text|none|The id of the element.|
|`focus`|`rowFocus(id)` from `useListFocus`|none|Joins the Dock's keyboard list. See [Dock](#dock).|

The ring is always there and is clear when the item is not current, so
becoming current moves nothing. The count is a danger Badge and a warning dot is
the dot of a reconnecting community; both are drawn only, and the name carries
the same facts. The Dock stories show every state.

The dot says "something new, nobody asked for you" and the count says "someone
did": a count wins over the dot. The dot is a shape that is there or not (and the
name says it), never a colour change.

Stories: `kit-dock--communities`, `kit-dock--overflow`, `kit-dock--new-messages`,
`kit-dock--new-messages-light`, `kit-dock--new-messages-tinted`.

Web kit only so far; the native kit has not caught up (see
[Extending the system](extending.md#the-native-kit-is-catching-up)).

## Sheet

A large modal panel for browsing or a longer task, such as a list of all
communities or a settings pane.

**Use it when** the user looks through many things or does a task with several
steps, and it needs more room than a question.

**Do not use it when** the user only answers a question. Use Dialog. Do not use
it for a few controls beside the thing they act on. Use Popover.

Use Dialog for a decision and Sheet for browsing or a longer task. A Sheet works
like a Dialog: it dims the page and nothing behind it can be used until it
closes. The title and a Close button stay at the top. The `actions`, if any,
stay in a row at the bottom. Only the body scrolls. Above the phone width the
Sheet is a panel in the middle of the page. On a phone it rises from the bottom
as a bottom sheet: full width, rounded at the top, and it leaves room for the
Dock. The last row of the bottom sheet (the actions, or the body when there are
none) is padded by the home-indicator inset (`env(safe-area-inset-bottom)`) on
top of its normal padding. On phones the app shell keeps the sheet above the
on-screen keyboard (the viewport setting and the keyboard inset are the shell
plan's job, not the kit's).

The parent decides whether the sheet closes. `onClose` is called on Escape, on a
press on the dimmed page and on the Close button, and says which: `'escape'`,
`'scrim'` or `'button'`. Like a Dialog, a sheet opened from inside another layer
closes with it, and `onClose` is then called with `'parentClosed'`: a notice, not
a request.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`open`|true, false|none (required)|Whether the sheet is showing.|
|`onClose`|a function, given `'escape'`, `'scrim'`, `'button'` or `'parentClosed'`|none (required)|Called on Escape, on a press on the dimmed page, on Close, and when the layer it was opened from closes.|
|`title`|text|none (required)|Names the sheet. It is the heading.|
|`children`|content|none (required)|The body. It scrolls.|
|`actions`|Buttons|none|The buttons, in a row pinned to the bottom. On a phone they stack.|
|`top`|content|none|Content fixed under the title, above the scrolling body, such as a heading and a search field that filters the body. It never scrolls out of view. Web kit only so far.|
|`size`|`md`, `lg`|`md`|The width. `md` is 560 pixels and `lg` is 800.|

When there are no `actions`, focus starts on the Close button (the panel is not
a control). With actions, focus lands on the sheet itself, so Close is the first
Tab stop. A select list, a Menu, a Popover or a Tooltip may open from inside a
Sheet, as in a Dialog.

Stories: `kit-sheet--all-communities`, `kit-sheet--with-actions`, `kit-sheet--with-top`,
`kit-sheet--long-content`, `kit-sheet--phone`, `kit-sheet--all-communities-light`,
`kit-sheet--all-communities-tinted`.

## What the browser does for us

The web kit gets a lot of behaviour for free from the browser and from MUI, and
none of it is written down in the components. The native client draws every
control itself, so it has to implement each behaviour below on its own. Some of
it is now in the shared behaviour tables (see [Behaviour](behaviour.md)), which
both clients are tested against. For the rest, this list is the spec for the
native side.

When an overlay closes, and where focus goes after, is no longer MUI's to
decide. It is the overlay stack's (see [Overlay stack](behaviour.md#overlay-stack)):
Escape, Tab, a press outside, a closing parent and focus return. The kit turns
off MUI's own Escape handling, its focus restore and its close reasons. The
lists below say what each overlay still gets from MUI and the browser.

### Select menu

- The list opens when the pointer is pressed on the field, not when it is
  released. Enter, Space, ArrowDown and ArrowUp open it from the keyboard.
- When it opens, focus goes to the selected item, or to the first item when
  there is none.
- Typing letters jumps to the next item whose text starts with them. Home and
  End jump to the first and last item. Disabled items are skipped. The list does
  not wrap.
- Tab closes the list and puts focus back on the field; the next Tab moves on.
  Escape and a click outside close it and put focus back on the field. The list
  is a menu layer of the overlay stack, which decides all three; MUI only closes
  it when an option is chosen.
- While the list is open the page behind it does not scroll, and the page is
  hidden from assistive technology. Focus cannot leave the list.
- The list is at least as wide as the field and sits just below it. When there is
  no room it is moved to stay 16 px inside the window; it does not flip above the
  field.
- The list fades in over the fast timing.
- Clicking the label focuses the field and does not open the list.

### Text input

- A multiline field grows with its text. It measures the text with a hidden copy
  of itself.
- The focus ring shows on any focus, with the mouse too, not only the keyboard.
- `maxLength` is enforced by the input itself: typing and pasting stop at the limit.
- A browser autofill is detected and the field is treated as filled.

### Slider

- A press on the rail jumps the thumb to that point, and dragging moves it from
  there. The thumb travels the width of the rail minus its own width, so at both
  ends it sits fully inside.
- Values snap to the step grid counted from `min`. Arrows move one step; Home
  and End jump to the ends; PageUp and PageDown move a larger step.

### Radio group

- Tab enters the group at the selected radio, or at the first enabled radio when
  none is selected (Shift+Tab enters at the last). Only one radio of the group is
  a Tab stop.
- Arrows move focus and selection together, skip disabled radios and wrap.

### Label rows

- A press anywhere on the row of a checkbox, switch or radio, the text included,
  activates the control. A disabled row does nothing.

### Avatar

- The initials: split the name on whitespace and keep, in each word, only the
  graphemes that start with a letter, a number or a pictograph. Two or more
  words give the first grapheme of the first two words; one word gives its first
  two. Each is upper-cased for the locale, but kept as written if upper-casing
  would make it longer (`ß` stays `ß`). Nothing left gives the User icon, and the
  accessible name is "Unknown user" for a blank name.
- The colour search: take the two inks (page and text colours) and call the one
  with less contrast on black the darker. If the darker ink reads better on the
  colour, move the colour lighter, otherwise darker, in steps of 0.002 of
  lightness (Oklch) up to 500 steps. At each step take the better ink and stop at
  the first that reaches 4.5:1. Keep hue and chroma; chroma drops only where the
  lightness leaves the colour range. Stop at black or white. A colour that
  already passes is used as given. If none passes, use the neutral look. Cache
  the answer per colour and inks.
- The dot is `space.sm` across for `xs` and `space.md` for the others, and sits
  `border.hairline` outside the bottom right corner, with a `border.selected`
  ring in the page colour around it. Offline has a `border.selected` border in
  the dim text colour around a page-coloured centre. Away has a bar across the
  middle, `border.selected` high and the dot's width less two borders wide.
- The speaking ring is drawn outside the avatar's box: a page-coloured gap
  `border.selected` wide, then a ring of the same width in green. It can be
  clipped by a parent that hides overflow and overlaps its neighbours.
- A loaded picture hides the initials (they keep their place); a failed one
  shows them; a new `src` starts again.

### Avatar stack

- Each avatar sits in a ring of `border.selected` in the page colour and
  overlaps the one before by `space.sm`.
- The name: one name is itself, two are "A and B", three or more are "A, B and
  C", with "and" explicit and not found by looking for a comma in the text. When
  some are hidden, the shown names are joined by commas and followed by "and N
  more", or "N people" when none is shown. Blank names read "Unknown user".

### Badge

- The number is floored. Zero, a negative or NaN shows nothing, unless it is a
  dot. A `max` below 1 or NaN means 99. Above `max` it reads "max+".

### Progress and loading

- LinearProgress clamps the value to 0 to 100, with NaN as 0. The bar is full
  width and moved left by what is missing, so the right end stays round. The
  indeterminate bar is 40 percent wide and travels from just off the left edge to
  just past the right, in a straight line, over four times the slow timing. Under
  reduced motion it is a full bar at the disabled opacity, still.
- Skeleton pulses its opacity from 1 to the disabled opacity and back over four
  times the slow timing, easing in and out, and is still under reduced motion.
  Text lines are one body line high each, with the bar inset by `space.xs`
  above and below.
- Spinner is a fixed arc turning at a constant rate. Its stroke is 5/44 of
  its size (5 of the 44 units MUI draws the circle in).

### Alert and Toast

- The role: `danger` and `warning` alerts (a `danger` toast) are `alert`; the
  rest are `status`. With `announce` off, all are `note`.
- Alert's actions share one row that wraps: with two long labels the second goes
  to a second line. A single label too long for the row is cut with an ellipsis.
- Alert's text button is pulled back by the button's side padding, so its label
  lines up with the text above. The close button is pulled up so its centre
  meets the first line of text, and right by the space around its icon, so the
  icon sits on the padding edge.

### Buttons

- Focus is drawn only for keyboard focus, never after a mouse press.
- Space activates a button when the key is released; Enter activates it when
  the key goes down.
- A busy button stays focusable and ignores both keys and clicks.

### Menu

- When it opens, focus goes to the first item that is not disabled. Focus stays
  inside the menu.
- ArrowDown and ArrowUp move between items and wrap at the ends. Home and End
  jump to the first and last item. Typing letters jumps to the next item whose
  text starts with them; the shortcut keys count as part of an item's text.
  Disabled items and dividers are skipped.
- Enter and Space on an item choose it. Choosing calls the item's action, then
  closes the menu. A disabled item does nothing when clicked.
- Tab, Escape and a press on the page outside it close it (the overlay stack's
  rules), and focus goes back to whatever had it before the menu opened, not to
  the next control. What MUI still gives: the invisible layer that swallows the
  press, so the control under it is not activated, and `preventDefault` on the
  Tab key. A right or middle press outside does not close it.
- An item that opens a Dialog: the menu closes under the dialog without moving
  focus, and the dialog returns focus to the menu's button when it closes.
- Where a click does not focus the button (Safari), focus still returns to the
  menu's anchor.
- Typing letters collects into a prefix; the same letter again steps through the
  matches. Matching is not case sensitive. MUI resets the prefix after about half
  a second; the shared rule is one second (the typeahead timing, see
  [List focus](behaviour.md#list-focus)).
- While the menu is open the page behind it does not scroll, and the page is
  hidden from assistive technology.
- The menu sits just below the anchor, or just above it for the `top` placements.
  When there is no room it is moved to stay one gutter inside the window; it does
  not flip, so a menu near the bottom moves up and can cover its anchor.
- The menu is at most the window height less a margin tall and scrolls inside.
  It follows a window resize.
- It fades in over the fast timing.

### Popover

- When it opens, focus goes to the first control inside it, or to the panel
  itself when there is none.
- Escape closes it, wherever focus is. So does a press anywhere outside the
  panel and its anchor, and the press carries on to what is under it. A press on
  the anchor is left to the anchor. Both are the overlay stack's rules; the kit
  has no code of its own for them.
- Nothing traps focus, and the page keeps its scroll. Outside a Dialog the panel
  is placed at the end of the page, so Tab from its last control carries on
  after the page. Inside a Dialog it is drawn in the Dialog.
- A press inside a layer that opened from the Popover (a select list, a Menu, a
  Dialog) is not a press outside it, and Escape closes that layer first. The
  Escape is ignored while an input method is composing text, and when the
  focused control uses it.
- When it closes with focus inside it, or with focus lost, focus goes back to
  the anchor. When the user moved focus elsewhere (a press on another control),
  focus stays there.
- It sits just below or above the anchor. When there is no room it flips to the
  other side, then shifts along the anchor to stay one gutter inside the window.
- It follows the anchor when the window or any scrolling box around it scrolls
  or resizes, but it does not hide when the anchor scrolls out of view. It has
  no maximum height, so a tall panel can run off the bottom.

### Tooltip

- A mouse or pen pointer opens it after a short delay. Keyboard focus opens it
  at once, but only when the focus is keyboard focus, not after a mouse press.
- A touch never opens it.
- The control losing focus closes it, and so does moving the pointer away. The
  tooltip handles both itself.
- Escape closes it wherever focus is, and goes no further: a dialog under it
  stays open and the screen does not get the key. It then stays hidden until
  the pointer or focus leaves the control and comes back. That is the overlay
  stack's rule.
- While it is open, the control is linked to it as a description, merged with any
  description the control has. The control keeps its own name.
- A tap on a text field, and a touch press on any control, never open it.
- The panel cannot be hovered. Escape ignores an input method that is composing
  text, and a focused control still receives the key before the tooltip closes.
  A press never closes it.
- It sits on the chosen side of the control. When there is no room it flips to
  the other side, then shifts to stay one gutter inside the window. It appears
  with no fade, and it is not in the page while closed.

### Dialog

- When it opens, focus goes to the first control in the actions row.
- Tab and Shift+Tab wrap inside the dialog. Focus cannot leave it.
- Escape and a press on the dimmed page call `onClose`. The parent decides
  whether to close. Both are the overlay stack's rules: MUI's own Escape
  handling and close reasons are off.
- When it closes, focus goes back to the element that was focused just before
  it opened. If that has gone, focus goes to the layer it was in, or to the
  screen's focus target. This is the stack's rule too: MUI's focus restore is off.
- A press on the dimmed page closes it only when the press starts and ends there:
  a drag that starts in the panel and ends on the dimmed page does not. Only the
  main button counts: a right or middle press does nothing.
- A layer opened from inside (a select list, a Menu, a Popover, a Tooltip) is
  drawn within the dialog and takes the key first. The page behind is hidden from
  assistive technology when the dialog opens, so a layer drawn elsewhere would
  be hidden too.
- Long content scrolls inside the panel, which is never taller than the window
  less the page gutter. Escape is ignored while an input method is composing,
  and when the focused control uses it.
- While it is open the page behind it does not scroll, and the page is hidden
  from assistive technology. The dialog is announced as a dialog, named by its
  title and described by its description.
- The dimmed page fades in. The dialog is centred, and keeps the page gutter on
  each side of a narrow screen. On a phone the action buttons stack, one to a
  row, safe action on top.
- Every layer opened from inside is stacked in the order it was opened, and
  Escape closes the innermost one first. The panel is the `surface` layer for
  what it holds, whatever it was opened from (a Card, a selected row).
- A fade in and out with a duration; reduced motion turns it off.

### Dock

- A bar that holds more than fits scrolls sideways inside itself. The scrollbar
  is not drawn, and the scroll does not pass on to the page. While everything
  fits, the items are centred. Once it overflows they start at the start edge,
  so nothing is cut off at the left.
- It keeps the current item (the one marked as the current page) in view when it
  first shows and whenever the current item changes: it scrolls only as far as
  needed, leaving the edge fade's width (`space.xl`) beside the item. A scroll the user made is left
  alone otherwise. It scrolls the bar, never the page.
- An item is a button or a link with its own name and a tooltip. The ring of the
  current item is a border that is always there, so nothing moves when it
  changes.
- Scrolling sideways keeps momentum on touch and takes a trackpad's horizontal
  scroll. Items are centred while they fit and start at the start edge once they
  overflow (`safe center`; an old engine that lacks it starts at the start edge,
  which is acceptable). The bar re-centres the current item when its own size
  changes.
- With `bottomBar` the bar keeps `env(safe-area-inset-bottom)` as a bottom margin.
- As a keyboard list (`focus`) the bar is one Tab stop; the focused item is
  scrolled into view inside the scrolling region, leaving the fade's width beside
  it. Firefox makes a scrolling element a Tab stop of its own, so the scrolling
  region is `tabindex="-1"`.
- `start` and `end` items sit outside the scrolling region. The fade at an edge
  is a CSS mask that follows the scroll position.
- A mouse wheel turns vertically: while the middle overflows, a vertical wheel
  with no sideways part scrolls it sideways, as far as it can go. At the end it is
  moving to, or when nothing overflows, the wheel goes on to the page. A
  trackpad's sideways scroll and Ctrl + wheel (zoom) are the browser's.

### Sheet

- It behaves like a Dialog: the page behind does not scroll and is hidden from
  assistive technology, focus moves in and cannot leave, Escape and a press on
  the dimmed page call `onClose` (the overlay stack decides both), and focus goes
  back to where it was. A layer opened from inside is drawn within the sheet.
  Focus goes to the sheet itself.
- The header and the actions stay put and the body scrolls.
- Above the phone width it is centred and keeps the page gutter. At the phone
  width or below it is full width, sits at the bottom with rounded top corners,
  and is never taller than the window less the height of the Dock. It slides up
  when it opens, unless the user asks for reduced motion. It fades out when it
  closes. The actions stack, one to a row.
- The bottom sheet is a flex column: a fixed header, a body that scrolls with its
  overscroll kept inside, and the optional fixed actions. Its largest height is
  relative to the window. The last row clears the home indicator through
  `env(safe-area-inset-bottom)`. The keyboard inset is not handled here: the app
  shell keeps the sheet above the on-screen keyboard.
- With no actions, Close takes focus when it opens.

### Island and Card

- An island is a landmark with a role and a name (`nav` and `aside` are always
  named). It clips its content to its rounded corners and scrolls its own content
  with the overscroll kept inside, with `min-height: 0` flex semantics so the
  scroll area can shrink.
- A card that is a button or a link activates with Enter (both) and Space
  (buttons), shows hover only on a pointer that hovers, shows the pressed state
  while pressed, and draws a `:focus-visible` ring (keyboard-only) as an outline
  outside its shape. A selected card is announced as current. The clickable form
  holds no other controls.
- A tooltip on an item has its delay and is tied to the item with
  `aria-describedby`; an item whose name the tooltip repeats is not tied to it.
- An Avatar loads its image and shows initials until it has, and a Badge caps its
  count (`99+`).

### Shared by these pieces

- Outer box shadows (the island and overlay elevations).
- Borders that do not change a box's size (`box-sizing: border-box`).
- The surface layer: a kit piece reads the layer it sits on and an overlay panel
  resets it (context crossing a portal is a web detail; the rule is "an overlay
  is its own `surface`"). The native client passes the layer down when it draws.
