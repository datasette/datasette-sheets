---
id: sheet.tabs.keyboard-switch
title: Cycle sheet tabs with Cmd/Ctrl+Shift+[ and Cmd/Ctrl+Shift+]
category: tabs
status: draft
related:
  - sheet.tabs.click-switch
  - sheet.clipboard.sheet-switch-clears-mark
---

## Trigger

- Cmd+Shift+[ (Mac) / Ctrl+Shift+[ (Windows/Linux): previous sheet.
- Cmd+Shift+] (Mac) / Ctrl+Shift+] (Windows/Linux): next sheet.
- Preconditions: not in cell-edit mode, and no other text input
  (tab-rename field, formula bar) has focus.

## Effect

1. Locate the active tab's index in the tab order.
2. Compute the target tab by moving one step in the requested
   direction, wrapping around at the ends (previous of the first tab
   is the last tab; next of the last tab is the first).
3. Switch to the target tab using the same path as
   `sheet.tabs.click-switch` — flush pending saves, load the target
   sheet, reset selection and undo, clear the clipboard mark.

## Edge cases

- **Only one sheet:** no-op.
- **Edit mode:** ignored — switching would drop the uncommitted
  edit. User must commit or cancel first.
- **Focus inside another input (tab rename, formula bar):**
  ignored, so the shortcut doesn't steal typing from those fields.
- **Wrap-around:** from the first tab, prev goes to the last tab;
  from the last tab, next goes to the first. This matches how most
  desktop apps handle the same chord.

## Visual feedback

- Target tab gains the active-tab style; previously active tab
  reverts to inactive. No transient animation.
- If a clipboard mark was active, its dashed border disappears with
  the sheet switch (see `sheet.clipboard.sheet-switch-clears-mark`).

## Rationale

Keyboard-first users expect a tab-cycling chord. Cmd/Ctrl+Shift+[/]
is the de-facto standard across channel-switching apps (Slack,
Discord) and browser tab-switching, so the muscle memory carries
over. Wrap-around removes the need for the user to track their
position in the tab list.

## Notes

**JS/Svelte:** The handler uses `e.code === "BracketLeft"` /
`"BracketRight"` as the primary check (layout-independent), with
`e.key` fallbacks for `[`, `]`, `{`, `}` to cover browsers that
report the shifted glyph. The browser's own Cmd+Shift+[/] tab-switch
is suppressed via `preventDefault()` when the shortcut fires inside
the sheet.
