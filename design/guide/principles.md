# Principles

These are the ideas that make a screen look and feel like Semaphore. They
are short on purpose. When you are unsure how something should look, go back
to them before you reach for a new colour, a new shape or a new component.

Each principle names the rule or component that carries it, and one live
story you can open to see it. A story id is the file name plus the export
name in lower-case words joined by hyphens (see [Components](components.md)).

## 1. Everything sits in islands on a ground

The ground is the page. Islands are large rounded panels that float on it.
A screen is a few islands and nothing outside them. Inside an island go rows,
cards, text and controls. Only an overlay (a dialog, a sheet, a menu) floats
above the islands.

Carried by: Island and Card in [Components](components.md), and the layer
table in "How a screen is built". The gap between islands belongs to the
layout, not to the island.

Story: `kit-island--layout`.

## 2. One accent, and it means two things

The accent colour is for "this one is selected" and "you are here". It is
never decoration. There are exactly two signs:

- The **solid accent pill** on a list row: the selected row, such as the
  channel you are in.
- The **accent outline** on a card: you are in this, such as a voice room you
  joined, or it is the current item.

Do not swap them, and do not use the accent for anything else: not for a
heading, a divider, a badge that only looks nice, or a background. The one
other place the accent appears is the primary button, which is the one main
action of a surface.

Carried by: "Two signs for this one" under Card in
[Components](components.md), and the `accent`, `onAccent` and `accentText`
roles in [Tokens and colour](tokens-and-colour.md).

Story: `kit-card--voice-rooms` (the outline), `kit-list-row--states` (the pill).

## 3. Soft, round shapes

Corners are round and the shapes are calm. Every corner comes from the radius
tokens: islands 24, cards 18, fields 14, small controls 6 and 10, and fully
round for buttons, pills and tags. You do not pick a radius. The component
has already chosen it.

Carried by: the radius scale in [Tokens and colour](tokens-and-colour.md).

Story: `kit-button--variants`.

## 4. Compact message rows, not bubbles

A message is a compact row: the person's picture, their name and the time on
one line, and the words under it, with no bubble around them. Rows keep a
long conversation short and easy to scan. Bubbles are not part of the system.
If a second style is ever offered, it will be an appearance option that the
owner decides.

Carried by: the text styles `name`, `body` and `meta`, and the Avatar sizes,
in [Tokens and colour](tokens-and-colour.md). The message row is built from
those pieces and is not a kit component yet.

Story: `kit-list-row--people` shows the same density: one picture, one name,
one small line.

## 5. Colour comes from roles, and roles come from one base colour

The person using the app chooses one base colour, a mode (dark or light) and
an intensity. The app derives the whole palette from those three. So a screen
never names a colour. It names a role: `surface`, `text`, `accentText`,
`danger`. The same screen then works in every palette the person can pick.

The one exception is data: a person's or community's own colour, shown by
Avatar.

Carried by: "The 16 roles" in [Tokens and colour](tokens-and-colour.md).

Story: `kit-text--tones-tinted` shows the roles in a tinted palette.

## 6. Readable by construction, and never by colour alone

The palette promises contrast. Text roles reach at least 4.5 to 1 on the
layers they may sit on, and the palette is built so that the promise holds for
any base colour. You keep the promise by using the roles where the table says
they may sit, for example `textDim` never on a fill.

Colour is never the only sign. Presence has a shape as well as a colour (a
filled dot, a dot with a bar, a hollow ring). A selected row has a pill. A
danger action has a label that says what it does. Anyone who cannot tell the
colours apart still gets the meaning.

Carried by: "What the palette promises" in
[Tokens and colour](tokens-and-colour.md), and the presence rules under Avatar
in [Components](components.md).

Story: `kit-avatar--presence`.

## 7. Controls behave the same everywhere

Every control has a label, even when the label is hidden from the eye. A busy
control (`loading`) stays focusable and ignores clicks; only `disabled` takes a
control out of the tab order. Hover shows only on devices that hover, so a
touch screen never has a stuck hover. Pressed and keyboard focus always show.

Carried by: "Rules every component follows" in [Components](components.md)
and "Loading is not disabled" in the [README](README.md).

Story: `kit-button--states`.

## 8. Motion is small and optional

Things fade or move a little, using the timing tokens (120, 200 and 320
milliseconds). Nothing bounces, spins for show or draws the eye away from the
words. When a person asks their system for reduced motion, the motion stops
and the meaning stays: a busy bar becomes a full, still bar.

Carried by: the timings in [Tokens and colour](tokens-and-colour.md) and the
motion rule in [Components](components.md).

Story: `kit-linear-progress--values`.

## 9. Sentence case and plain words

Every label, heading and button is in sentence case: "Create channel", not
"Create Channel" and never "CREATE CHANNEL". Words are plain and friendly.
How to write them is in [Writing](writing.md).

Carried by: the text styles in [Tokens and colour](tokens-and-colour.md), none
of which is uppercase, and [Writing](writing.md).

Story: `kit-dialog--confirm`.

## 10. The web and the native client show the same thing

Both clients use the same tokens, the same palette and the same kit names and
options. A screen built from the kit looks and behaves the same in both. The
two are kept in step by generated files, not by hand. A change to a system
piece is made in both clients.

Carried by: the generated tokens and palette vectors described in
`design/README.md`, and the paired kits. See [Extending](extending.md) for how
a change lands in both.

Story: `kit-dock--communities`.

## What we never do

- **Borders on islands.** An island has no border. A shadow lifts it. Only an
  overlay has a thin border.
- **Blur, filters, blend modes or inset shadows.** The native client cannot
  draw them. Flat fills, plain shadows and simple shapes only.
- **Raw colours or pixel numbers on a screen.** No `#rrggbb`, no `13px`. Pick
  the role or the token by name.
- **Uppercase labels.** Not for headings, not for tags, not for buttons.
- **A second layout.** A screen uses one of the layout templates. It does not
  invent its own. A different look is a different skin (a set of token values),
  not a different layout.
- **Old and new looks mixed on one screen.** A person sees the old app or the
  new one. A converted screen never holds an old-style piece.
- **A one-off component for a single screen.** If the kit does not have what
  you need, add it to the system (see [Extending](extending.md)). Do not build
  it into the screen.
