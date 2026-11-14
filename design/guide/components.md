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

Twelve components exist so far: Text, Button, Icon, IconButton, KeyCap, Tabs,
Switch, Checkbox, RadioGroup, Slider, TextField and SelectField.

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
  when the action is not available.
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

Each tab has an `id`, a `label`, and optionally a `count` and `disabled`. The
`label` prop names the whole row for screen readers.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`variant`|`underline`, `segmented`|`underline`|The look. See below.|
|`fullWidth`|true, false|false|Spreads the tabs across the width of their space.|
|`value`|a tab id|none (required)|The selected tab.|

### Underline or segmented

- `underline`: switch between views of a page, such as the sections of a
  settings screen.
- `segmented`: filter or switch mode within one view. Keep it to a few short
  options.

Stories: `kit-tabs--underline`, `kit-tabs--segmented`,
`kit-tabs--with-counts`, `kit-tabs--overflow`, `kit-tabs--segmented-light`,
`kit-tabs--segmented-tinted`.

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
|`indeterminate`|true, false|false|Shows a dash for a parent whose children are only partly ticked.|
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

**Do not use it when** the user must type an exact value. Use TextField with
`type` set to `number`.

|Prop|Values|Default|Meaning|
|---|---|---|---|
|`label`|text|none (required)|Names the slider. Shown above it unless `labelHidden`.|
|`min`, `max`|numbers|0 and 100|The ends of the range.|
|`step`|a number|1|The size of one step.|
|`formatValue`|a function from number to text|none|Turns the value into the text shown beside the label, for example "80%". It is also what screen readers read.|
|`labelHidden`|true, false|false|Hides the label row from the eye. It still names the slider.|
|`disabled`|true, false|false|The slider is not available.|

Stories: `kit-slider--states`, `kit-slider--focused`,
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
|`type`|`text`, `password`, `email`, `search`, `url`, `number`|`text`|The kind of text.|
|`multiline`, `rows`|true, false; a number|false|Makes the field several lines tall.|
|`startIcon`|a name from the icon set|none|An icon at the start of the field.|

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

Stories: `kit-select-field--states`, `kit-select-field--open`,
`kit-select-field--open-light`, `kit-select-field--long-options`,
`kit-select-field--select-field-light`,
`kit-select-field--select-field-tinted`.
