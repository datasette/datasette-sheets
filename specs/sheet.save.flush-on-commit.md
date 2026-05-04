---
id: sheet.save.flush-on-commit
title: Explicit commits bypass the debounce and flush immediately
category: save
status: draft
related:
  - sheet.save.auto-debounce
---

## Trigger

- A user action that represents a deliberate "commit now": Enter,
  Tab, or blur from an edit input; sheet switch; window close /
  unload.

## Effect

- Cancel any pending debounced flush and call the save path
  immediately.

## Edge cases

- **Multiple commits in quick succession** (e.g. Tab through several
  cells): each fires an immediate save. The persistence layer must
  be tolerant of back-to-back calls. If saves queue or serialise,
  they must preserve order.
- **Window close:** use the platform's "about to close" hook (e.g.
  `beforeunload` on web) to flush; accept that this isn't reliable
  on all platforms and rely on short debounce as the primary
  mechanism.

## Visual feedback

- Indicator (see `sheet.save.indicator`) transitions through its
  saving / saved states as usual.

## Rationale

Users perceive Enter / Tab as "done editing this cell" and expect
the data to be durable right after. A 150ms delay isn't long, but
a page reload within that window would lose data.
