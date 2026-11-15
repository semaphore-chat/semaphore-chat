# Writing

The words on a screen are part of the design. This chapter says how they
should read. The short version: plain, friendly, short, and about the person,
not about the system.

## Voice

- **Plain.** Use the word a friend would use. "Leave room", not "Terminate
  session".
- **Friendly.** Warm, calm and direct. Never cute, never stern.
- **Short.** One idea per line. Cut any word that does not help.
- **About the person.** Talk to them ("You can invite people here"), not about
  the system ("The invite functionality is available").
- **No blame.** Say what happened, not what they did wrong. "That name is
  taken", not "You entered an invalid name".
- **No exclamation marks.** Not even for good news.
- **No emoji in interface copy.** Not in labels, messages or empty states.
  (People may type emoji in messages. That is their words, not ours.)

## Sentence case everywhere

Capitalise the first word and proper names, and nothing else. This applies to
headings, buttons, tabs, menu items, table headers, tags and tooltips.

- "Create channel", not "Create Channel".
- "Voice rooms", not "VOICE ROOMS" and not "Voice Rooms".

Never use uppercase styling to make a label look like a heading. Use a text
style (see [Tokens and colour](tokens-and-colour.md)).

## Button labels are verbs

A button says what will happen, in a verb and, where it helps, the thing it
acts on.

- "Leave room", "Delete channel", "Send invite", "Save changes".
- Never "OK", "Yes", "No", "Submit" or "Confirm" on their own. They do not say
  what will happen.
- The safe choice in a pair is "Cancel". The other one is the verb.
- A busy button keeps its label. Do not swap it for "Loading...". The button
  already shows that it is busy.

## Confirm a destructive action by naming what is lost

A dialog that asks for a destructive action names the thing and what goes with
it, in the title or the description.

- Title: "Delete #general?"
- Description: "This removes 214 messages for everyone. You cannot undo it."
- Buttons: "Cancel" and "Delete channel".

A bare "Are you sure?" is not enough. See Dialog in
[Components](components.md) for where the safe action goes.

## Errors say what happened, then what to do

Write the error in two parts: what happened, and what the person can do next.
Use the same shape every time: "Couldn't load channels. Try again."

- Start with the fact. "Couldn't upload photo.", "That invite has expired."
- End with a next step, when there is one. "Try again.", "Ask for a new one."
- Do not show codes, stack traces or the word "error" on its own. Do not say
  "Something went wrong" when you know what did.
- Do not blame: "That file is too big. The limit is 25 MB.", not "You chose a
  file that is too big."

## Empty states say what will appear and how to start

An empty list says what will show up here, and gives the first step.

- "No voice rooms yet. Create one to talk with your community."
- Put a button under it when there is an action: "Create voice room".
- Do not leave a blank panel, and do not write "Nothing here".

## Counts, plurals and numbers

- Write the number and the right word: "1 member", "2 members", "0 members".
  Never "member(s)".
- Use numerals, not words: "3 unread", not "three unread".
- Above 99, a count badge shows "99+".
- Use a thousands separator in text: "1,204 messages".
- Sizes keep a space before the unit: "25 MB".

## Times

- Show the time of day in the person's own format, such as "8:24 PM" or
  "20:24". Do not force one.
- Recent things read as "just now", "5 minutes ago", "2h ago". Older ones show
  the date.
- Say "Seen 2h ago", not "Last seen: 2 hours ago".
- Never show a time zone name unless the person is comparing zones.

## Accessible names

Every control has a name that a screen reader speaks. A control that has only
an icon gets its name from its `label`. A control that shows a picture and a
state puts the facts in the name, in this order, joined by commas:

**name, state, count**

- Avatar: "Ana Ruiz, away".
- DockItem: "Couch Co-op, current, 3 unread, reconnecting". Each part is
  there only when it applies.

The name is plain words, in sentence case, with no emoji and no symbols. Do
not repeat the role in the name: the page already says it is a button, so write
"Mute", not "Mute button". See Avatar and DockItem in
[Components](components.md).

## Before and after

|Where|Before|After|Why|
|---|---|---|---|
|Confirm a deletion|"Are you sure?" with OK and Cancel|"Delete #general?" with "Cancel" and "Delete channel"|Names what is lost and what the button does|
|Leaving a voice room|"Disconnect"|"Leave room"|Plain verb, the word people use|
|Loading channels failed|"Error 500"|"Couldn't load channels. Try again."|What happened, then what to do|
|Empty voice rooms list|"Nothing here"|"No voice rooms yet. Create one to talk with your community."|Says what will appear and how to start|
|Invite expired|"Invalid invite code"|"That invite has expired. Ask for a new one."|Says what happened, with a next step, no blame|
|Upload too large|"You selected a file that is too large"|"That file is too big. The limit is 25 MB."|No blame, gives the limit|
|Button after an upload|"Submit"|"Save photo"|A verb that says what will happen|
|Section heading|"VOICE ROOMS"|"Voice rooms"|Sentence case, no uppercase labels|
|Member count|"1 member(s)"|"1 member"|The right plural|
|Community invite sent|"Invite sent successfully!"|"Invite sent"|No exclamation mark, no filler|
|Upload in progress|Button text "Loading..."|Button "Upload file", busy|The label stays, the button shows it is busy|
|Unread count on a community|"Couch Co-op (3)"|"Couch Co-op, 3 unread"|A reader hears what the number means|
