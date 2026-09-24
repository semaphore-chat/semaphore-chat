# README and Docs Media — Design

Date: 2026-09-23 · Status: approved in conversation · Branch: `feat/readme-media` (stacked on PR #447)

## Goal
Show people what Semaphore Chat looks like and what it can do before they install it. The README gets a looping hero clip and a screenshot grid, and the docs site gets a Tour page with the video and a click-through gallery grouped by feature. Everything is generated from the Ladle sandbox, so it can be regenerated whenever the UI changes.

## Decisions (user-approved)
- **Storage:** an orphan `media` branch, following the same pattern as the existing `badges` branch. The README and docs reference `https://raw.githubusercontent.com/semaphore-chat/semaphore-chat/media/<path>`. `main` carries only the generator code, never image or video files. Each publish force-pushes a single commit so the branch history stays at one commit.
- **Format:** a hero loop in the README (animated WebP, with a GIF fallback) plus a 2×3 screenshot grid. In the docs, a new Tour page (MP4 with controls, and a gallery grouped by feature using `mkdocs-glightbox` for lightbox and swipe) and a hero image on the docs home page that links to the Tour.
- **Publishing timing:** push the `media` branch only after #447 has merged, so the README never shows UI that isn't on `main` yet.

## Components
1. **Showcase scenario** (`frontend/src/stories/fixtures/showcase.ts`): polished, realistic fake data built with the existing `buildScenario` and modifiers. It includes:
   - A community with a logo and well-named channels (`#general`, `#dev`, `#design`, `#announcements`, voice channels "Lounge" and "Standup").
   - About 12 members with realistic, diverse names and generated illustrated avatars. Avatars are rendered locally, deterministically and without network access, for example SVG made in code and served through the existing `/api/file/:id` MSW path.
   - A natural conversation in `#dev` showing a code block, an image attachment, reactions, a reply, a thread with replies, a mention and a link.
   - DMs, including a group DM, with unread counts; a few notifications; 3–4 people in voice with speaking rings.
   - A second community icon in the rail.
   - No "SIMULATED" camera tiles in marketing shots; avatar tiles only.
   - Fixed dates so timestamps are stable.
2. **Tour stories** (`frontend/src/stories/tour/*.stories.tsx`, ids prefixed `tour-`): one story per screenshot subject, and scene stories for the video, with interactions driven by the existing interaction helpers.
3. **Media generator** (`frontend/scripts/media/`):
   - `shots.mjs`: screenshots each `tour-` story at desktop 1440×900 and phone 390×844, with deviceScaleFactor 2, in dark mode plus selected light-mode shots. Exports optimized WebP and a PNG for OG and social cards.
   - `record.mjs`: Playwright `recordVideo` of the scripted scenes at 1440×900, with realistic cursor movement and typing, visible clicks and a steady pace.
   - `encode.sh`: ffmpeg in Docker joins the scenes with short crossfades and exports `tour.mp4` (H.264, CRF about 28, faststart), `hero.webp` (animated, about 12–15 fps, about 960px wide, target 2MB or less) and `hero.gif` (fallback, target 5MB or less).
   - `manifest.json`: a list of every asset with its caption and alt text, used when building the docs gallery.
   - A compose service, `media` in the `tools` profile. Run it with `docker compose --profile tools run --rm media`, which writes to `frontend/.media-out/` (gitignored).
   - `publish-media.sh`: builds an orphan commit from `.media-out/` and runs `git push --force origin <commit>:refs/heads/media`. It prints the URLs. It is never run automatically.
4. **README:** under the intro, add the hero image (linked to the Tour page) and a 2×3 grid with captions. It uses raw `media`-branch URLs, standard Markdown or HTML that GitHub renders, and alt text on every image.
5. **Docs site:**
   - A new `docs-site/docs/tour.md`, added to the nav after Home: video, then gallery sections for Chat, Threads & replies, Voice & video, DMs, Communities & roles, Mobile & PWA, Themes.
   - Add `mkdocs-glightbox` to `requirements.txt` and `mkdocs.yml`.
   - A hero image and link on `index.md`.
   - A "Regenerating screenshots" section in `contributing/` explaining the commands.

6. **Project skill:** `.claude/skills/regenerate-media/SKILL.md`, a Claude Code skill (user-requested) that captures how to recreate the media in the future:
   - when to use it
   - the showcase scenario and tour stories
   - adding or changing a shot or scene
   - the generate, review and publish commands
   - the quality checklist (the "no sandbox artefacts" list and the size targets)
   - where the README and docs reference the files
   - gotchas found while building it

   It is written after the pipeline works, and is based on what actually worked.

## Out of scope
- Automatic CI regeneration (possible later).
- Electron-specific screenshots (needs the Electron fixture flag, a separate follow-up).
- Recording real camera or screen share.

## Acceptance
- **Hero clip:** about 15 seconds, smooth, legible, at most 2MB as WebP, and it loops cleanly.
- **Screenshots:** crisp at 2×, no sandbox artefacts (Ladle chrome, "SIMULATED" labels, broken images, error toasts), with realistic content throughout.
- **Rendering:** the README renders correctly on GitHub, and `mkdocs build --strict` passes. That can only be fully checked after the `media` branch exists, so before then verify it with local paths.
- **Repository hygiene:** no media files are committed on `main` or on the feature branch.
