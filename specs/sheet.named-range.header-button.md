---
id: sheet.named-range.header-button
title: "\"Named ranges\" button in the workbook header"
category: named-range
status: draft
related:
  - sheet.named-range.panel
---

## Trigger

- Click the **Named ranges** button in the workbook header strip.

## Effect

- Open the Named Ranges side panel (see `sheet.named-range.panel`).
- The editor starts collapsed; the user sees the list of existing
  names and a "+ Add a range" button.

## Edge cases

- **Panel already open**: the button is a no-op (the panel stays
  open with its current editor state).

## Rationale

A persistent entry point in the header keeps the panel discoverable
even when there's no selection to right-click on. Mirrors Google
Sheets' **Data → Named ranges** placement.
