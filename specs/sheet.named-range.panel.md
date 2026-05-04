---
id: sheet.named-range.panel
title: Named Ranges side panel
category: named-range
status: draft
related:
  - sheet.named-range.save
  - sheet.named-range.delete
  - sheet.named-range.header-button
  - sheet.named-range.define-from-context
---

## Trigger

- Click "Named ranges" in the workbook header (see
  `sheet.named-range.header-button`), or
- Click "Define named range…" in the cell context menu (see
  `sheet.named-range.define-from-context`).

## Effect

- A panel appears anchored to the right edge of the workbook window.
- The panel shows, top to bottom:
  1. A title ("Named ranges") and a close button.
  2. An **editor** with two inputs — **Name** and **Range or value** —
     and Cancel / Save buttons. The editor is shown collapsed behind
     an **+ Add a range** button when no editing is in progress.
  3. A **list** of every named range defined on the active sheet,
     sorted case-insensitively by name. Each row shows the name in
     bold and the definition in monospace; clicking a row loads it
     into the editor. A trailing `×` button deletes the row
     (see `sheet.named-range.delete`).
- Escape closes the editor (if open), otherwise closes the panel.
- `Cmd/Ctrl+Enter` inside the editor triggers Save.

## Edge cases

- **No named ranges yet**: the list shows "No named ranges yet." as
  an empty-state placeholder (hidden while the editor is open).
- **Switching sheets while the panel is open**: the panel stays open
  but the list refreshes for the newly active sheet.
- **Rename**: when the editor's Name field is changed for an existing
  row, Save first deletes the old row under its previous name, then
  creates the row under the new name. Case-only renames skip the
  delete — the storage key is case-insensitive.

## Visual feedback

- The panel uses the workbook's surface colour with a left border and
  a subtle drop shadow so it reads as a layer above the grid.
- The row currently being edited is tinted with the selection colour.

## Rationale

A sidebar (rather than a modal) lets the user see the grid while
they edit a named range, which matters because the definition often
references cells they want to keep in view. Matches Google Sheets'
placement of the same feature.
