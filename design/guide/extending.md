# Extending the system

The guide will not foresee everything. Sooner or later a screen needs
something that is not there. When that happens, do not improvise on the
screen. There is one path, and it is the same for a person and for an LLM.

## The four steps

1. **Look first.** Find the closest existing token, component, behaviour or
   layout template, and try the screen with it. Most needs are already met.
   Read the "Use it when" and "Do not use it when" lines in
   [Components](components.md) before you decide something is missing.
2. **Say what kind of thing is missing.** Name it as one of the kinds in the
   next section. If you cannot say which kind it is, you have not looked hard
   enough yet.
3. **Add it to the system before you use it.** Add the source, the piece in
   both clients, its stories, its tests and its guide entry (see "Done means"
   below).
4. **Then build the screen with it**, in the same pull request or the next one.
   The pull request description has a "Design system changes" section.

## What can be missing, and where it lives

|Kind|What it is|Where it lives|
|---|---|---|
|Token value|A size, radius, type style, timing, colour role or icon that has no name yet|`design/tokens.json` (or `design/colour.json`, `design/icons/`), and the generator `design/gen/gen_tokens.py`. The tables in [Tokens and colour](tokens-and-colour.md)|
|Component|A building block the kit lacks|`frontend/src/kit` (web) and the native kit `native/crates/semaphore-ui/src/kit`. An entry in [Components](components.md)|
|Variant|A new option of an existing component (a new `variant`, `size` or `tone`)|The component, in both kits, and its table in [Components](components.md)|
|Behaviour|How things respond: what Escape does, how a confirmation works, how an empty or error state shows|The Behaviour chapter of this guide (not written yet) and the code it describes|
|Layout template|A new arrangement of islands for a whole screen|The Layouts chapter of this guide (not written yet) and the layout components|

A new colour is not a new kind. It is a token value: a colour need that has no
role goes in as a role in `design/colour.json`, and the palette derivation
keeps it readable. Do not pick a close colour and use it.

## Done means

An addition is finished when all of these are true:

- **Source.** The token, component or behaviour is defined in its source (see
  the table above). Generated files are regenerated, not edited by hand.
- **Both clients.** It exists in the web kit and in the native kit, with the
  same name and the same options.
- **Stories in both.** The web client has Ladle stories in
  `frontend/src/stories/kit/` and the native client has the matching story.
  They cover the states the addition introduces: loading, empty, error, long
  content, narrow width, and the light, dark and tinted palettes.
- **Tests.** Unit or component tests cover what it does. Token changes are
  covered by the generator's check.
- **Guide entry.** The guide says what it is, with one line "Use it when" and
  one line "Do not use it when", the table of its options, and the ids of its
  stories.

### The native kit is catching up

The native kit is being brought in line with the web kit. Until it has caught
up, a system piece lands on the web first, and the pull request links a
tracked follow-up (an issue) for the native side. The follow-up is part of the
work, not an extra. The piece is not "done" for the guide until both exist,
and the guide entry says which client has it.

## Who decides what

|Change|Who decides|How|
|---|---|---|
|A token value|Whoever needs it|Judged in normal review|
|A variant of a component|Whoever needs it|Judged in normal review|
|A small component|Whoever needs it|Judged in normal review|
|A new layout template|The project owner|A mock-up or a short note first|
|A new principle|The project owner|A mock-up or a short note first|
|A change to existing behaviour|The project owner|A mock-up or a short note first|

When the project owner decides, stop and ask. Do not build the layout, the
principle or the behaviour change and hope it is accepted. A short note that
says what is missing, what you tried, and what you propose is enough.

## The pull request description

Every pull request that touches the system has a section called "Design system
changes". It says:

- what was added or changed (the token, component, variant, behaviour or
  template), in both clients, and
- why the existing pieces did not fit, naming the ones you tried.

If the pull request adds nothing to the system, write "Design system changes:
none".

## The way out for a real one-off

Sometimes a screen needs something that really is used once and does not
belong in the system. The way out is a comment on that line:

```ts
// design-exception: the legacy import wizard needs the old 3-column grid
```

The comment names the reason. A check collects every such comment into
[the exceptions list](exceptions.md), so they stay visible. An exception is not
a permanent home. It either joins the system (follow the four steps) or is
removed. Do not use it to skip a step you could take: needing a token that is
not there is the normal path, not an exception.

## Worked example: add a token value

You need a bigger gap between two groups of items, and the space scale stops
at 48.

1. Look first. `xl` (24), `2xl` (32) and `3xl` (48) do not fit, and a screen
   must not use a pixel number.
2. Name the kind: a token value.
3. Edit `design/tokens.json` and add the entry to the `space` group, in order.
4. Run the generator:

   ```bash
   python3 design/gen/gen_tokens.py
   ```

5. Commit the source and every file it regenerated together. CI runs
   `python3 design/gen/gen_tokens.py --check` and fails if a generated file is
   stale.
6. Add the row to the table in [Tokens and colour](tokens-and-colour.md): the
   token, the pixels, and what to use it for.
7. Use the token on the screen by name. In the pull request, describe it under
   "Design system changes".

## Worked example: add a variant to a component

A Button needs a variant for an action that is quiet but must still read as
"main" in a toolbar.

1. Look first. Try `soft`, `ghost` and `primary`. If one of them fits, use it.
2. Name the kind: a variant.
3. Decide the colour roles it uses. Use only roles from
   [Tokens and colour](tokens-and-colour.md). If it needs a role that does not
   exist, that is a token value first.
4. Add the variant to the web Button in `frontend/src/kit`, and to the native
   Button, or open the follow-up issue for native (see above).
5. Add the variant to the Button stories in every palette and every state.
6. Add tests for what it does: that it renders, that it keeps its label, that
   loading ignores clicks.
7. Update the Button entry in [Components](components.md): the variant in the
   table, and one line in "Which variant" saying when to use it and when not.
8. Use it on the screen. List it under "Design system changes".
