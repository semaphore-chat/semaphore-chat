# Semaphore Chat design guide

This guide tells you how to design a new screen that fits the app. You do
not need to know the code. You do need to use the same colours, sizes and
shapes as the rest of the app, so that a new screen looks like it was always
there.

The guide is written in chapters.

|Chapter|What it covers|Status|
|---|---|---|
|[Principles](principles.md)|The ideas behind the look of the app, and what we never do|written|
|[Layouts](layouts.md)|The templates a screen is built on, and what each does at phone, tablet and desktop width|written (three templates and the sheet over a screen)|
|[Behaviour](behaviour.md)|How things respond: toasts, overlays and Escape, confirmations, list focus, loading, and what a client must do to follow it|written; the reducers exist in both clients, no screen uses them yet|
|[Components](components.md)|The building blocks: buttons, fields, cards and so on|written (33 components)|
|[Tokens and colour](tokens-and-colour.md)|Every size, shape, type style, timing and colour role, and when to use each|written|
|[Writing](writing.md)|How the words on a screen should read|written|
|[Extending the system](extending.md)|How to add something the guide does not cover|written|

## Start here

**To design a screen,** read [Principles](principles.md) first. Then pick a
template in [Layouts](layouts.md). Then read "How a screen is built" in
[Components](components.md). Then pick the
components you need, one by one, and open their stories. For how a screen
responds (Escape, toasts, confirmations, loading), read [Behaviour](behaviour.md).

**To add something to the system,** read [Extending the system](extending.md)
first. It says what to try before you add anything, and how to add it. The
places where a screen has left the system on purpose are listed in
[Design exceptions](exceptions.md).

## Three rules

1. **Nothing off-system on a screen.** Every colour, size, radius, type style
   and timing comes from the guide. If you need something that is not there,
   do not make it up. Ask for it to be added to the system first.
2. **Every screen names its layout template.** A screen says which layout it
   uses. It does not invent its own. See [Layouts](layouts.md).
3. **Examples are the live stories.** The examples to copy are the working
   stories in the code (`frontend/src/stories/`), not pictures in a document.
   A picture goes out of date. A story is built from the real code.

## Loading is not disabled

A control that is busy stays focusable and reachable by keyboard. It exposes
`aria-busy` and `aria-disabled`, and it ignores activation: clicking it or
pressing Enter does not fire its action. Only `disabled` takes a control out
of the tab order.
