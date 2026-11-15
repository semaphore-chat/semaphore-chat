# Components

The kit is the app's own set of components. The web client and the native
client use the same names and the same options, so a screen built from the
kit looks and behaves the same in both.

Screens are built only from kit components. Do not make a one-off button,
field or label for a single screen. If you need something the kit does not
cover, do not improvise: follow "Extending the system" (a chapter that is not
written yet). The kit's provider supplies the colours and fonts to everything
inside it.

The live examples are the kit stories in `frontend/src/stories/kit/`. A story
id is the file name plus the export name, in lower-case words joined by
hyphens. The export `States` in `KitButton.stories.tsx` is `kit-button--states`.
The stories show each component in dark, light and tinted colour, and in its
states. Copy from them, not from a picture.

Twenty-one components exist so far: Text, Button, Icon, IconButton, KeyCap,
Tabs, Switch, Checkbox, RadioGroup, Slider, TextField, SelectField, Avatar,
AvatarStack, Badge, Pill, Spinner, LinearProgress, Skeleton, Alert and Toast.

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

Stories: `kit-icon-button--variants`, `kit-icon-button--states`,
`kit-icon-button--focused`, `kit-icon-button--variants-light`,
`kit-icon-button--variants-tinted`.

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

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`people`|a list of `name`, and optionally `src` and `colour`|none (required)|Who is in the group.|
|`max`|a number|3|How many avatars to show before the "+N".|
|`size`|`xs`, `sm`, `md`, `lg`, `xl`|`sm`|The size of each avatar.|
|`label`|text|the shown names and "and N more"|The accessible name of the group.|

Stories: `kit-avatar--stack`.

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
|`onClose`|a function|none|Adds a Dismiss button. Without it the alert cannot be dismissed.|
|`announce`|true, false|true|Whether screen readers speak it when it appears.|

`warning` and `danger` interrupt screen readers when they appear. `info` and
`success` wait for a pause. Screen readers speak a live message when it shows
up, so a banner that is already on the page when it loads would be read out on
every visit. For those, pass `announce={false}`: the alert becomes a quiet note.
Leave it on for an alert that appears because something happened.

Stories: `kit-alert--severities`, `kit-alert--severities-light`,
`kit-alert--severities-tinted`, `kit-alert--with-actions`,
`kit-alert--long-text`.

## Toast

A passing notice about something that just happened.

**Use it when** you confirm or report the result of an action: "Message sent",
"Could not save".

**Do not use it when** the message belongs to a place on the page or must stay
until the user acts. Use Alert.

A Toast is only the look of one notice. Where toasts appear, how long they stay
and how they stack belong to the Behaviour chapter, which is not written yet.
A `danger` toast interrupts screen readers when it appears. The others wait for
a pause. `announce={false}` makes a toast a quiet note, for one that is already
on the page at load.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`message`|text|none (required)|What happened.|
|`tone`|`neutral`, `positive`, `danger`|`neutral`|The colour role. `positive` and `danger` add an icon.|
|`action`|a `label` and an `onClick`|none|One action, shown as a text button, such as "Undo".|
|`onClose`|a function|none|Adds a Dismiss button.|
|`announce`|true, false|true|Whether screen readers speak it when it appears.|

Stories: `kit-toast--tones`, `kit-toast--tones-light`,
`kit-toast--tones-tinted`, `kit-toast--long-message`.

## What the browser does for us

The web kit gets a lot of behaviour for free from the browser and from MUI, and
none of it is written down in the components. The native client draws every
control itself, so it has to implement each behaviour below on its own. They
will become shared behaviour tables that both clients are tested against; until
then this list is the spec for the native side.

### Select menu

- The list opens when the pointer is pressed on the field, not when it is
  released. Enter, Space, ArrowDown and ArrowUp open it from the keyboard.
- When it opens, focus goes to the selected item, or to the first item when
  there is none.
- Typing letters jumps to the next item whose text starts with them. Home and
  End jump to the first and last item. Disabled items are skipped. The list does
  not wrap.
- Tab closes the list and puts focus back on the field; the next Tab moves on.
  Escape and a click outside close it and put focus back on the field.
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
- Alert's text button is pulled back by the button's side padding, so its label
  lines up with the text above. The close button is pulled up so its centre
  meets the first line of text, and right by the space around its icon, so the
  icon sits on the padding edge.

### Buttons

- Focus is drawn only for keyboard focus, never after a mouse press.
- Space activates a button when the key is released; Enter activates it when
  the key goes down.
- A busy button stays focusable and ignores both keys and clicks.
