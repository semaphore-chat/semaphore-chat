# Layouts

A layout template is the arrangement of islands for a whole screen. It says
where the islands go, how wide they are, what happens when the window gets
narrow, and which parts of the page a screen reader can jump to. The kit
provides the templates. You pick one and fill its regions.

Read [Principles](principles.md) and "How a screen is built" in
[Components](components.md) first. This chapter builds on them: the ground, the
islands and the gap between them.

## The rule

**Every screen names its template.** The pull request that adds or changes a
screen says which template it uses. A screen never arranges islands by hand: it
does not place its own columns, set its own gaps, or decide for itself what
hides on a phone. The template does all of that, so every screen of the app
behaves the same way when the window changes.

If no template fits, do not improvise. See "A new template" at the end.

## The ground: AppFrame

Every template sits inside one `AppFrame`. It is the ground. It is exactly as
tall as the window, it pads the screen by the gutter (16 px) plus any safe area
(the notch and the home indicator on a phone), and it never scrolls. Each
island scrolls inside itself. The frame adds no landmark of its own.

Story: `kit-app-frame--empty`.

## The three width ranges

A template changes at two widths and no others. They come from the breakpoint
tokens in [Tokens and colour](tokens-and-colour.md).

|Range|Width|What it is|
|---|---|---|
|Phone|Below 600 px|A phone, or a window dragged very narrow|
|Compact|600 px up to 1199 px|A tablet, or a desktop window that is not full width|
|Wide|1200 px and above|A desktop window with room for a side panel to stay open|

In practice:

- **Wide** shows everything at once: every island in its place, and context
  beside the conversation.
- **Compact** keeps the place and the task side by side, and the context moves
  into a Sheet that the user opens.
- **Phone** shows one pane at a time, full width, with a way to go back and
  forth.

Design all three. A screen is not finished until you have looked at it at phone,
tablet and desktop widths.

## What the regions are for

The templates share one idea about where things go.

- **Left: where you are and where you can go.** The community and its channels,
  or the sections of a settings page.
- **Centre: the conversation or the task.** It is always the screen's main
  content, and it is the one place a screen can rely on being visible.
- **Right: context about the centre.** Members, a thread, pins. Never put a
  primary action only in the right region. Below the wide range the right
  region is a Sheet, closed until the user opens it, so anything that lives only
  there is hidden.

## Three islands

For a conversation, or for browsing a place: the chat screen, a channel, a
direct message, a community's overview.

```
Wide (1200 and above)
+------+  +------------------------+  +--------+
| Dock |  |                        |  |        |
+------+  |                        |  |        |
+------+  |        Centre          |  | Right  |
| Left |  |      (the main)        |  | island |
|      |  |                        |  |        |
+------+  +------------------------+  +--------+

Compact (600 to 1199)
+------+  +----------------------------------+
| Dock |  |                                  |
+------+  |                                  |
+------+  |             Centre               |
| Left |  |                                  |
|      |  |   Right content is a Sheet,      |
+------+  |   open only when asked           |
          +----------------------------------+

Phone (below 600): one pane at a time
+----------------------+      +----------------------+
|  Centre              |  or  |  Left                |
|  (or Left)           |      |  (or Centre)         |
+----------------------+      +----------------------+
|  Dock as a bar       |      |  Dock as a bar       |
+----------------------+      +----------------------+
```

At wide and compact widths the left column is 288 px, and at wide the right
island is 264 px. The dock sits above the left island and is 60 px tall. The
centre takes the rest.

**What goes where**

|Region|Goes here|Does not go here|
|---|---|---|
|Dock (optional)|The community switcher: a Dock of DockItems|Anything else. See [Components](components.md)|
|Left|The place: community header, channels, voice rooms, the user's own card|The conversation itself, or actions the screen cannot do without|
|Centre|The conversation or task, with its own header, list and composer|Context that the conversation merely refers to|
|Right (optional)|Members, a thread, pins|Primary actions, or anything the user must reach on a tablet or phone without opening a Sheet|

The centre island has no padding of its own, because the conversation brings
its own header, list and composer.

**How the right region behaves.** At wide it is an island beside the centre.
Below wide it is a Sheet over the screen. The screen controls the Sheet: it
says whether it is open, and it handles the close request (Escape, a press on
the dimmed page, or the Close button). The right content is rebuilt when the
width crosses the boundary, so do not keep important state only inside it. If a
screen has no right content, there is no right region at any width.

**How the phone panes behave.** The screen chooses which pane a phone shows:
the centre (the default) or the left. The pane that is not shown stays alive
behind the scenes, so a half-typed message is still there when the user comes
back. It is hidden from the eye, from the keyboard and from screen readers, so
nothing in it can be reached by accident. On a phone the dock becomes a bar
under the pane, and the template keeps it clear of the home indicator.

**Landmarks and labels.** The left island is a navigation landmark, the centre
is the main, the right is a complementary landmark, and the dock is its own
navigation. They are in reading order. A screen must supply `leftLabel` and
`centreLabel`. It should supply `rightLabel`, which names the right island and
the Sheet; if you leave it out, the name is "Details". The Dock needs its own
`label`. On a phone showing the left pane, that pane takes the role of the main
so the page always has exactly one.

Stories: `kit-three-islands--chat`, `kit-three-islands--no-right`,
`kit-three-islands--right-open`, `kit-three-islands--phone-left`,
`kit-three-islands--chat-light`, `kit-three-islands--no-dock`.

## Settings with side navigation

For changing settings: a community's settings, a user's settings, anything that
is a list of sections with a form for each.

```
Wide and compact (600 and above)
+------+  +------------------------------+
| Nav  |  |                              |
| title|  |   Content island             |
| list |  |   (the main)                 |
|      |  |                              |
|      |  |------------------------------|
|      |  |  Footer (optional)           |
+------+  +------------------------------+

Phone (below 600): one pane at a time
+----------------------+      +----------------------+
|  Nav                 |  or  |  < Back  Title       |
|  title and sections  |      |  Content             |
|                      |      |  Footer (optional)   |
+----------------------+      +----------------------+
```

The nav island is 288 px wide. Wide and compact look the same: this template
has no right region and no dock.

**What goes where**

|Region|Goes here|Does not go here|
|---|---|---|
|Nav|The page's title and the list of sections, usually ListRows. The selected section is the selected row|Settings controls, or more than one level of heading|
|Content|The section being edited|A second navigation. If a section needs sub-sections, use Tabs inside it|
|Footer (optional)|A bar pinned to the bottom of the content island, such as "unsaved changes" with Save and Discard|Anything that is not about the whole page of settings|

**How the phone panes behave.** The screen chooses which pane a phone shows:
the nav (the default) or the content. The content pane gets a header with a
Back button, which calls the screen's `onBack`. As with the chat screen, the
pane that is not shown stays alive and hidden, so a half-edited form survives
going back to the list. While the nav is the pane on show it takes the role of
the main.

**Landmarks and labels.** The nav island is a navigation landmark named by
`navLabel`, headed by the `title`. The content island is the main, named by the
`title`. A screen must supply `title` and `navLabel`.

Stories: `kit-settings-layout--community`, `kit-settings-layout--phone-nav`,
`kit-settings-layout--phone-content`, `kit-settings-layout--community-light`,
`kit-settings-layout--no-footer`.

## The full stage

For watching or presenting media: a voice or video room, a screen share. One
island fills the frame and the media gets as much room as it can.

```
All widths
+--------------------------------------+
|  Header: room name, who is here      |
|                                      |
|              Stage                   |
|     (centred, never cropped)         |
|                                      |
|  Strip of small tiles (optional)     |
|            Controls                  |
+--------------------------------------+
```

People is a Sheet over the stage, opened by the user. The arrangement is the
same at every width; only the size changes.

**What goes where**

|Region|Goes here|Does not go here|
|---|---|---|
|Header|The title row: room name, who is here, how long|Call controls|
|Stage|The big thing: a shared screen, or the people's tiles. It is centred and kept inside the space, never cropped and never wider than it|Controls or text that must stay readable if the picture is large|
|Strip (optional)|A row of small tiles under the stage. It scrolls sideways if it overflows|The main content|
|Controls|The call controls, centred at the bottom|Anything that is not about the call|
|People (optional)|The people in the room, in a Sheet. It is a Sheet at every width, never an island|Primary actions|

**Landmarks and labels.** The one island is the main, named by `stageLabel`,
which a screen must supply. The People Sheet is named by `sideLabel`; if you
leave it out, the name is "People". The screen says whether People is open and
handles its close request.

Stories: `kit-stage-layout--sharing`, `kit-stage-layout--people-open`,
`kit-stage-layout--sharing-light`, `kit-stage-layout--no-strip`.

## A sheet over a screen

The fourth arrangement is not a template of its own. It is the kit Sheet
opened over any template. Use it when the user picks from many things or does
a longer side task that does not deserve a screen of its own: a list of all
communities, an invite flow, a long picker. The screen behind is dimmed and
cannot be used until the Sheet closes.

A Sheet is centred above the phone width and a bottom sheet on a phone. For
what it holds and how it closes, see "Which overlay" and "Sheet" in
[Components](components.md). The three templates above already use a Sheet for
their right or side content, so you do not build that part yourself.

Stories: `kit-sheet--all-communities`, `kit-sheet--phone`.

## Which template

|The user is...|Use|
|---|---|
|In a conversation, or browsing a place with channels, rooms and members|Three islands|
|Changing settings, in sections|Settings with side navigation|
|Watching or presenting media, or in a call|The full stage|
|Picking from many things, or doing a longer side task|A sheet over the current screen|
|Answering one question|Not a layout: use a Dialog|

If two seem to fit, ask which one the user spends most of their time in, and
use that.

## Not decided or built yet

These are decided with the app shell, and they are not built yet. Do not make
up an answer on your own screen.

- **The voice bar.** Where the bar that shows an active voice connection sits
  while the user is on another screen.
- **Toasts.** Where a Toast appears on each template, and how it clears the
  phone's dock bar.
- **The on-screen keyboard on phones.** How a template makes room for it, and
  where a composer sits when it is open.
- **A top banner.** Where a notice about the whole app, such as "reconnecting"
  or "update available", would go.

## A new template

A new template is the project owner's decision. If none of the templates fits
and a Sheet over a screen does not help, stop and ask, with a mock-up or a short
note. Do not build it first. See [Extending the system](extending.md).
