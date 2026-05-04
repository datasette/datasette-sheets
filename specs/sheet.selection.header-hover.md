---
id: sheet.selection.header-hover
title: Header highlights on pointer hover
category: selection
status: draft
---

## Trigger

- Pointer enters a column or row header that is not currently
  selected.

## Effect

- The header gains a subtle hover background.
- No selection state changes. No focus change.

## Edge cases

- **Header is already selected:** no hover effect (the selected
  style takes precedence).
- **Touch or non-pointer input:** no hover state — this affordance
  is pointer-only.

## Visual feedback

- Background transitions from the default header fill to the "active
  header" fill (slightly darker). The pointer cursor switches to the
  "pointer" / click indicator.

## Rationale

Signals that the header is interactive before the user clicks.
