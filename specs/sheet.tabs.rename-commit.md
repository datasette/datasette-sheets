---
id: sheet.tabs.rename-commit
title: Commit or cancel a tab rename
category: tabs
status: draft
related:
  - sheet.tabs.double-click-rename
---

## Trigger

- A tab is in rename mode, and one of:
  - Enter key → commit
  - Blur → commit
  - Escape key → cancel
  - Input becomes empty-trimmed + commit → cancel (no API call)

## Effect

- **Commit:** trim the input value; if non-empty, persist the new
  name and update the tab label. Exit rename mode.
- **Cancel:** exit rename mode without saving; label reverts to the
  prior name.
- **Empty-trimmed commit:** treated as cancel — do not allow empty
  tab names.

## Edge cases

- **Commit fails (network / permission):** surface an error and
  revert the label. Do not keep the tab in rename mode.
- **Rename matches current name:** still exits rename mode; no
  persistence call.

## Visual feedback

- Input disappears; label text re-renders.

## Rationale

Minimal, bounded rename flow. Blur = commit is required so clicking
elsewhere doesn't silently discard a half-typed rename.
