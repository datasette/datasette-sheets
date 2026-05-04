---
id: sheet.tabs.add
title: "+ button creates a new sheet and switches to it"
category: tabs
status: draft
related:
  - sheet.tabs.click-switch
  - sheet.tabs.color-picker
---

## Trigger

- Click the `+` button in the tab strip.

## Effect

1. Flush any pending saves on the current sheet.
2. Create a new sheet on the persistence layer:
   - Name: `Sheet N` where N is the current sheet count + 1.
   - Colour: auto-assigned from a preset palette, cycling by sheet
     index.
3. Append the new tab to the end of the tab strip.
4. Switch to the new sheet (same effect as clicking it).

## Edge cases

- **Creation fails:** surface an error; do not switch.
- **Name collision** (`Sheet 2` already exists because a sheet was
  renamed): accept the collision — names are not required to be
  unique. (Future work: make names unique at creation time.)

## Visual feedback

- New tab appears at the right end, slides into active state.
- Tab strip may scroll to make the new tab visible if the strip is
  overflowing.

## Rationale

Standard multi-sheet affordance.
