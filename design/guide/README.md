# Semaphore Chat design guide

This guide tells you how to design a new screen that fits the app. You do
not need to know the code. You do need to use the same colours, sizes and
shapes as the rest of the app, so that a new screen looks like it was always
there.

The guide is written in chapters. Only one chapter exists so far.

|Chapter|What it covers|Status|
|---|---|---|
|Principles|The ideas behind the look of the app|not written yet|
|Layouts|The page layouts a screen can use|not written yet|
|Behaviour|How things move, respond and change state|not written yet|
|[Components](components.md)|The building blocks: buttons, fields, cards and so on|written (33 components)|
|[Tokens and colour](tokens-and-colour.md)|Every size, shape, type style, timing and colour role, and when to use each|written|
|Writing|How the words on a screen should read|not written yet|
|Extending the system|How to add something the guide does not cover|not written yet|

## Three rules

1. **Nothing off-system on a screen.** Every colour, size, radius, type style
   and timing comes from the guide. If you need something that is not there,
   do not make it up. Ask for it to be added to the system first.
2. **Every screen names its layout template.** A screen says which layout it
   uses. It does not invent its own. (The Layouts chapter is not written yet.)
3. **Examples are the live stories.** The examples to copy are the working
   stories in the code (`frontend/src/stories/`), not pictures in a document.
   A picture goes out of date. A story is built from the real code.

## Loading is not disabled

A control that is busy stays focusable and reachable by keyboard. It exposes
`aria-busy` and `aria-disabled`, and it ignores activation: clicking it or
pressing Enter does not fire its action. Only `disabled` takes a control out
of the tab order.
