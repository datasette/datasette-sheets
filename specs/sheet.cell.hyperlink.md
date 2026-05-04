---
id: sheet.cell.hyperlink
title: Cells whose value is an http(s) URL expose an "open in new tab" link
category: cell
status: draft
---

## Trigger

- A cell's displayed value is a string that parses cleanly as an
  http(s) URL with no surrounding whitespace or stray text. Valid
  examples: `https://example.com`, `http://localhost:8001/x?q=1`.
  Invalid: `visit https://example.com`, `example.com` (no scheme),
  `javascript:alert(1)`, `ftp://…`.

## Effect

1. The cell renders normally (the URL text, numeric / bold
   formatting intact). A small muted `↗` icon appears on the right
   edge of the cell while idle — at ~55% opacity so it doesn't
   compete with the text.
2. Hovering the cell (or having it selected) brings the icon to
   full opacity and underlines it.
3. Clicking the icon opens the URL in a new browser tab
   (`target="_blank" rel="noopener noreferrer"`). Click and
   mousedown on the icon are `stopPropagation`'d so they don't also
   move the cell selection / enter drag-select mode.
4. Clicking anywhere else on the cell behaves exactly as a normal
   cell click: selection, right-click menu, double-click to edit.

## Edge cases

- **Cell is in edit mode:** icon is not rendered — the user is
  typing, not reading. Link reappears on commit.
- **Formula that evaluates to a URL string** (e.g. `="https://"&A1`):
  icon appears. The detection runs on the *displayed* value.
- **Value with trailing whitespace or text** (`"https://x.com "`,
  `"see https://x.com"`): no icon. We only link when the whole
  cell *is* the URL.
- **URL with an unusual but valid scheme** (`file://…`,
  `mailto:…`): no icon today. Explicit http/https allow-list —
  we'd rather miss a real link than surface a
  `javascript:` or credential-bearing `file:` URL to a one-click
  external navigation.
- **Very long URLs:** the text is already truncated by
  `text-overflow: ellipsis`; the icon stays pinned to the right
  edge.

## Visual feedback

- Icon is the `↗` glyph, coloured with the existing accent / numeric
  colour so it reads as "interactive" without needing a new palette
  entry.
- `pointer-events` remain enabled on the icon only; the surrounding
  cell surface still handles selection.

## Rationale

The most common "URL in a spreadsheet" pattern in real sheets is a
reference column — dataset links, issue links, dashboard URLs. Plain
text doesn't cross the keyboard-inaccessible, right-click-`Copy link
address`-inaccessible gap between "I see a URL" and "I can open a
URL". A dedicated `↗` affordance makes the one-click path explicit
without stealing the cell's click handler (which still has to route
selection + editing).
