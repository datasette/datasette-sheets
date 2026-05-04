# Sheet Interaction Specs

Platform-agnostic rules describing the UI/UX behaviors of a spreadsheet
app. Each rule has a stable ID (e.g. `sheet.clipboard.copy`). The same
ID can be implemented by a JS/Svelte web UI, a Swift/AppKit native
app, a Rust TUI, a Tauri hybrid — anything — and each implementation
tags its call sites with the rule ID so the spec and code can be
cross-referenced by grep or by agents.

Source-of-truth for cross-platform spreadsheet UX that feels the same
everywhere. Not a style guide. Not API docs. Behavior only.

## Scope

These specs describe *what the user sees and does*, not how it's
implemented. Keep the body of every spec free of platform-specific
concepts: no DOM, no Svelte stores, no NSView, no termios. Talk in
terms of **cells**, **selection**, **focus**, **modifier keys**,
**events**, and **visual feedback**.

Implementation notes (if a spec has a quirk that only applies to a
specific platform) belong in a dedicated `## Notes` section at the
bottom, clearly labelled per platform.

## ID format

`sheet.<category>.<slug>` — dotted, lowercase, kebab-cased slug.

| Category        | Examples                                                |
| --------------- | ------------------------------------------------------- |
| `selection`     | `sheet.selection.shift-click`                           |
| `navigation`    | `sheet.navigation.arrow-jump`                           |
| `editing`       | `sheet.editing.type-replaces`                           |
| `clipboard`     | `sheet.clipboard.copy`                                  |
| `delete`        | `sheet.delete.row-confirm`                              |
| `column` / `row`| `sheet.column.resize-drag`, `sheet.row.header-click`    |
| `format`        | `sheet.format.bold-toggle`                              |
| `undo`          | `sheet.undo.cmd-z`                                      |
| `tabs`          | `sheet.tabs.rename-commit`                              |
| `formula-bar`   | `sheet.formula-bar.live-sync`                           |
| `presence`      | `sheet.presence.remote-cursor`                          |
| `view`          | `sheet.view.border`                                     |
| `scrolling`     | `sheet.scrolling.sticky-col-headers`                    |
| `save`          | `sheet.save.auto-debounce`                              |
| `workbook`      | `sheet.workbook.rename`                                 |
| `status-bar`    | `sheet.status-bar.numeric-stats`                        |
| `debug`         | `sheet.debug.mode`                                      |

Filename must match the ID exactly, with `.md` appended:
`sheet.clipboard.copy.md`.

## Spec file format

YAML frontmatter, then fixed body sections:

```markdown
---
id: sheet.clipboard.copy
title: Copy selection to clipboard
category: clipboard
status: draft    # draft | stable | deprecated
related:
  - sheet.clipboard.cut
  - sheet.clipboard.paste
---

## Trigger

(What input(s) fire the behavior — keys, mouse actions, preconditions.)

## Effect

(The observable result, in platform-neutral UX terms. Numbered steps
if there's an order.)

## Edge cases

(Boundaries, empty selections, focus in other widgets, grid edges, etc.)

## Visual feedback

(What the user sees. Refer to abstract tokens — "accent colour",
"selection highlight" — not hex codes.)

## Rationale

(Why this behavior. Cite precedents — "matches Google Sheets", "matches
Excel" — when relevant.)

## Notes

(Optional. Per-platform quirks or open questions. Label each block:
**JS/Svelte:** …, **Swift:** …, **TUI:** …)
```

Keep each spec under ~1 page when rendered. If it grows longer, it
probably needs to be split.

## Tagging source code

Above the block that implements the spec, add a one-line comment:

```js
// [sheet.clipboard.copy]
function handleCopy(e) { ... }
```

```swift
// [sheet.clipboard.copy]
func handleCopy() { ... }
```

```rust
// [sheet.clipboard.copy]
fn handle_copy(&mut self) { ... }
```

Rules:

- Use exactly one line, no extra text: `// [sheet.clipboard.copy]`.
- Place it immediately above the function, block, or branch that the
  spec covers. If a spec is implemented across two call sites, tag
  both.
- For multi-spec call sites (e.g. a keydown handler dispatching to
  several specs), tag each branch with the specific ID rather than
  the whole handler.
- `grep -R '\[sheet\.' src/` finds every tagged site.

## Workflow

1. Identify the behavior. Give it a draft ID.
2. Write the spec file (frontmatter + five required sections).
3. Add its one-liner to `INDEX.md`.
4. Tag every implementation site with `// [id]`.
5. Mark status `stable` once at least two platforms implement it.

## Extraction plan

These specs currently live inside `datasette-sheets` as the first
concrete consumer. Once the set stabilises (status: `stable` majority),
extract `specs/` to a standalone `sheet-specs` repository and vendor
it back into each implementation as a submodule or git subtree. Until
then, keep specs platform-neutral so the eventual extraction is a
`git mv`, not a rewrite.
