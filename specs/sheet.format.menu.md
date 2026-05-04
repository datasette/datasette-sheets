---
id: sheet.format.menu
title: Format menu in the workbook header
category: format
status: draft
related:
  - sheet.format.toolbar-layout
  - sheet.format.clear
---

## Trigger

- Click the "Format" button in the workbook header.

## Effect

- Opens a popover with submenus:
  - **Number ▸** — Automatic / Number / Percent / Scientific /
    Currency / Date / Time / Date time
  - **Text ▸** — Bold / Italic / Underline / Strikethrough
  - **Alignment ▸** — Left / Center / Right (horizontal) and Top /
    Middle / Bottom (vertical)
  - **Wrapping ▸** — Overflow / Wrap / Clip
  - **Borders ▸** — All / Top / Bottom / Clear
  - **Clear formatting** (divider above)
- Each leaf item applies the corresponding format to the selection
  via `applyFormat` / `clearAllFormat` in `formatCommands.ts` — the
  same code path the toolbar buttons use.
- Outside-click or Escape closes the popover.

## Edge cases

- **No selection:** leaf items still run, but the underlying command
  no-ops (same as the toolbar).
- **Submenu navigation:** hovering a top-level row opens its
  submenu; clicking toggles it. Arrow-key submenu traversal is
  nice-to-have and not in v1.
- **Border presets:** the menu offers only quick presets (all, top,
  bottom, clear) — finer-grained styles / colors live in the
  toolbar's `BorderPicker`.

## Visual feedback

- Button sits flat in the header strip, with hover + active states.
- Submenu opens to the right of the parent popover and overlaps the
  trigger row.

## Rationale

Discoverability: a menu bar is where Google Sheets users expect to
find Format. Keeps the toolbar focused on the 80% of common
operations while the menu surfaces the full set. Both dispatch
identical commands, so there's no "toolbar does X but menu does Y"
drift to worry about.
