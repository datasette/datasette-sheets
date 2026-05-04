---
id: sheet.debug.mode
title: Debug mode — keylog + range-annotated clipboard
category: debug
status: draft
related:
  - sheet.clipboard.copy
  - sheet.clipboard.cut
---

## Trigger

- User toggles debug mode from a small affordance in the sheet
  header (icon, checkbox, etc.).
- The toggle is persistent across sessions.

## Effect

While debug mode is **off**, the app behaves normally. No
observable overhead.

While debug mode is **on**, two new behaviours activate:

### Key log

- Every document-level `keydown` (outside of text editors where the
  native handler takes precedence) appends an entry to an in-memory
  ring buffer, bounded at ~200 events.
- Each entry captures, **at the time the key was pressed**:
  - timestamp (relative to the first event in the buffer)
  - the key value + modifier set (Shift / Ctrl / Meta / Alt)
  - active cell, selection size, selection range name (e.g.
    `"A2:B5"`)
  - editing cell (if any)
  - clipboard mode + clipboard range name
- Modifier-only presses (Shift alone, Meta alone, etc.) are **not**
  logged — they're noisy and carry no state transition.
- The debug widget displays the current count; users can **copy**
  the log to the OS clipboard as a fixed-width text block suitable
  for pasting to an agent / bug report, or **clear** it.

### Clipboard annotation

- On copy or cut, the plaintext half of the clipboard payload gets
  a leading comment identifying the source range, e.g.:

  ```
  # datasette-sheets: from A2:B5
  one<TAB>two
  three<TAB>four
  ```

- The rich (HTML / attributed-string) payload is unchanged —
  tables still paste cleanly into docs, email, other spreadsheets.
- When debug mode is **off**, no comment is prepended.

## Edge cases

- **localStorage (or equivalent) fails to persist the flag:** fall
  back to in-memory only; the toggle still works within the
  session.
- **200-event buffer fills up:** oldest entries drop off the front;
  log never grows unbounded.
- **Paste back into the grid** with the annotation prefix present:
  the comment ends up in the first pasted cell. Acceptable — debug
  mode is an opt-in diagnostic; users aware of the prefix can
  strip it, or turn debug off before round-tripping.
- **Platforms without a visible header:** debug widget lives
  elsewhere (menu bar, settings panel) but behaviour is identical.

## Visual feedback

- The toggle is clearly marked (an icon + count) when on; discreet
  (faint) when off so it doesn't dominate the header.
- The "copy" button briefly confirms success (e.g. "copied") after
  writing to the OS clipboard.

## Rationale

Users reporting UX bugs — especially sequence-of-key bugs like
"Cmd+Shift+Down then arrow went the wrong way" — benefit from
handing the agent a deterministic record instead of re-describing
the gesture. The clipboard annotation closes the same loop for
"what was in the range I just pasted" questions. Both are cheap
when off and don't need any backend involvement.
