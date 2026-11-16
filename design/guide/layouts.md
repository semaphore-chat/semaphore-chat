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

**The banner.** A frame can have a `banner`: a row above everything, for a
notice about the whole app such as "reconnecting" or "update available". Put a
kit Alert in it. Several alerts stack, the most urgent first, a small gap
apart, and only a few at once: at most two below the wide range (a phone, a
tablet) and three at wide. While a phone's on-screen keyboard is up, only one
shows, the most urgent, on a single line (the Alert's `oneLine`: its text is cut
with an ellipsis, its actions and Dismiss stay beside it); the rest, and the
full banner, return when the keyboard goes down, so the call bar's Leave and the
composer keep their room. The order, most urgent first, is a ringing call, a
connection problem, a security notice, a failed update, an update ready, the
offer to install, and download progress. The quiet ones (the install offer and
download progress) show only when nothing else does. When more are pending than
fit, the least urgent wait, unseen, and show when one above them goes; there is
no "more" control. A connection problem that clears within a moment (a slow
first connect, a short drop) never shows. It sits inside the safe area, takes its natural height, and the
template below fills what is left, so no island is pushed off the screen. With
no banner there is no row and no gap.

**The on-screen keyboard (phones).** While the keyboard is up, the frame ends
where the keyboard starts, and it gives up the home-indicator padding, because
the bottom of the screen is now the keyboard. A template that has a dock bar
leaves it out while the keyboard is up, so a composer keeps the room. The kit
reads the keyboard's height from the browser (`useKeyboardInset`); a screen
that needs it can read it too. The toast region does not need to: it sits in
the main island, which already ends above the keyboard.

**Toasts.** The frame renders the toast region. See [Where toasts
sit](#where-toasts-sit).

Stories: `kit-app-frame--empty`, `kit-app-frame--with-banner`.

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

## Where toasts sit

One rule at every width and on every template: a toast sits at the **bottom
centre of the screen's main island**, a gutter above the island's bottom edge,
and above anything pinned to the bottom of that island (the composer, the call
controls, a settings footer). It is as wide as the island less a gutter on
each side, and never wider than a small dialog (400 px).

- **Phone.** The main island already ends above the call bar, the dock bar and
  the keyboard, so the toast clears all of them. The stack from the bottom up
  is: the keyboard (or the dock bar), the call bar, the composer, the toast.
- **Compact and wide.** The toast floats over the bottom of the centre island.
  It never sits over the left column (the call bar and its Leave), the dock or
  the right island.
- **Under a dialog or sheet.** The toast stays where it is, on the dimmed page
  under the dialog, so it never covers the dialog's own buttons. It cannot be
  reached, and its timer and every waiting toast's wait stop until the dialog
  closes, so nothing raised meanwhile is dropped unseen: it shows after the
  dialog closes. Screen readers hear a toast from inside the dialog when it
  appears.
- **Under any overlay.** The toast is one level below every overlay: a menu, a
  popover or a select list opened from the composer is drawn over it.

```
Compact, in a call
+------+  +----------------------------------+
| Dock |  |  Header                          |
+------+  |                                  |
+------+  |  Messages                        |
| Left |  |                                  |
|      |  |      +----------------------+    |
+------+  |      |  Toast               |    |
| Call |  |      +----------------------+    |
+------+  |  [ Composer                    ] |
          +----------------------------------+

Phone, keyboard up
+----------------------+
|  Messages            |
|  +----------------+  |
|  |  Toast         |  |
|  +----------------+  |
|  [ Composer      ]   |
+----------------------+
|  Call bar            |
+----------------------+
|  (keyboard)          |
+----------------------+
```

**For a screen.** Show toasts with `useToasts()` from the kit. Never render a
Toast yourself and never position one. A template marks its main island; a
screen marks its own bottom-pinned element with `useToastClearance(ref)` (the
templates already do it for the stage controls and the settings footer).

Stories: `kit-toast-region--in-call`, `kit-toast-region--in-call-light`,
`kit-toast-region--phone-keyboard`, `kit-toast-region--sticky-danger`,
`kit-toast-region--sticky-danger-light`, `kit-toast-region--queued`,
`kit-toast-region--under-dialog`, `kit-toast-region--on-stage`,
`kit-toast-region--menu-over-toast`, `kit-toast-region--settings-footer-appears`,
`kit-toast-region--settings-with-unsaved-footer`.

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
|      |  |      [ Toast ]         |  |        |
+------+  +------------------------+  +--------+

Compact (600 to 1199)
+------+  +----------------------------------+
| Dock |  |                                  |
+------+  |                                  |
+------+  |             Centre               |
| Left |  |                                  |
|      |  |   Right content is a Sheet,      |
+------+  |   open only when asked           |
| Call |  |                                  |
+------+  +----------------------------------+

Phone (below 600): one pane at a time
+----------------------+      +----------------------+
|  Centre              |  or  |  Left                |
|  (or Left)           |      |  (or Centre)         |
|     [ Toast ]        |      |     [ Toast ]        |
+----------------------+      +----------------------+
|  Call bar (optional) |      |  Call bar (optional) |
+----------------------+      +----------------------+
|  Dock as a bar       |      |  Dock as a bar       |
+----------------------+      +----------------------+
```

(At wide, the call bar is under the left island, as at compact; the diagram
shows it once.) At wide and compact widths the left column is 288 px, and at
wide the right island is 264 px. The dock sits above the left island and is 60
px tall. The centre takes the rest.

**The left island's footer** (`leftFooter`) holds the user's own card at
compact and wide: it stays at the island's foot while the channels and voice
rooms above it scroll. It is part of the island; the call bar, when there is one,
sits under the island and so under this footer. A phone has no user card; the
island keeps its structure there (the footer is empty, not removed), so the
channels and their scroll and focus survive a resize. Web kit only so far; the
native kit has not caught up (see [Extending the system](extending.md#the-native-kit-is-catching-up)).

**The call bar** is the strip that shows you are in a voice room, with Mute,
Deafen and Leave. It is optional. At compact and wide it sits at the bottom of
the left column, under the left island. On a phone it sits between the pane on
show and the dock bar, and it stays on screen whichever pane is shown, so the
user can always reach Leave. With no call bar there is no row and no gap.

In the app the call bar shows the room and what is happening (joining, muted,
who is talking, reconnecting with Cancel, "Hold V to talk", or why the mic is
blocked), and **Mute, Deafen and Leave at every width** (Mute is a hold-to-talk
control on a touch layout under push-to-talk). The room's name with its line is
itself the Open call view control at every width (a pressable row named "Open
call view, <room>", described by its line, with a chevron); there is no
separate Open button, on the bar or on the video above it, so the name has the
room it needs (a typical name shows whole in the 288 px column). The
call's controls never depend on which left island is shown and nobody is ever
deafened without a control on screen to undeafen. The user's own card in the
left island shows their status only; it has no call controls. Mute while
deafened opens the mic and leaves you deafened (as the old app's Mute does),
and the line then says "Deafened · your mic is on". While reconnecting, a row
above says so with Cancel, and nothing in the bar says "connected". A reason
the mic cannot open (muted by a moderator, timed out, no permission to speak)
is the bar's line, on a line of its own under the room so it is read in full
(two lines at most; the room's name may be cut short instead), and the mic
stays a Tab stop that reads as unavailable and says the reason when pressed.
Under push-to-talk with a key, pressing the mic says "Hold V to talk". While a
join is still connecting the bar shows only the room and "Joining…", and
nothing in it can be pressed. The camera, starting a screen share, the
soundboard, replay capture, device settings and the debug panel are not in the
bar: the room's name opens the full call screen, which has them, and device
settings are also in Settings.

Above the bar, in the same slot, the call's video appears while someone in the
call shares a screen or has a camera on, or you share your screen. A share or
camera you do not watch is offered with Watch, and nothing is received until
the user chooses it; past three of them, a summary row ("2 screens shared · 8
cameras on", with See all for the call view) comes above the first three. A
watched one shows its picture, with Stop watching, which stops receiving every
picture you watch (unlike the old app's close button on the video overlay,
which only hid it). Your own share has Stop sharing.

**The video never pushes the bar or the composer off the screen.** It takes at
most two fifths of the layout's height (what the three islands have after the
app banners, the keyboard and the safe areas) and scrolls inside itself beyond
that; the bar under it keeps its whole row at every width. On a phone the shown
pane keeps at least a composer's height (`control.md` + `space.sm` +
`space.lg`, 64 px) while a call bar is there, and the video gives way first, so
banners never push the composer, the bar or the dock off the screen. With the
keyboard up on a very short frame the bar (Leave) wins over the pane's minimum. While the on-screen
keyboard is up the video is one summary line ("Watching dropbear's screen · 1
camera on") so the composer keeps its room; while you share it keeps Stop
sharing. The kit's CallStack does this; see
[Components](components.md#callstack). Out of a
call, the slot shows the voice notice instead: a join that failed or why the
call ended, with Retry when trying again can help, and Dismiss.

**What goes where**

|Region|Goes here|Does not go here|
|---|---|---|
|Dock (optional)|The community switcher: a Dock of DockItems|Anything else. See [Components](components.md)|
|Left|The place: community header, channels, voice rooms, the user's own card|The conversation itself, or actions the screen cannot do without|
|Centre|The conversation or task, with its own header, list and composer|Context that the conversation merely refers to|
|Call bar (optional)|The persistent in-call strip: the room (it opens the call view), Mute, Deafen, Leave, and the call's video above them|Anything that is not about the call you are in|
|Right (optional)|Members, a thread, pins|Primary actions, or anything the user must reach on a tablet or phone without opening a Sheet|

The centre island has no padding of its own, because the conversation brings
its own header, list and composer.

**How the right region behaves.** At wide it is an island beside the centre.
Below wide it is a Sheet over the screen. The screen says whether the right
content is showing with `rightOpen`, and it means the same at every width:
showing, as an island at wide and as a Sheet below. If the screen leaves
`rightOpen` out, the right content shows at wide and is closed below, so a
resize never opens a Sheet by itself unless the user had asked to see the
content. Below wide the template tells the screen when the Sheet asks to close
(Escape, a press on the dimmed page, or the Close button). At wide the screen
closes the island with its own control, such as a Members button in the centre
header, which sets `rightOpen` for every width. With `rightOpen` false at wide
there is no island, no empty landmark and no gap: the centre takes the room.
The right content is rebuilt when the width crosses the boundary or the Sheet
closes, so do not keep important state only inside it: keep a reply draft or a
scroll position in the screen's own state. If a screen has no right content
(nothing, or an empty value), there is no right region at any width.

**How the phone panes behave.** The screen chooses which pane a phone shows:
the centre (the default) or the left. The pane that is not shown stays alive
behind the scenes, so a half-typed message is still there when the user comes
back. It is hidden from the eye, from the keyboard and from screen readers, so
nothing in it can be reached by accident. When the pane that holds the focus is
the one that gets hidden (the user picks a channel, the window is rotated, the
right island goes away), the focus moves to the pane now shown, so a keyboard or
screen-reader user does not lose their place. On a phone the dock becomes a bar
under the pane, and the template keeps it clear of the home indicator. The
template has no Back button of its own: the centre's header brings one that
sets the pane back to the left.

**Landmarks and labels.** The left island is a navigation landmark, the centre
is the main, the right is a complementary landmark, and the dock is its own
navigation. They are in reading order. A screen must supply `leftLabel` and
`centreLabel`. It should supply `rightLabel`, which names the right island and
the Sheet; if you leave it out, the name is "Details". The Dock needs its own
`label`. On a phone showing the left pane, that pane takes the role of the main
so the page always has exactly one.

**Empty slots.** An optional slot that is nothing, empty, or false (a
conditional that did not apply) is simply not there: no region, no column, no
empty Sheet, no gap.

Stories: `kit-three-islands--chat`, `kit-three-islands--no-right`,
`kit-three-islands--right-open`, `kit-three-islands--right-closed-wide`,
`kit-three-islands--phone-left`, `kit-three-islands--in-call`,
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
Back button, which calls the screen's `onBack` (every screen must supply it: a
phone has no other way back to the list). As with the chat screen, the pane that
is not shown stays alive and hidden, so a half-edited form survives going back
to the list, and focus moves to the pane now shown. While the nav is the pane on
show it takes the role of the main.

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
|            [ Toast ]                 |
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

These are decided with the app shell, and they are not all built yet. Do not
make up an answer on your own screen.

- **The viewport setting for the keyboard.** The frame follows the keyboard from
  what the browser reports, but the page's viewport setting (`index.html`, the
  `interactive-widget` option for Android) is an app-level change that is not
  made yet. Until it is, a phone may pan the page instead of resizing it.
- **The call bar on other templates.** The call bar stays on screen while the
  user moves between three-islands screens: the frame keeps it mounted, with
  the dock, the left island and the members. Settings screens and the full stage
  are still the old shell's, so the call bar is not on them yet. "Open call view"
  goes to the old shell's call stage.
- **A phone thread as a full pane.** Below wide the right content is a Sheet. A
  thread with a composer may want to be a pane of its own on a phone.

## Registering a screen

The web app shows a screen in the new shell only where it is registered. A
route that is not registered, and a registered route at a width it does not
list, stays on the old shell exactly as before. Registering a screen takes two
things and nothing else:

1. **One entry in `LOUNGE_ROUTES`** (`frontend/src/shell/loungeRoutes.ts`):

   ```ts
   {
     path: '/community/:communityId',
     widths: ['phone'],
     load: () => import('./lounge/screens/CommunityHomeScreen'),
   },
   ```

   - `path` is the same pattern as in `routes.tsx`: the old screen still shows
     it at the other widths, and for everyone with the new design off. The
     registry test fails when the path is missing from `routes.tsx`.
   - `widths` lists the width ranges where the screen is converted. List a
     width only when the screen is finished there.
   - `load` imports one module under `shell/lounge/screens/`, so each screen is
     its own lazy chunk.
2. **A descriptor**, the module's default export (`shell/lounge/screen.ts`).
   It names the template and gives the screen's parts. The frame draws the rest:

   ```ts
   const communityHome: ThreeIslandsScreen = {
     template: 'threeIslands',
     place: 'community',      // the left island: the community's channels and rooms
     phonePane: 'left',       // a phone shows the left pane
     Centre: null,            // nothing in the centre yet
     right: 'members',        // the shell's members island
     useTitle: useCommunityTitle,
   };
   export default communityHome;
   ```

   Do not set `links` on a real screen. It is only for test fixtures (see
   below), and the registry test checks that.

The community home above is the first real entry (`COMMUNITY_HOME_PATH`, phone
only). Three rules came with it:

- **Never claim a static sibling.** A pattern such as `/community/:communityId`
  also matches `/community/create`. `chooseShell` ranks the registered routes
  together with the old shell's static siblings (`CLASSIC_STATIC_PATHS` in
  `loungeRoutes.ts`) the way React Router ranks `routes.tsx`, so a static
  segment wins and the old shell keeps it. The registry test walks every route
  of `routes.tsx` and fails when the new shell would take a path the old router
  gives to another route: add the sibling to `CLASSIC_STATIC_PATHS`.
- **Real screens are web-only for now.** In the desktop app (`isElectron()`)
  only the `/__lounge` fixtures can be the new shell; every real route stays on
  the old shell at every width and zoom.
- **Right content needs a way in on a phone.** A phone screen whose descriptor
  has right content (the members) gives a control that opens it: the community
  header's "N around" (`useScreenChrome().setRightOpen(true)`), plain text only
  while the members island is beside the list at wide. The kit Sheet returns
  focus to that control when it closes.

Moving between two screens of the same template keeps the dock, the left island
(its scroll and focus), the members and the call bar mounted. Only the centre
changes. Every screen still names its template in its pull request (see "The
rule").

**Test fixtures.** A path under `/__lounge` is a hidden fixture, never a real
route: with the new design off it is the old shell's "Page not found". The
community fixture, `/__lounge/community/:communityId`, puts every piece of the
shell on real data around a placeholder centre, so the end-to-end tests can
check the pieces before a real screen is registered. Its descriptor sets
`links`, so its dock and "All communities" sheet stay on the fixture. When a
real screen takes over, point those tests at the real path.

## A new template

A new template is the project owner's decision. If none of the templates fits
and a Sheet over a screen does not help, stop and ask, with a mock-up or a short
note. Do not build it first. See [Extending the system](extending.md).
