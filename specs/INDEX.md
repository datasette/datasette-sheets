# Index

Every spec, grouped by category. All entries are drafted (status:
draft). Specs marked **CSS-only** are implemented purely as
presentation in the reference (Svelte) implementation and have no
`// [id]` comment anchor in code — other platforms (Swift, TUI, etc.)
may well have a function to tag.

See `README.md` for the spec format and the `// [id]` code-tagging
convention.

## Selection

- [sheet.selection.click](sheet.selection.click.md) — single click solo-selects, moves focus
- [sheet.selection.shift-click](sheet.selection.shift-click.md) — range select from anchor to target
- [sheet.selection.cmd-click](sheet.selection.cmd-click.md) — toggle individual cells in/out of selection
- [sheet.selection.drag](sheet.selection.drag.md) — mousedown + drag paints a rectangle
- [sheet.selection.column-header-click](sheet.selection.column-header-click.md) — click col letter selects full column
- [sheet.selection.column-header-shift-click](sheet.selection.column-header-shift-click.md) — extend to contiguous column range
- [sheet.selection.column-header-drag](sheet.selection.column-header-drag.md) — drag across headers to range-select columns
- [sheet.selection.row-header-click](sheet.selection.row-header-click.md) — click row number selects full row
- [sheet.selection.row-header-shift-click](sheet.selection.row-header-shift-click.md) — extend to contiguous row range
- [sheet.selection.row-header-drag](sheet.selection.row-header-drag.md) — drag across row numbers
- [sheet.selection.header-shift-arrow-extend](sheet.selection.header-shift-arrow-extend.md) — Shift+Arrow extends a header-initiated column/row selection
- [sheet.selection.header-hover](sheet.selection.header-hover.md) — header highlights on mouse hover *(CSS-only)*
- [sheet.selection.header-range-tint](sheet.selection.header-range-tint.md) — headers intersecting a cell range get a soft tint *(CSS-only)*

## Navigation

- [sheet.navigation.arrow](sheet.navigation.arrow.md) — plain Arrow key moves focus one cell, clamps at edge
- [sheet.navigation.arrow-jump](sheet.navigation.arrow-jump.md) — Cmd/Ctrl+Arrow jumps to content boundary or grid edge
- [sheet.navigation.shift-arrow-extend](sheet.navigation.shift-arrow-extend.md) — extends selection one cell without moving anchor
- [sheet.navigation.shift-arrow-jump-extend](sheet.navigation.shift-arrow-jump-extend.md) — extends selection to content boundary
- [sheet.navigation.tab-commit-right](sheet.navigation.tab-commit-right.md) — Tab in edit mode commits and moves right
- [sheet.navigation.tab-nav-move](sheet.navigation.tab-nav-move.md) — Tab in nav mode moves focus one column right (Shift+Tab left)
- [sheet.navigation.enter-commit-down](sheet.navigation.enter-commit-down.md) — Enter in edit mode commits and moves down

## Editing

- [sheet.editing.double-click](sheet.editing.double-click.md) — opens edit mode with raw value, caret at end
- [sheet.editing.f2-or-enter](sheet.editing.f2-or-enter.md) — opens edit mode from focused cell
- [sheet.editing.type-replaces](sheet.editing.type-replaces.md) — printable char on focused cell replaces content
- [sheet.editing.formula-bar](sheet.editing.formula-bar.md) — formula bar mirrors edit value bidirectionally
- [sheet.editing.escape-cancels](sheet.editing.escape-cancels.md) — Escape discards edits, restores cell value
- [sheet.editing.blur-commits](sheet.editing.blur-commits.md) — losing focus commits the current edit
- [sheet.editing.formula-ref-pointing](sheet.editing.formula-ref-pointing.md) — arrows while typing `=…` insert/move cell ref
- [sheet.editing.formula-name-coloring](sheet.editing.formula-name-coloring.md) — named-range tokens render in one fixed colour, distinct from the cell-ref palette
- [sheet.editing.formula-string-coloring](sheet.editing.formula-string-coloring.md) — string literals render in a fixed green; autocomplete is suppressed while the caret is inside one
- ~~[sheet.editing.formula-name-autocomplete](sheet.editing.formula-name-autocomplete.md)~~ *(deprecated — see formula-autocomplete)*
- [sheet.editing.formula-autocomplete](sheet.editing.formula-autocomplete.md) — popup merges functions + named ranges; Enter/Tab completes, functions auto-insert `(`
- [sheet.editing.formula-signature-help](sheet.editing.formula-signature-help.md) — tooltip shows the active function signature while typing arguments

## Clipboard

- [sheet.clipboard.copy](sheet.clipboard.copy.md) — Cmd/Ctrl+C writes selection to OS clipboard, paints mark
- [sheet.clipboard.cut](sheet.clipboard.cut.md) — Cmd/Ctrl+X copies and flips mark to "cut" mode
- [sheet.clipboard.paste](sheet.clipboard.paste.md) — Cmd/Ctrl+V applies clipboard grid at anchor; cut clears source
- [sheet.clipboard.paste-as-values](sheet.clipboard.paste-as-values.md) — Cmd/Ctrl+Shift+V pastes displayed values only; formulas + format are stripped
- [sheet.clipboard.paste-formula-shift](sheet.clipboard.paste-formula-shift.md) — intra-app paste shifts relative formula refs by the source→target delta; absolutes pinned
- [sheet.clipboard.paste-fill-selection](sheet.clipboard.paste-fill-selection.md) — 1×1 source pasted into a multi-cell selection fills every selected cell, shifting formulas per-target
- [sheet.clipboard.escape-cancels-mark](sheet.clipboard.escape-cancels-mark.md) — Escape drops dashed border, preserves OS clipboard
- [sheet.clipboard.sheet-switch-clears-mark](sheet.clipboard.sheet-switch-clears-mark.md) — changing sheets clears the clipboard mark
- [sheet.clipboard.mark-visual](sheet.clipboard.mark-visual.md) — dashed "marching ants" border on marked range

## Delete / clear

- [sheet.delete.delete-key-clears](sheet.delete.delete-key-clears.md) — Delete/Backspace empties cell values, keeps format
- [sheet.delete.row-right-click](sheet.delete.row-right-click.md) — right-click row header opens delete menu
- [sheet.delete.row-confirm](sheet.delete.row-confirm.md) — native confirm before destructive row delete
- [sheet.delete.column-right-click](sheet.delete.column-right-click.md) — right-click column header opens delete menu
- [sheet.delete.column-confirm](sheet.delete.column-confirm.md) — native confirm before destructive column delete
- [sheet.delete.context-menu-dismiss](sheet.delete.context-menu-dismiss.md) — click outside closes menu
- [sheet.delete.refs-rewrite](sheet.delete.refs-rewrite.md) — formulas referencing deleted rows/cols become `#REF!` or shift

## Cell context menu

- [sheet.cell.context-menu](sheet.cell.context-menu.md) — right-click a cell/range opens a menu of contextual actions
- [sheet.cell.cut-from-menu](sheet.cell.cut-from-menu.md) — Cut item: same payload as Cmd/Ctrl+X
- [sheet.cell.copy-from-menu](sheet.cell.copy-from-menu.md) — Copy item: same payload as Cmd/Ctrl+C
- [sheet.cell.paste-from-menu](sheet.cell.paste-from-menu.md) — Paste item: best-effort read from the OS clipboard
- [sheet.cell.copy-reference](sheet.cell.copy-reference.md) — copy the A1 reference string (e.g. `A3:A5`) of the current selection
- [sheet.cell.copy-api-url](sheet.cell.copy-api-url.md) — copy the data-API URL for the current selection
- [sheet.cell.open-api-url](sheet.cell.open-api-url.md) — open the data-API URL for the current selection in a new tab
- [sheet.cell.hyperlink](sheet.cell.hyperlink.md) — cells whose value is an http(s) URL get a corner `↗` icon that opens in a new tab
- [sheet.cell.spill](sheet.cell.spill.md) — array formulas fill adjacent cells; anchors + members render distinctly
- [sheet.cell.pin](sheet.cell.pin.md) — host-injected spill values that the engine treats as a first-class spill
- [sheet.cell.sql-array-formula](sheet.cell.sql-array-formula.md) — `=SQL(…)` runs a Datasette query and spills the result
- [sheet.cell.format-submenu](sheet.cell.format-submenu.md) — right-click menu exposes Bold / Italic / Underline / Clear formatting
- [sheet.cell.boolean](sheet.cell.boolean.md) — boolean computed values render as TRUE/FALSE centered in the accent colour
- [sheet.cell.custom](sheet.cell.custom.md) — engine-typed Custom values (jdate / jtime / jspan + host handlers) render via per-tag display rules
- [sheet.cell.force-text](sheet.cell.force-text.md) — leading apostrophe forces a cell value to render as literal text (Excel/Sheets convention)

## Named ranges

- [sheet.named-range.panel](sheet.named-range.panel.md) — side panel to add / edit / delete named ranges
- [sheet.named-range.header-button](sheet.named-range.header-button.md) — header button opens the panel
- [sheet.named-range.define-from-context](sheet.named-range.define-from-context.md) — context-menu "Define named range…" pre-fills the panel
- [sheet.named-range.save](sheet.named-range.save.md) — save / upsert a name; validation errors surfaced inline
- [sheet.named-range.delete](sheet.named-range.delete.md) — confirm then delete; dependent formulas become `#NAME?`

## Column / row ops

- [sheet.column.resize-drag](sheet.column.resize-drag.md) — drag right edge of header to resize, floor at minimum width
- [sheet.column.auto-fit-double-click](sheet.column.auto-fit-double-click.md) — double-click resize handle fits widest content
- [sheet.column.context-menu](sheet.column.context-menu.md) — right-click column header opens the actions menu (insert, delete)
- [sheet.column.insert-left-right](sheet.column.insert-left-right.md) — insert N blank columns to the left / right of the selected columns
- [sheet.column.drag-reorder](sheet.column.drag-reorder.md) — drag a column header past 4px to reorder; cells + widths + formulas + named ranges + view bounds follow
- [sheet.insert.refs-rewrite](sheet.insert.refs-rewrite.md) — formulas shift outward on insert; straddled ranges grow
- ~~[sheet.column.context-menu-delete-only](sheet.column.context-menu-delete-only.md)~~ *(deprecated — the menu is no longer delete-only; see context-menu + insert-left-right)*
- [sheet.row.context-menu-delete-only](sheet.row.context-menu-delete-only.md) — row context menu currently only offers delete
- [sheet.row.drag-reorder](sheet.row.drag-reorder.md) — drag a row header past 4px to reorder; cells + formulas + named ranges + view bounds follow

## Formatting

- [sheet.format.bold-toggle](sheet.format.bold-toggle.md) — Cmd/Ctrl+B toggles bold on full selection, direction from active cell
- [sheet.format.italic-toggle](sheet.format.italic-toggle.md) — Cmd/Ctrl+I toggles italic on full selection
- [sheet.format.underline-toggle](sheet.format.underline-toggle.md) — Cmd/Ctrl+U toggles underline on full selection
- [sheet.format.strikethrough-toggle](sheet.format.strikethrough-toggle.md) — Cmd/Ctrl+Shift+X toggles strikethrough on full selection
- [sheet.format.currency](sheet.format.currency.md) — toolbar button applies currency format to active cell
- [sheet.format.percentage](sheet.format.percentage.md) — toolbar button applies percentage format to active cell
- [sheet.format.number](sheet.format.number.md) — toolbar button applies number format
- [sheet.format.scientific](sheet.format.scientific.md) — exponential notation (`1.23e+3`)
- [sheet.format.date](sheet.format.date.md) — display-only date formatting
- [sheet.format.time](sheet.format.time.md) — display-only time formatting
- [sheet.format.datetime](sheet.format.datetime.md) — display-only date+time formatting
- [sheet.format.decimal-increase](sheet.format.decimal-increase.md) — `.0→` bumps `decimals` by 1
- [sheet.format.decimal-decrease](sheet.format.decimal-decrease.md) — `.0←` drops `decimals` by 1
- [sheet.format.clear](sheet.format.clear.md) — toolbar button resets format to general
- [sheet.format.text-color](sheet.format.text-color.md) — palette picker sets text color on the selection
- [sheet.format.fill-color](sheet.format.fill-color.md) — palette picker sets cell background color
- [sheet.format.h-align](sheet.format.h-align.md) — explicit horizontal alignment (left/center/right) overrides the numeric auto-rule
- [sheet.format.v-align](sheet.format.v-align.md) — vertical alignment (top/middle/bottom); default middle
- [sheet.format.font-size](sheet.format.font-size.md) — toolbar stepper sets cell font size in points
- [sheet.format.wrap](sheet.format.wrap.md) — three-state wrapping (overflow/wrap/clip); wrap grows row height
- [sheet.format.borders](sheet.format.borders.md) — per-cell borders via preset picker (all/outer/top/right/bottom/left/clear)
- [sheet.format.checkbox](sheet.format.checkbox.md) — `controlType: "checkbox"` renders an interactive glyph; click or Space toggles TRUE/FALSE
- [sheet.format.menu](sheet.format.menu.md) — top-level Format menu in the header with submenus for every format command
- [sheet.format.toolbar-layout](sheet.format.toolbar-layout.md) — rich-bar layout (history, number, font-size, text-styling, colors, borders, alignment, wrap, clear)
- [sheet.format.numeric-align-right](sheet.format.numeric-align-right.md) — numeric cells render right-aligned in accent colour *(CSS-only)*
- [sheet.format.error-color](sheet.format.error-color.md) — `#REF!` / `#DIV/0!` / etc. render in error colour *(CSS-only)*

## Data validation

- [sheet.data.dropdown](sheet.data.dropdown.md) — `controlType: "dropdown"` + `dropdownRuleId` renders a colored chip; click or Enter opens the workbook-scoped option popover; multi-select joins values with `,`; strict-mode rejection server-side

## Undo / redo

- [sheet.undo.cmd-z](sheet.undo.cmd-z.md) — Cmd/Ctrl+Z restores previous cell snapshot
- [sheet.undo.redo](sheet.undo.redo.md) — Cmd+Shift+Z / Cmd+Y / Ctrl+Y replays forward
- [sheet.undo.scope](sheet.undo.scope.md) — which actions push to the undo stack

## Sheet tabs

- [sheet.tabs.click-switch](sheet.tabs.click-switch.md) — click tab to save current and switch
- [sheet.tabs.keyboard-switch](sheet.tabs.keyboard-switch.md) — Cmd/Ctrl+Shift+[/] cycles through sheet tabs with wrap-around
- [sheet.tabs.add](sheet.tabs.add.md) — `+` button creates new sheet, auto-assigns name + colour
- [sheet.tabs.double-click-rename](sheet.tabs.double-click-rename.md) — double-click tab to rename inline
- [sheet.tabs.rename-commit](sheet.tabs.rename-commit.md) — Enter/blur commits, Escape cancels, empty discards
- [sheet.tabs.right-click-menu](sheet.tabs.right-click-menu.md) — right-click opens rename/color/move/delete menu
- [sheet.tabs.drag-reorder](sheet.tabs.drag-reorder.md) — press-and-drag a tab to reorder within the strip
- [sheet.tabs.move-left-right](sheet.tabs.move-left-right.md) — context menu "Move left"/"Move right" to reorder one step
- [sheet.tabs.color-picker](sheet.tabs.color-picker.md) — swatch grid in menu; selected shows ring
- [sheet.tabs.delete](sheet.tabs.delete.md) — confirm then delete; last sheet cannot be deleted
- [sheet.tabs.overflow-scroll](sheet.tabs.overflow-scroll.md) — horizontal scroll when tab count exceeds width *(CSS-only)*
- [sheet.tabs.url-hash-remembers](sheet.tabs.url-hash-remembers.md) — active sheet is mirrored in `#sheet=<id>` so refresh restores it

## Formula bar

- [sheet.formula-bar.label](sheet.formula-bar.label.md) — left box shows active cell id / range / view name
- [sheet.formula-bar.dropdown](sheet.formula-bar.dropdown.md) — label box opens a menu of copy-URL / view actions
- [sheet.formula-bar.live-sync](sheet.formula-bar.live-sync.md) — bar and cell input share edit state bidirectionally

## Presence

- [sheet.presence.remote-cursor](sheet.presence.remote-cursor.md) — other user's active cell gets outline + name badge
- [sheet.presence.remote-selection](sheet.presence.remote-selection.md) — other user's range gets tinted fill
- [sheet.presence.avatar-strip](sheet.presence.avatar-strip.md) — connected users shown as circular avatars in header
- [sheet.presence.connection-dot](sheet.presence.connection-dot.md) — colored dot reflects connection state; pulses when down
- [sheet.presence.expiry](sheet.presence.expiry.md) — presences not refreshed within N seconds disappear
- [sheet.presence.broadcast-debounce](sheet.presence.broadcast-debounce.md) — local cursor moves broadcast at most every 200ms

## Named views

- [sheet.view.border](sheet.view.border.md) — dashed coloured outline traces the view's cell range
- [sheet.view.triangle-indicator](sheet.view.triangle-indicator.md) — top-left cell of view shows a clickable coloured triangle

## Filter

- [sheet.filter.create](sheet.filter.create.md) — turn a selection into the sheet's filter via the cell context menu
- [sheet.filter.delete](sheet.filter.delete.md) — remove the filter via right-click inside the rectangle
- [sheet.filter.border](sheet.filter.border.md) — solid 2px outline traces the filter rectangle
- [sheet.filter.header-bold](sheet.filter.header-bold.md) — first row of the filter renders bold + tinted
- [sheet.filter.column-icon](sheet.filter.column-icon.md) — filter chevron icon in each header cell
- [sheet.filter.column-popover](sheet.filter.column-popover.md) — popover with sort + filter-by-values sections
- [sheet.filter.value-toggle](sheet.filter.value-toggle.md) — filter-by-values checkbox list with OK/Cancel staging
- [sheet.filter.row-hide](sheet.filter.row-hide.md) — predicate-matched rows compress to zero height
- [sheet.filter.auto-expand](sheet.filter.auto-expand.md) — type below the rectangle to extend `max_row`
- [sheet.filter.sort-asc](sheet.filter.sort-asc.md) — Sort A → Z physically reorders the filter's data rows
- [sheet.filter.sort-desc](sheet.filter.sort-desc.md) — Sort Z → A is the descending counterpart
- [sheet.filter.create-view](sheet.filter.create-view.md) — open Create-View dialog from the filter popover with the rectangle pre-filled

## Scrolling

- [sheet.scrolling.sticky-col-headers](sheet.scrolling.sticky-col-headers.md) — column header row pins on vertical scroll *(CSS-only)*
- [sheet.scrolling.sticky-row-headers](sheet.scrolling.sticky-row-headers.md) — row number column pins on horizontal scroll *(CSS-only)*
- [sheet.scrolling.sticky-corner](sheet.scrolling.sticky-corner.md) — top-left corner cell pins above both axes *(CSS-only)*

## Save

- [sheet.save.auto-debounce](sheet.save.auto-debounce.md) — dirty cells flushed after idle period
- [sheet.save.flush-on-commit](sheet.save.flush-on-commit.md) — explicit commits bypass the debounce
- [sheet.save.indicator](sheet.save.indicator.md) — header shows "Saving…" then "✓ Saved" then clears

## Workbook

- [sheet.workbook.rename](sheet.workbook.rename.md) — pencil icon opens inline rename with Save/Cancel

## Status bar

- [sheet.status-bar.numeric-stats](sheet.status-bar.numeric-stats.md) — multi-cell numeric selection shows Count + one picked aggregate
- [sheet.status-bar.stat-picker](sheet.status-bar.stat-picker.md) — Sum/Avg/Min/Max dropdown; default Avg, persisted across sessions
- [sheet.status-bar.count-only](sheet.status-bar.count-only.md) — non-numeric multi-cell selection shows just cell count

## Debug

- [sheet.debug.mode](sheet.debug.mode.md) — persistent toggle: keylog ring buffer + range-annotated clipboard for agent handoff
