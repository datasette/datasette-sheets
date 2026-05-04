---
id: sheet.tabs.url-hash-remembers
title: Active sheet is mirrored in the URL hash so refresh restores it
category: tabs
status: draft
related:
  - sheet.tabs.click-switch
---

## Trigger

- Any change to the active sheet — click a tab, add a sheet,
  delete the active sheet, accept a shared link that embeds the
  sheet id in its hash.

## Effect

1. On every active-sheet change, the URL hash is rewritten to
   `#sheet=<sheet-id>` via `history.replaceState` (no new history
   entry). Existing hash keys are preserved — only the `sheet`
   parameter is set.
2. On page load, the hash is consulted before picking a default
   active sheet:
   - If `#sheet=<id>` names a sheet in the current workbook, that
     sheet is activated.
   - Otherwise the first sheet in the list wins (existing default).
3. On `hashchange` (Back/Forward, manual edit, a shared link opened
   in the same tab):
   - If the new `#sheet=<id>` names a known sheet that isn't the
     current active, switch to it — same code path as clicking the
     tab, so cells load, clipboard mark clears, SSE reconnects.
   - If the id is unknown or already active, ignore.

## Edge cases

- **Empty / malformed hash:** no-op — fall back to the first sheet
  on load; leave the hash alone on switch (we'd overwrite with a
  single key anyway).
- **Hash names a deleted sheet:** treated as empty. User sees the
  first sheet; the hash is overwritten with the real active id on
  the next tab change.
- **Sheet deleted while active:** the auto-promotion to the next
  surviving sheet (see `sheet.tabs.delete`) flows through the
  subscribe and updates the hash.
- **Multiple tabs open on the same workbook:** each tab owns its
  own hash. No cross-tab contention.

## Visual feedback

- None beyond the address bar.

## Rationale

The most common "bug" you hit in any multi-sheet workbook is
refreshing and landing back on Sheet 1. Mirroring into the hash
costs one `replaceState` per switch and lets sheet ids survive
refresh, browser restore, and link-sharing. Using
`history.replaceState` keeps the Back button tied to the workbook,
not to tab hops.
