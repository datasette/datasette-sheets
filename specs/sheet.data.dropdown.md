---
id: sheet.data.dropdown
title: Cells can be formatted as a dropdown chip with a workbook-scoped option list
category: data
related:
  - sheet.format.checkbox
  - sheet.format.menu
  - sheet.format.clear
---

## Trigger

- Format menu → Dropdown… opens the rule editor side panel. Saving
  applies `format.controlType = "dropdown"` + `dropdownRuleId` to
  every target cell (selection if any, else the active cell) and
  closes the panel.
- Click on the rendered chip / caret on a dropdown cell opens the
  popover.
- `Enter` on a focused dropdown cell opens the popover (replaces
  the default "start text edit" behavior; `F2` is still the escape
  hatch into the raw text editor).
- `Space` on a focused dropdown cell opens the popover, except when
  the active cell or selection contains a checkbox cell — then
  `Space` toggles those (checkbox precedence; the popover is a
  single-cell-focused interaction, not a batch op).
- Selecting an option in the popover writes the value into the
  cell.
- "Edit dropdown…" in the popover, or right-click → "Edit
  dropdown…" on the cell, opens the rule editor side panel for
  the cell's rule (no auto-apply on save — the rule is already
  applied).

## Effect

- The cell's text rendering is replaced by one or more colored chip
  pills (background = the option's color), followed by a small
  caret. Multi-select cells render one chip per selected value.
- Single-select cells write the chosen option's `value` directly
  into `raw_value`. Multi-select cells join selected values with
  `,` (e.g. `"In progress,Blocked"`). Whitespace around commas is
  ignored on read; empty segments are dropped.
- The rule itself is workbook-scoped — every cell across every
  sheet of the workbook that points at the same `dropdownRuleId`
  reflects edits to the rule's options (color changes, value
  renames) without needing per-cell migration.
- **Strict mode (v1):** values not in the rule's option list are
  rejected server-side at write time. The whole batch fails so
  partial saves can't leave the sheet inconsistent with the rule.
- The rule editor is a side panel: name (optional), an "Allow
  multiple selections" checkbox, and an editable list of options
  (each row = color swatch + value text + delete). Saving creates
  the rule and (for create flow) auto-applies it to the current
  selection.

## Edge cases

- **Pre-existing data:** applying the format to a cell whose
  `raw_value` isn't in the option list renders a muted "invalid"
  chip (red border, error color) so the user can see and clear the
  bad data. `raw_value` is **not** auto-fixed; the user must pick a
  valid option (or clear) via the popover.
- **Spill members:** a dropdown-formatted cell that becomes a spill
  member ignores the open click (would error `#SPILL!`). The chip
  still reflects the spilled value visually.
- **Rule deleted:** cells whose `dropdownRuleId` references a
  deleted rule fall through to the plain text branch (chip render
  fails the rule lookup) until the user changes the format. The
  stale id stays on the cell until next write, harmlessly.
- **Comma in option values:** rejected at rule create / update time
  in both the editor (inline error) and the API (400 with the
  offending value). Comma is reserved for multi-select join; we
  picked rejection over escaping to avoid maintaining an escape
  grammar across the engine, popover, and clipboard.
- **Clipboard:** intra-app copy/paste round-trips both
  `controlType` and `dropdownRuleId` via the
  `data-sheets-control-type` + `data-sheets-dropdown-rule-id`
  attributes on the `<td>`. Cross-workbook intra-app paste keeps
  the `controlType` but the rule id won't resolve in the
  destination workbook's namespace, so the cell renders as
  "invalid" until a fresh rule is applied. External apps see the
  plain value text, no chip.
- **Clear formatting** (`Cmd+\` or Format → Clear formatting)
  drops both `controlType` and `dropdownRuleId` so the cell
  reverts to plain text.
- **Backspace / Delete** is two-step on a dropdown cell: first
  press clears the cell's `raw_value` (chip becomes the empty
  state); second press (when already empty) drops the dropdown
  format itself so the cell reverts to plain text. Per-cell — a
  multi-selection with both filled and empty dropdown cells does
  both in one keystroke. Non-dropdown cells in the selection get
  the standard one-step clear.
- **Edit mode (F2 / type-to-replace)** drops back to the plain
  text input. Saving anything other than a valid option fails the
  server-side validator.

## Visual feedback

- Chip pill: ~12px text, 8px horizontal padding, 9999px border
  radius, background = option color, dark text.
- Caret: subtle `▾` aligned to the right of the chip cluster, lifts
  to full opacity on hover.
- Invalid chip: muted grey background, red border (dashed), red
  text — visually distinct from a valid chip without being
  alarming.
- Popover: portal-mounted (`position: fixed`) anchored under the
  cell so the cell's `overflow: hidden` doesn't clip it. Each row
  shows the chip in the center; multi mode adds a leading checkmark
  slot. Highlight follows the keyboard cursor; click anywhere on a
  row picks.

## Rationale

Matches Google Sheets and Excel "Data validation → Dropdown". The
rule lives at the workbook level (not per-cell, not per-sheet) so
the same set of options can apply to many ranges across many
sheets, and editing the options once propagates everywhere — the
same model as Google Sheets' "Apply to range" rules. The rule is
modelled as a separate table with cells holding only the id (a
ULID) so the cell wire format stays compact and the relationship
is explicit.

The control is layered on the existing `format.controlType`
dispatch surface (alongside `checkbox`) so the cell-render branch
is one new `{:else if isDropdown}` and the popover plugs into the
same single-popover-at-a-time model as the autocomplete /
signature-help popups.

`source.kind` wraps the option list so v2's "from a range" mode
slots in without renaming the field. Strict mode is the only
validation mode in v1 — "warn but allow" needs a `strict` flag we
haven't added yet.
