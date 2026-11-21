# Fonts

The design system's two faces (`font` in `design/tokens.json`), as TrueType files for the
native clients:

|File|Face|Upstream file (google/fonts)|Axes|
|---|---|---|---|
|`figtree_wght.ttf`|Figtree (`font.body`)|`ofl/figtree/Figtree[wght].ttf`|weight 300-900|
|`figtree_italic_wght.ttf`|Figtree Italic|`ofl/figtree/Figtree-Italic[wght].ttf`|weight 300-900|
|`bricolage_grotesque_wght.ttf`|Bricolage Grotesque (`font.heading`)|`ofl/bricolagegrotesque/BricolageGrotesque[opsz,wdth,wght].ttf`|optical size, width, weight|

- **Source:** [google/fonts](https://github.com/google/fonts) at commit
  `06bfe0d62a98375cb09c942fa18e68bd32cff057`. These are the upstream variable fonts; a client
  picks the weights the text styles use (400, 500, 600, 700) through the weight axis. Bricolage
  keeps its default optical size and width, as the web's static instances do.
- **Fetch and check:** `design/fonts/fetch.sh` downloads a missing file and checks every file
  against its pinned SHA-256; `design/fonts/fetch.sh --check` only checks. To move to a newer
  upstream, change the commit and the hashes in the script together.
- **Names:** lower case with underscores, so Android can use them as font resources as they are.
- **Licence:** both faces are under the SIL Open Font License 1.1 (`LICENSE-OFL.txt`, with both
  copyright lines). The OFL allows bundling the fonts in an app; the licence and the copyright
  notices must travel with them, so every client that ships these files ships `LICENSE-OFL.txt`
  too (Android: the `open_source_licences.txt` asset).

**Who uses them:** the Android app (`native/android/kit`, copied into its font resources at build
time). The web client bundles the same faces from fontsource (`frontend/src/kit/fonts.ts`), and
the desktop client has its own copies for now; moving desktop to these files is a later cleanup.
