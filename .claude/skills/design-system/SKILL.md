---
name: design-system
description: How to build UI that fits Semaphore Chat's design system, and what to do when the system lacks something. Use it whenever you build or change UI in frontend/src/kit, the new shell or a converted screen, native/crates/semaphore-ui, or anything under design/ (tokens, palette, icons, the guide). Use it for requests like "make a screen", "add a component", "add a colour / token / icon", "this needs a dialog / toast / menu / sheet", and before you write `sx`, a raw colour (#rrggbb, rgb()) or a pixel value in a screen. It tells you what to read, the ground rules, the steps for a screen, and the path for adding a missing token, component, variant, behaviour or layout. Skip it for bug fixes on old screens that do not change how they look, and for backend-only work.
---

# Design system

Semaphore Chat has one design system for the web client and the native client: tokens and a derived palette (`design/`), a component kit (`frontend/src/kit`, `native/crates/semaphore-ui`) and a written guide (`design/guide/`). A screen built from the system looks like it was always part of the app. This skill is the workflow. The guide has the content, so read it and do not work from memory.

## When

- **Applies** to any UI work in `frontend/src/kit`, a converted screen or the new shell, `native/crates/semaphore-ui`, or `design/**`. Also to any request to make a screen or add a component, colour, token or icon, and before you write `sx`, a raw colour or a pixel number.
- **Skip** it for fixes to old screens that keep their look, and for backend-only work. If you are unsure, read the guide's README. It takes a minute.

## Read first, in this order

1. `design/guide/README.md`: the chapters and the three rules.
2. `design/guide/principles.md`: what makes a screen Semaphore, and what we never do.
3. "How a screen is built" in `design/guide/components.md`: ground, islands, cards, overlays.
4. The chapter for the task: `components.md` (what each piece is for and its options), `tokens-and-colour.md` (sizes, palette roles), `writing.md` (words on screen), `extending.md` (something is missing).

The guide's examples are the live stories in `frontend/src/stories/kit/`. Open the story of every component you use.

## Ground rules

- Build only from the kit and the tokens. Components take a closed list of variants and sizes, never free-form style props.
- Never import `@mui/*` outside `frontend/src/kit`.
- No raw colours and no pixel numbers on a screen. Name the palette role or the token.
- Every control has a label, even a hidden one. `loading` is not `disabled`.
- Sentence case, plain words, verbs on buttons (`design/guide/writing.md`).
- Look at screenshots at phone, tablet and desktop width before you call a screen done.
- A change to a system piece lands in both clients. Until the native kit catches up, it lands on the web first with a tracked follow-up (`extending.md`).

## Building a screen

1. Name the layout template. The Layouts chapter does not exist yet, so follow "How a screen is built" (islands on a ground) and say in the PR which arrangement you used. Once `design/guide/layouts.md` exists, pick a template from it. Do not invent one.
2. Compose the screen from kit components. Read each one's "Use it when / Do not use it when" lines.
3. Cover the states: loading, empty, error, long content and narrow width. Use the Skeleton, the empty-state wording and the error wording from the guide.
4. Add or update Ladle stories for the states (`docs-site/docs/contributing/stories.md`).
5. Run the `ui-pr-review` skill before you open or update the PR.

## When something is missing

1. Look again. Find the closest token, component, behaviour or layout and try the screen with it.
2. If it truly does not fit, follow `design/guide/extending.md`: name the kind of thing missing, add it to the system (source, both clients, stories, tests, guide entry with "use it when / do not use it when"), then use it.
3. Decision rights:
   - A token value, a variant or a small component: you may add it. Normal review judges it.
   - A new layout template, a new principle or a change to existing behaviour: stop and ask the project owner, with a mock-up or a short note. Do not build it first.
4. A real one-off may carry a `design-exception: <reason>` comment on the line. Run `python3 design/gen/list_exceptions.py` to update `design/guide/exceptions.md`. Prefer adding to the system.
5. Token changes: edit `design/tokens.json` (or `design/colour.json`), run `python3 design/gen/gen_tokens.py`, commit the source and the generated files together. Never edit generated files.

## The PR description

Every PR that touches UI or the system has a "Design system changes" section: what was added or changed (token, component, variant, behaviour, template) in each client, and why the existing pieces did not fit. If nothing was added, write "Design system changes: none". Add the native follow-up issue when a piece landed on the web only.
