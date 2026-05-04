---
id: sheet.save.indicator
title: Header save indicator shows in-flight and recent-success states
category: save
status: draft
related:
  - sheet.save.auto-debounce
  - sheet.save.flush-on-commit
---

## Trigger

- A save request starts, succeeds, or fails.

## Effect

- **Save in flight:** show "Saving…" (or equivalent localisation)
  in a muted colour.
- **Save succeeded:** show "✓ Saved" (or equivalent) in the success
  colour for ~1.5 seconds, then hide.
- **Save failed:** implementation-defined. At minimum, surface the
  error somewhere the user can see; do not silently discard.
- **Idle (no dirty cells, no recent save):** hide the indicator
  entirely.

## Edge cases

- **Rapid save cycles:** the indicator may only flash briefly;
  avoid a jarring flicker. A minimum display time of ~300ms for
  "Saving…" is a reasonable refinement.
- **Remote-origin changes:** do not trigger the indicator (they
  were not saved from this client).

## Visual feedback

- Small text in the app header area; not a toast or modal.

## Rationale

Users need quiet confirmation that auto-save is working — without
that reassurance, they habitually Cmd+S which is a no-op here.
