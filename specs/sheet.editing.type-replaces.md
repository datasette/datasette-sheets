---
id: sheet.editing.type-replaces
title: Typing a printable character replaces cell contents
category: editing
status: draft
related:
  - sheet.editing.double-click
  - sheet.editing.f2-or-enter
---

## Trigger

- A printable character is typed on a focused cell that is not in
  edit mode.
- Platform-neutral "printable" set: at minimum letters, digits, `=`.
  Implementations may extend the set (punctuation, space, `-`, `+`,
  `.`) but must not include modifier-only or control keystrokes.

## Effect

1. Enter edit mode.
2. Initialise the input with just the typed character — **do not**
   load the cell's current raw value.
3. Place the caret after that character.

This produces a "type to overwrite" experience: one keypress replaces
whatever was in the cell.

## Edge cases

- **With Cmd / Ctrl / Alt / Meta modifiers:** never triggers this
  path — those are reserved for shortcuts.
- **Cell already in edit mode:** fall through to normal text input;
  do not reset.
- **IME composition / dead keys:** wait for the composed character
  before firing. Do not open the editor on a raw keydown.
- **Multi-cell selection:** edit mode opens on the active cell only.

## Visual feedback

- Same as any other edit-mode entry — the cell becomes an input with
  the typed character shown.

## Rationale

Matches Excel / Google Sheets. Users routinely expect "click a cell,
just start typing" without pressing F2 first.
