# Tokens and colour

A token is a named value, such as a size or a colour. A designer picks the
name. The code looks up the value. Both the web app and the native app read
the same values, so a screen looks the same in both.

The values live in `design/tokens.json` (sizes, type, timings) and
`design/colour.json` (colour). The tables below are copied from them. If a
table and the file disagree, the file is right.

Units are pixels unless a table says otherwise.

## Scales

### Space

The gap between things. Use these for padding, margins and gaps.

|Token|px|Use it for|
|---|---|---|
|none|0|No gap|
|2xs|2|The thinnest gap|
|xs|4|Tight gaps|
|sm|8|Gaps between neighbouring items|
|md|12|Padding inside cards and fields, and medium gaps|
|lg|16|Gaps between panels and the outer edge of the screen|
|xl|24|Space between groups of items|
|2xl|32|Space around a large section|
|3xl|48|The biggest gap|

### Radius

How round a corner is.

|Token|px|Use it for|
|---|---|---|
|field|14|Text fields|
|card|18|Cards|
|island|24|Islands, the large panels that sit on the ground colour|
|full|9999|Fully round: buttons, pills, small tags, and search and message fields|

### Control heights

|Token|px|Use it for|
|---|---|---|
|sm|32|Small buttons and controls|
|md|40|Default buttons and controls|
|lg|48|Large buttons and controls|

### Fonts

|Token|Family|Use it for|
|---|---|---|
|heading|Bricolage Grotesque|Titles, section headings and names|
|body|Figtree|Everything else|

### Text styles

Pick a text style. Do not set a size or weight by hand. Size and line are in
px. Weight is a plain number (400 is normal, 700 is bold).

|Style|Font|Size|Line|Weight|Use it for|
|---|---|---|---|---|---|
|title|heading|20|26|700|The title of a screen or panel|
|section|heading|15|20|600|Section headings|
|name|heading|15|20|700|People's names and room names|
|body|body|15|22|400|Normal text, such as message text|
|bodyStrong|body|15|22|600|Normal text that needs emphasis|
|meta|body|13|18|400|Secondary details such as times and counts|
|small|body|12|16|400|Small print and captions|
|tag|body|11|16|600|Labels inside small tags|

### Shadows

Alpha is the opacity of black, from 0 (clear) to 1 (solid).

|Token|x|y|Blur|Alpha|Use it for|
|---|---|---|---|---|---|
|island|0|6|24|0.35|Islands|
|overlay|0|24|64|0.6|Things that float above the screen, such as dialogs and menus|

### Timings

In milliseconds.

|Token|ms|Use it for|
|---|---|---|
|fast|120|Small changes, such as a hover or a press|
|base|200|Most changes|
|slow|320|Large changes, such as a panel opening|

### Breakpoints

The screen width, in px, at which the layout changes.

|Token|px|Meaning|
|---|---|---|
|phone|600|Phone width and narrower|
|narrow|1024|Narrow width|
|docked|1200|Wide enough for a side panel to stay open beside the content|

The Layouts chapter, which says what changes at each width, is not written yet.

### Layout widths

|Token|px|Use it for|
|---|---|---|
|gutter|16|The gap between islands and the padding around the screen|
|leftColumn|288|Width of the left column|
|rightColumn|264|Width of the right column|
|dock|60|Height of the dock, the rounded bar of pinned communities|

## Colour

### The three inputs

Every colour on a screen comes from a palette. The app makes the palette
from three inputs:

1. **Base colour.** One colour, chosen by the person using the app. It sets
   the accent and the hue of the greys.
2. **Mode.** Dark or light.
3. **Intensity.** Minimal, balanced or vibrant. It sets how strongly the base
   colour tints the greys (see "What intensity changes").

A screen never uses the base colour directly. It uses the roles below. The
palette turns each role into a real colour.

### The 16 roles

|Role|What it is for|What it may sit on|
|---|---|---|
|ground|The background behind the islands|Nothing. It is the bottom layer|
|surface|Islands and panels|ground|
|fill|The soft fill for cards, fields and hover|ground or surface|
|hairline|Thin borders and the border of a popover|any of the three|
|text|Normal text|ground, surface or fill|
|textSecondary|Less important text|ground, surface or fill|
|textDim|Icons and offline states. Dim text|ground or surface only, never fill|
|accent|The selected item and primary buttons|ground or surface|
|onAccent|Text and icons on top of accent|accent only|
|accentText|Text that is accent-coloured|ground, surface or fill|
|focus|The focus ring, which shows where the keyboard is|ground, surface or fill|
|positive|Good, online or speaking|ground, surface or fill|
|warning|Take care|ground, surface or fill|
|danger|Error or destructive action|ground, surface or fill|
|onDanger|Text and icons on top of danger|danger only|
|scrim|The dim layer behind an overlay such as a dialog or sheet|On top of the whole screen. It is see-through|

Use text on accent and danger only through onAccent and onDanger. Use
accentText, not accent, when you want accent-coloured text.

### What the palette promises

The palette checks these contrast ratios when it is made. Contrast is the
difference in brightness between two colours. 4.5 is the usual minimum for
readable text.

|Role|Promise|
|---|---|
|text|At least 4.5 on ground, surface and fill|
|textSecondary|At least 4.5 on ground, surface and fill|
|textDim|At least 4.5 on ground and surface (not fill)|
|accentText|At least 6.9 on ground, surface and fill|
|accent|At least 3.0 on ground and surface, and onAccent reaches at least 4.5 on it|
|focus|At least 3.0 on ground, surface and fill|
|positive, warning, danger|At least 4.5 on ground, surface and fill. For danger, onDanger is the clearer of the two ink colours on it|
|onAccent, onDanger|At least 4.5 on accent and on danger. Each is the better of two colours, one dark and one light|

The scrim has no contrast promise. It only dims what is behind it.

The palette keeps these promises for every base colour, both modes and all
three intensities. You do not need to check them. You do need to keep each
role on the backgrounds listed in the table above, because the promise only
covers those.

### What intensity changes

Intensity sets how much of the base colour tints ground, surface, fill and
hairline. At minimal they are close to plain grey. At vibrant they carry a
clear tint of the base colour. The tint multipliers are 1 for minimal, 2.5 for
balanced and 5 for vibrant.

Intensity tints only ground, surface, fill and hairline. The other roles keep
their own lightness, nudged only as far as needed to keep their contrast on the
tinted backgrounds. (A very dull base colour gives less tint at every
intensity.)

## Rules

1. **Never write a hex colour or a pixel number on a screen.** Pick the role
   or the token by name.
2. **A colour need with no role goes through "Extending the system".** Do not
   pick a close colour. The chapter is not written yet. Until it is, ask for
   the role to be added.
