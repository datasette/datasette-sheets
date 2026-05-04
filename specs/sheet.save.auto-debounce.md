---
id: sheet.save.auto-debounce
title: Dirty cells are flushed to persistence after an idle period
category: save
status: draft
related:
  - sheet.save.flush-on-commit
  - sheet.save.indicator
---

## Trigger

- A cell's raw value or format changes in a way that marks it
  dirty. Column width changes are also covered, with their own
  dirty flag.

## Effect

1. Schedule a flush after a short debounce window (typical: 150ms).
2. If another dirty change arrives within the window, reset the
   timer.
3. When the timer fires, send only the dirty cells (plus any dirty
   column widths) to persistence in one batched call. Empty raw
   values are sent too — they signal deletion server-side.

## Edge cases

- **Remote changes received via real-time channel:** wrap the
  application of the change in a "suppress auto-save" scope so the
  subscriber doesn't echo it back.
- **Save fails:** surface via `sheet.save.indicator`. Retry policy
  is implementation-defined; at minimum, leave the cells dirty so
  the next edit triggers another attempt.
- **Offline / no persistence layer** (demo mode): may disable
  auto-save entirely; tests also skip it by not subscribing.

## Visual feedback

- None directly — see `sheet.save.indicator`.

## Rationale

Per-keystroke saves would saturate the network; per-session manual
saves would lose work. Debounced flush is the compromise every
modern editor uses.
