<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { get } from "svelte/store";
  import { editingCell } from "../stores/spreadsheet";
  import Cell from "./Cell.svelte";
  import {
    cells,
    COLUMNS,
    ROWS,
    columnWidths,
    setColumnWidth,
    selectedCells,
    parseCellId,
    rangeNameFor,
    selectSingle,
  } from "../stores/spreadsheet";
  import { formatValue } from "../spreadsheet/formatter";
  import {
    measureColumnAutoFit,
    readAutoFitStyles,
  } from "../spreadsheet/autofit";
  import {
    removeRows,
    removeCols,
    insertCols,
    moveCols,
    moveRows,
  } from "../stores/persistence";
  import {
    headerSelection,
    selectedCols,
    selectedRows,
  } from "../stores/headerSelection";
  import CellContextMenu from "./CellContextMenu.svelte";
  import {
    ROW_HEIGHT_PX,
    RowHeights,
    setGridContainer,
    visibleRowRange,
  } from "../virtualization";
  import { hiddenRowIndices } from "../stores/filter";
  import type { CellId } from "../spreadsheet/types";

  interface Props {
    // Database + workbook ids are needed to build the data-API URL
    // the cell context menu copies / opens. Provided by SheetsPage.
    database?: string;
    workbookId?: string;
    // Cut/Copy/Paste handlers come from SheetsPage so the right-click
    // menu reuses the same payload-building / clipboard-applying
    // logic that Cmd+C/X/V uses.
    onCutFromMenu?: () => Promise<void>;
    onCopyFromMenu?: () => Promise<void>;
    onPasteFromMenu?: () => Promise<void>;
  }

  let {
    database = "",
    workbookId = "",
    onCutFromMenu = async () => {},
    onCopyFromMenu = async () => {},
    onPasteFromMenu = async () => {},
  }: Props = $props();

  let resizing = $state<{
    col: string;
    startX: number;
    startWidth: number;
  } | null>(null);

  // [sheet.column.resize-drag]
  function handleResizeStart(e: MouseEvent, col: string) {
    e.preventDefault();
    e.stopPropagation();
    const width = $columnWidths[col];
    resizing = { col, startX: e.clientX, startWidth: width };
    window.addEventListener("mousemove", handleResizeMove);
    window.addEventListener("mouseup", handleResizeEnd);
    document.body.style.cursor = "col-resize";
  }

  function handleResizeMove(e: MouseEvent) {
    if (!resizing) return;
    const delta = e.clientX - resizing.startX;
    setColumnWidth(resizing.col, resizing.startWidth + delta);
  }

  function handleResizeEnd() {
    resizing = null;
    window.removeEventListener("mousemove", handleResizeMove);
    window.removeEventListener("mouseup", handleResizeEnd);
    document.body.style.cursor = "";
  }

  // [sheet.column.auto-fit-double-click]
  // Run the helper from spreadsheet/autofit.ts. Same canvas / font /
  // padding / cap regardless of whether one column or a multi-selection
  // is being sized, so the result is identical to double-clicking each
  // column individually. CSS vars + per-cell format are read at call
  // time so a theme swap or a bold cell genuinely affects the width.
  function handleResizeDblClick(e: MouseEvent, col: string) {
    e.preventDefault();
    e.stopPropagation();

    // When the double-clicked column is part of a multi-column
    // header selection, auto-fit every selected column. Otherwise
    // just the clicked one. Matches Google Sheets.
    const clickedIdx = COLUMNS.indexOf(col);
    const cols = $selectedCols;
    const targets =
      clickedIdx >= 0 && cols.has(clickedIdx)
        ? [...cols]
            .sort((a, b) => a - b)
            .map((i) => COLUMNS[i])
            .filter((c): c is string => c !== undefined)
        : [col];

    const styles = readAutoFitStyles(gridContainer);
    const cellMap = $cells;
    for (const target of targets) {
      const width = measureColumnAutoFit(target, {
        rows: ROWS,
        getCell: (id) => cellMap.get(id as CellId),
        formatValue: (cell) =>
          cell.error ?? formatValue(cell.computedValue, cell.format),
        styles,
      });
      setColumnWidth(target, Math.ceil(width));
    }
  }

  // Header drag-select state lives in ``stores/headerSelection.ts``
  // (one generic axis switch shared by row + column). The component
  // only consumes the reactive ``selectedCols`` / ``selectedRows``
  // sets and forwards mouse / keyboard gestures to the store.
  // [cell-grid-02]
  // Context-menu state (null when closed).
  let rowMenu = $state<{ x: number; y: number; rows: number[] } | null>(null);
  let colMenu = $state<{ x: number; y: number; cols: number[] } | null>(null);
  // Cell context menu — opened on right-click anywhere inside the grid.
  // ``range`` is the A1 string of the current selection (single cell
  // or bounding box), handed straight to the Named Ranges editor.
  // ``cellId`` is the right-clicked cell; the CellContextMenu
  // component subscribes to the stores it needs to derive any
  // conditional menu items (SQL refresh, edit dropdown) from it.
  let cellMenu = $state<{
    x: number;
    y: number;
    range: string;
    cellId: CellId;
  } | null>(null);

  // [sheet.cell.context-menu]
  function handleCellContextmenu(e: MouseEvent, cellId: CellId) {
    e.preventDefault();
    // If the right-clicked cell isn't part of the current selection,
    // switch the selection to it first — matches Google Sheets, where
    // right-clicking outside the selection collapses it to the
    // clicked cell.
    if (!$selectedCells.has(cellId)) {
      selectSingle(cellId);
    }
    const range = rangeNameFor($selectedCells) ?? cellId;
    cellMenu = {
      x: e.clientX,
      y: e.clientY,
      range,
      cellId,
    };
  }

  function closeCellMenu() {
    cellMenu = null;
  }

  // [sheet.selection.column-header-click] [sheet.selection.column-header-shift-click]
  function handleColHeaderMousedown(e: MouseEvent, colIdx: number) {
    if (e.button === 2) return;
    e.preventDefault();

    // [sheet.column.drag-reorder]
    // Detect multi-column drag intent BEFORE ``startDrag`` would
    // collapse the selection to the clicked column. When the user
    // mousedowns inside a contiguous multi-col header selection,
    // they're grabbing the whole block — drag arms with the full
    // range and we skip ``startDrag`` so the selection stays
    // intact during and after the drag. Non-contiguous selections
    // and out-of-selection clicks fall back to single-col behavior.
    let dragSrcStart = colIdx;
    let dragSrcEnd = colIdx;
    let inMultiColBlock = false;
    if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
      const sel = $selectedCols;
      if (sel.has(colIdx) && sel.size > 1) {
        const sorted = [...sel].sort((a, b) => a - b);
        let contiguous = true;
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i] !== sorted[i - 1] + 1) {
            contiguous = false;
            break;
          }
        }
        if (contiguous) {
          dragSrcStart = sorted[0];
          dragSrcEnd = sorted[sorted.length - 1];
          inMultiColBlock = true;
        }
      }
    }

    if (!inMultiColBlock) {
      headerSelection.startDrag("col", colIdx, e.shiftKey);
      window.addEventListener("mouseup", endColDrag);
    }

    // [sheet.column.drag-reorder]
    // Arm the reorder drag in parallel. If the user drags past the
    // threshold, mousemove flips ``armed`` and gracefully winds down
    // the header-select drag (extendDragTo is gated on dragActive).
    // Suppressed when the user is shift/cmd-clicking — those gestures
    // are select-extensions, not drags.
    if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
      colDrag = {
        srcStart: dragSrcStart,
        srcEnd: dragSrcEnd,
        startX: e.clientX,
        gap: null,
        gapPx: 0,
        armed: false,
      };
      window.addEventListener("mousemove", handleColDragMove);
      window.addEventListener("mouseup", handleColDragEnd);
    }
  }

  // [sheet.selection.column-header-drag]
  function handleColHeaderMouseenter(colIdx: number) {
    headerSelection.extendDragTo("col", colIdx);
  }

  function endColDrag() {
    headerSelection.endDrag("col");
    window.removeEventListener("mouseup", endColDrag);
  }

  // ───── Column drag-reorder ───────────────────────────────────
  // [sheet.column.drag-reorder]
  // Per-drag state. ``armed`` flips true once the pointer has moved
  // past the click/drag threshold (4px) — before that, a release
  // falls through to the existing column-select gesture. Once
  // armed, the source column header(s) fade and a 2px accent
  // indicator follows the pointer to the nearest gap.
  const COL_DRAG_THRESHOLD_PX = 4;
  let colDrag = $state<{
    srcStart: number;
    srcEnd: number;
    startX: number;
    gap: number | null;
    /** Pixel ``left`` of the gap relative to the grid's offset
     *  parent. Computed alongside ``gap`` in mousemove so the
     *  drop-indicator can render with a flat reactive read. */
    gapPx: number;
    armed: boolean;
  } | null>(null);

  /** Find the column-gap (0..COLUMNS.length) nearest the pointer
   *  AND the pixel ``left`` of that gap inside the scrolling grid
   *  body. Walks the rendered ``.column-header`` elements so we get
   *  the actual mounted widths + scroll position without
   *  recomputing cumulative widths from the columnWidths store.
   *
   *  Returns ``{ gap, gapPx }`` where ``gapPx`` is in the
   *  ``.grid`` element's coordinate space (suits ``style:left`` on
   *  an absolute-positioned indicator inside ``.grid``).
   */
  function computeGapFromX(clientX: number): { gap: number; gapPx: number } {
    if (!gridContainer) return { gap: 0, gapPx: 0 };
    const grid = gridContainer.querySelector<HTMLElement>(".grid");
    if (!grid) return { gap: 0, gapPx: 0 };
    const gridLeft = grid.getBoundingClientRect().left;
    const headers = gridContainer.querySelectorAll<HTMLElement>(
      ".header-row .column-header",
    );
    for (let i = 0; i < headers.length; i++) {
      const rect = headers[i].getBoundingClientRect();
      // Left half → drop before this col (gap = i, indicator at
      // header's left edge). Right half → drop after this col
      // (gap = i+1, indicator at header's right edge).
      if (clientX < rect.left + rect.width / 2) {
        return { gap: i, gapPx: rect.left - gridLeft };
      }
      if (clientX < rect.right) {
        return { gap: i + 1, gapPx: rect.right - gridLeft };
      }
    }
    // Past the last column header → drop at the trailing gap.
    const last = headers[headers.length - 1];
    if (last) {
      const rect = last.getBoundingClientRect();
      return { gap: COLUMNS.length, gapPx: rect.right - gridLeft };
    }
    return { gap: COLUMNS.length, gapPx: 0 };
  }

  // [sheet.column.drag-reorder]
  function handleColDragMove(e: MouseEvent) {
    if (!colDrag) return;
    if (!colDrag.armed) {
      const dx = Math.abs(e.clientX - colDrag.startX);
      if (dx < COL_DRAG_THRESHOLD_PX) return;
      colDrag.armed = true;
      // Stand down the parallel header-select drag — its mouseenter
      // extensions are gated on ``dragActive``, so flipping it here
      // freezes the selection at the source column.
      headerSelection.endDrag("col");
      document.body.style.cursor = "grabbing";
    }
    const { gap, gapPx } = computeGapFromX(e.clientX);
    colDrag.gap = gap;
    colDrag.gapPx = gapPx;
  }

  // [sheet.column.drag-reorder]
  async function handleColDragEnd(_e: MouseEvent) {
    window.removeEventListener("mousemove", handleColDragMove);
    window.removeEventListener("mouseup", handleColDragEnd);
    document.body.style.cursor = "";
    const drag = colDrag;
    colDrag = null;
    if (!drag || !drag.armed || drag.gap === null) return;

    const { srcStart, srcEnd, gap } = drag;
    // No-op gates mirror the server's: drop on the source range
    // itself or on either source-edge gap is a no-op. Pre-validate
    // here so we don't fire a network round-trip for an in-place
    // drop.
    if (gap >= srcStart && gap <= srcEnd + 1) return;

    const width = srcEnd - srcStart + 1;
    const finalStart = gap <= srcStart ? gap : gap - width;

    try {
      const result = await moveCols(srcStart, srcEnd, gap);
      // Move the header selection to the new position so the moved
      // column stays "selected" — matches insertColsLeftOfSelected.
      if (result) {
        const sel = new Set<number>();
        for (let i = 0; i < result.width; i++) sel.add(result.final_start + i);
        headerSelection.setAxis("col", {
          selected: sel,
          anchor: result.final_start,
          farEdge: result.final_start + result.width - 1,
        });
      }
    } catch (err) {
      // Server rejected — apply the inverse move to restore the
      // pre-drag layout.
      cells.moveColsLocally(finalStart, finalStart + width - 1, srcStart);
      alert(
        `Failed to move column${width > 1 ? "s" : ""}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // [sheet.delete.column-right-click] [sheet.column.context-menu]
  function handleColHeaderContextmenu(e: MouseEvent, colIdx: number) {
    e.preventDefault();
    if (!$selectedCols.has(colIdx)) {
      headerSelection.startDrag("col", colIdx, false);
      headerSelection.endDrag("col");
    }
    const cols = [...$selectedCols].sort((a, b) => a - b);
    if (cols.length === 0) return;
    colMenu = { x: e.clientX, y: e.clientY, cols };
  }

  function closeColMenu() {
    colMenu = null;
  }

  // [sheet.delete.column-confirm]
  async function deleteSelectedCols() {
    if (!colMenu) return;
    const colIndices = colMenu.cols;
    colMenu = null;
    if (colIndices.length === 0) return;
    const letters = colIndices.map((c) => COLUMNS[c] ?? `col ${c}`);
    const msg =
      colIndices.length === 1
        ? `Delete column ${letters[0]}? This can't be undone.`
        : `Delete ${colIndices.length} columns (${letters[0]}–${letters[letters.length - 1]})? This can't be undone.`;
    if (!confirm(msg)) return;
    try {
      await removeCols(colIndices);
    } catch (e) {
      alert(
        `Failed to delete columns: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    headerSelection.clear("col");
  }

  // [sheet.column.insert-left-right]
  async function insertColsLeftOfSelected() {
    if (!colMenu) return;
    const cols = colMenu.cols;
    colMenu = null;
    if (cols.length === 0) return;
    const at = cols[0];
    const count = cols.length;
    try {
      await insertCols(at, count);
    } catch (e) {
      alert(
        `Failed to insert columns: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    // The previously-selected columns have shifted right by ``count``;
    // reselect their new positions so the visual cue stays with the
    // same data, not the blank inserts.
    const nextSelected = new Set<number>();
    for (const c of cols) nextSelected.add(c + count);
    headerSelection.setAxis("col", {
      selected: nextSelected,
      anchor: at + count,
      farEdge: cols[cols.length - 1] + count,
    });
  }

  // [sheet.column.insert-left-right]
  async function insertColsRightOfSelected() {
    if (!colMenu) return;
    const cols = colMenu.cols;
    colMenu = null;
    if (cols.length === 0) return;
    const at = cols[cols.length - 1] + 1;
    const count = cols.length;
    try {
      await insertCols(at, count);
    } catch (e) {
      alert(
        `Failed to insert columns: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    // Selection anchor stays on the original cols — nothing to their
    // left shifted — so we can leave the headerSelection col axis
    // untouched.
  }

  // [sheet.selection.row-header-click] [sheet.selection.row-header-shift-click]
  function handleRowHeaderMousedown(e: MouseEvent, row: number) {
    // Right-clicks are handled by on:contextmenu — don't hijack them here.
    if (e.button === 2) return;
    e.preventDefault();

    // [sheet.row.drag-reorder]
    // Detect contiguous multi-row drag intent BEFORE startDrag
    // would collapse the selection. ``row`` is 1-based here;
    // ``rowDragSrcStart``/``rowDragSrcEnd`` get stored 0-based to
    // match the engine + backend.
    let dragSrcStart = row - 1;
    let dragSrcEnd = row - 1;
    let inMultiRowBlock = false;
    if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
      const sel = $selectedRows;
      if (sel.has(row) && sel.size > 1) {
        const sorted = [...sel].sort((a, b) => a - b);
        let contiguous = true;
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i] !== sorted[i - 1] + 1) {
            contiguous = false;
            break;
          }
        }
        if (contiguous) {
          dragSrcStart = sorted[0] - 1;
          dragSrcEnd = sorted[sorted.length - 1] - 1;
          inMultiRowBlock = true;
        }
      }
    }

    if (!inMultiRowBlock) {
      headerSelection.startDrag("row", row, e.shiftKey);
      window.addEventListener("mouseup", endRowDrag);
    }

    if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
      rowDrag = {
        srcStart: dragSrcStart,
        srcEnd: dragSrcEnd,
        startY: e.clientY,
        gap: null,
        gapPx: 0,
        armed: false,
      };
      window.addEventListener("mousemove", handleRowDragMove);
      window.addEventListener("mouseup", handleRowDragEnd);
    }
  }

  // [sheet.selection.row-header-drag]
  function handleRowHeaderMouseenter(row: number) {
    headerSelection.extendDragTo("row", row);
  }

  function endRowDrag() {
    headerSelection.endDrag("row");
    window.removeEventListener("mouseup", endRowDrag);
  }

  // ───── Row drag-reorder ──────────────────────────────────────
  // [sheet.row.drag-reorder]
  // Per-drag state. ``armed`` flips true once the pointer has
  // moved past the click/drag threshold (4px) on the Y axis —
  // before that, a release falls through to the existing row-
  // select gesture. srcStart/srcEnd are 0-based row indices
  // (engine convention); display is 1-based and converted at the
  // boundary.
  const ROW_DRAG_THRESHOLD_PX = 4;
  let rowDrag = $state<{
    srcStart: number;
    srcEnd: number;
    startY: number;
    gap: number | null;
    /** Pixel ``top`` of the gap relative to .grid (drop indicator). */
    gapPx: number;
    armed: boolean;
  } | null>(null);

  /** Find the row-gap (0..ROWS.length) nearest the pointer AND
   *  the pixel ``top`` of that gap inside the scrolling grid
   *  body. Walks the rendered ``.row-header`` elements (only the
   *  visible viewport is mounted via virtualization — see notes
   *  in xrctryu8 ticket about clamping past the rendered band).
   */
  function computeRowGapFromY(clientY: number): { gap: number; gapPx: number } {
    if (!gridContainer) return { gap: 0, gapPx: 0 };
    const grid = gridContainer.querySelector<HTMLElement>(".grid");
    if (!grid) return { gap: 0, gapPx: 0 };
    const gridTop = grid.getBoundingClientRect().top;
    const headers = gridContainer.querySelectorAll<HTMLElement>(".row-header");
    for (let i = 0; i < headers.length; i++) {
      const rect = headers[i].getBoundingClientRect();
      // Top half → drop above this row (gap = i, indicator at
      // header's top edge). Bottom half → drop below this row
      // (gap = i+1, indicator at header's bottom edge).
      // ``i`` is the index INTO the rendered headers list, which
      // is also the 0-based row_idx for that header (only the
      // visible rows are mounted).
      const rowIdx = parseInt(headers[i].textContent?.trim() ?? "0", 10) - 1;
      if (rowIdx < 0) continue;
      if (clientY < rect.top + rect.height / 2) {
        return { gap: rowIdx, gapPx: rect.top - gridTop };
      }
      if (clientY < rect.bottom) {
        return { gap: rowIdx + 1, gapPx: rect.bottom - gridTop };
      }
    }
    // Past the last rendered row header → drop at the gap just
    // after it. v1 caveat: virtualization means non-rendered
    // rows aren't reachable as drop targets without scrolling.
    const last = headers[headers.length - 1];
    if (last) {
      const rect = last.getBoundingClientRect();
      const lastIdx = parseInt(last.textContent?.trim() ?? "0", 10) - 1;
      return { gap: lastIdx + 1, gapPx: rect.bottom - gridTop };
    }
    return { gap: ROWS.length, gapPx: 0 };
  }

  // [sheet.row.drag-reorder]
  function handleRowDragMove(e: MouseEvent) {
    if (!rowDrag) return;
    if (!rowDrag.armed) {
      const dy = Math.abs(e.clientY - rowDrag.startY);
      if (dy < ROW_DRAG_THRESHOLD_PX) return;
      rowDrag.armed = true;
      // Stand down the parallel header-select drag.
      headerSelection.endDrag("row");
      document.body.style.cursor = "grabbing";
    }
    const { gap, gapPx } = computeRowGapFromY(e.clientY);
    rowDrag.gap = gap;
    rowDrag.gapPx = gapPx;
  }

  // [sheet.row.drag-reorder]
  async function handleRowDragEnd(_e: MouseEvent) {
    window.removeEventListener("mousemove", handleRowDragMove);
    window.removeEventListener("mouseup", handleRowDragEnd);
    document.body.style.cursor = "";
    const drag = rowDrag;
    rowDrag = null;
    if (!drag || !drag.armed || drag.gap === null) return;

    const { srcStart, srcEnd, gap } = drag;
    if (gap >= srcStart && gap <= srcEnd + 1) return;

    const width = srcEnd - srcStart + 1;
    const finalStart = gap <= srcStart ? gap : gap - width;

    try {
      const result = await moveRows(srcStart, srcEnd, gap);
      if (result) {
        // Move the header selection (1-based) to the new
        // position so the moved row(s) stay "selected".
        const sel = new Set<number>();
        for (let i = 0; i < result.width; i++)
          sel.add(result.final_start + i + 1); // back to 1-based
        headerSelection.setAxis("row", {
          selected: sel,
          anchor: result.final_start + 1,
          farEdge: result.final_start + result.width,
        });
      }
    } catch (err) {
      cells.moveRowsLocally(finalStart, finalStart + width - 1, srcStart);
      alert(
        `Failed to move row${width > 1 ? "s" : ""}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // [sheet.delete.row-right-click] [sheet.row.context-menu-delete-only]
  function handleRowHeaderContextmenu(e: MouseEvent, row: number) {
    e.preventDefault();
    // If the right-clicked row isn't already in the selection, reset the
    // selection to just that row so "Delete row(s)" targets something
    // sensible.
    if (!$selectedRows.has(row)) {
      headerSelection.startDrag("row", row, false);
      headerSelection.endDrag("row");
    }
    const rows = [...$selectedRows].sort((a, b) => a - b);
    // Belt-and-braces: if some edge case leaves us with no rows, don't
    // pop open an empty "Delete 0 rows" menu — just bail.
    if (rows.length === 0) return;
    rowMenu = { x: e.clientX, y: e.clientY, rows };
  }

  function closeRowMenu() {
    rowMenu = null;
  }

  // [sheet.delete.row-confirm]
  async function deleteSelectedRows() {
    if (!rowMenu) return;
    const displayRows = rowMenu.rows;
    rowMenu = null;
    if (displayRows.length === 0) return;
    const msg =
      displayRows.length === 1
        ? `Delete row ${displayRows[0]}? This can't be undone.`
        : `Delete ${displayRows.length} rows (${displayRows[0]}–${displayRows[displayRows.length - 1]})? This can't be undone.`;
    if (!confirm(msg)) return;
    // Convert 1-based display rows to 0-based sheet row_idx.
    const rowIndices = displayRows.map((r) => r - 1);
    try {
      await removeRows(rowIndices);
    } catch (e) {
      alert(
        `Failed to delete rows: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    // Collapse the header highlight — the rows that were selected no
    // longer exist; the row immediately above them is now the new home.
    headerSelection.clear("row");
  }

  // Clear column/row header highlights if the cell selection no longer
  // covers a full row or column (e.g. user clicked a single cell).
  // The reconcile logic itself lives on the headerSelection store; the
  // component owns the subscribe / unsubscribe so the lifecycle is
  // tied to mount / destroy (matters in browser tests where Grid
  // mounts repeatedly).
  //
  // NOTE: take the value via the subscribe callback parameter (`sel`)
  // rather than `$selectedCells` inside the callback — the `$store`
  // auto-subscription read can be stale relative to the value this
  // subscriber was just notified of, which caused the row-header
  // highlight to drop right after the selection was just set.
  let unsubSelHeaders: (() => void) | null = null;

  /**
   * Columns / rows that intersect the current range selection.
   * Drives a lightweight ``.in-range`` header highlight — same
   * effect as Google Sheets where selecting D4:E10 tints the D/E
   * column headers and 4..10 row headers.
   *
   * Suppressed while a header-initiated whole-column / whole-row
   * selection is active: those already get the stronger
   * ``.header-selected`` style on their own axis, and highlighting
   * the perpendicular axis (100 row headers for a single-column
   * select) would be visually noisy for no information gain.
   */
  // [sheet.selection.header-range-tint]
  // [perf] Drive the header tint off the selection's bounding box
  // (computed once in the cached ``selectionRect`` below) instead of
  // iterating every selected cell id + running a regex per id on
  // every selection change. For a 10x20 drag selection the old path
  // was 200 regexes; the new path is ``maxCol - minCol + 1`` Set
  // adds.
  let selectionRect = $derived.by(() => {
    if ($selectedCols.size > 0 || $selectedRows.size > 0) return null;
    if ($selectedCells.size === 0) return null;
    let minRow = Infinity,
      maxRow = -Infinity,
      minCol = Infinity,
      maxCol = -Infinity;
    for (const id of $selectedCells) {
      const { row, colIndex } = parseCellId(id);
      if (colIndex === -1) continue;
      if (row < minRow) minRow = row;
      if (row > maxRow) maxRow = row;
      if (colIndex < minCol) minCol = colIndex;
      if (colIndex > maxCol) maxCol = colIndex;
    }
    if (minRow === Infinity) return null;
    return { minRow, maxRow, minCol, maxCol };
  });

  let inRangeCols = $derived.by(() => {
    if (!selectionRect) return new Set<number>();
    const set = new Set<number>();
    for (let c = selectionRect.minCol; c <= selectionRect.maxCol; c++) {
      set.add(c);
    }
    return set;
  });

  let inRangeRows = $derived.by(() => {
    if (!selectionRect) return new Set<number>();
    const set = new Set<number>();
    for (let r = selectionRect.minRow; r <= selectionRect.maxRow; r++) {
      set.add(r);
    }
    return set;
  });

  /**
   * Shift+Arrow while a whole-column or whole-row header selection
   * is active. Cell-level arrow nav already lives in Cell.svelte
   * (fires when a cell has focus), but header-initiated selections
   * don't focus a cell — so without this global listener the keys
   * would do nothing.
   */
  // [sheet.selection.header-shift-arrow-extend]
  function handleWindowKeydown(e: KeyboardEvent) {
    if (!e.shiftKey) return;
    if (get(editingCell) !== null) return;
    const active = document.activeElement as HTMLElement | null;
    if (
      active &&
      (active.tagName === "INPUT" || active.tagName === "TEXTAREA")
    ) {
      return;
    }

    if ($selectedCols.size > 0) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        headerSelection.extend("col", -1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        headerSelection.extend("col", 1);
      }
      return;
    }

    if ($selectedRows.size > 0) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        headerSelection.extend("row", -1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        headerSelection.extend("row", 1);
      }
    }
  }

  // ─── Row virtualization ─────────────────────────────────────────
  //
  // [sheet.grid.virtualization]
  //
  // Render only rows whose y-range intersects the viewport (plus a
  // buffer). Cuts the number of mounted Cell components from ~1500
  // to ~300, which is the dominant memory + initial-mount-time win.
  //
  // Row heights are tracked per-row in ``rowHeights`` (a RowHeights
  // prefix-sum). Most rows match the default ROW_HEIGHT_PX, but cells
  // with ``format.wrap === "wrap"`` make their row taller; a per-row
  // ResizeObserver feeds the measured height back so the scrollbar
  // extent and ``scrollRowIntoView`` math stay accurate. See
  // ``virtualization.ts`` for the data structure rationale.
  //
  // Outside-the-window cells don't exist as components — arrow nav
  // into one calls ``scrollRowIntoView`` (in Cell.svelte's
  // ``focusCell``) to bring it into the rendered window first.
  let gridContainer = $state<HTMLElement | null>(null);
  let scrollTop = $state(0);
  let viewportHeight = $state(0);
  let resizeObs: ResizeObserver | null = null;
  // Created up-front (not in onMount) because ``trackRow`` actions
  // fire as DOM nodes mount, which happens BEFORE the component's
  // onMount callback. Observing late would miss the initial rows.
  let rowResizeObs: ResizeObserver | null =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver((entries) => handleRowResize(entries))
      : null;
  // ``heightsTick`` is bumped whenever a measured row height changes
  // (or the viewport resizes). The reactive blocks below depend on
  // it so visibleRange / spacers re-derive even though ``rowHeights``
  // itself is mutated in-place rather than reassigned.
  let heightsTick = $state(0);
  const rowHeights = new RowHeights(ROWS.length);
  // Element → 0-based row index, populated by the ``trackRow`` action
  // applied to each ``.data-row`` div. The action registers on mount
  // and unregisters on destroy, so the map only ever holds elements
  // that are currently in the DOM.
  const rowElIndex = new Map<Element, number>();
  // rAF-coalesced height-change handler. Multiple ResizeObserver
  // entries on the same frame (e.g. typing into a wrapped cell that
  // resizes its row) collapse into one re-derive.
  let pendingRowMeasure = false;

  function flushRowMeasure() {
    pendingRowMeasure = false;
    heightsTick++;
  }

  function scheduleRowMeasure() {
    if (pendingRowMeasure) return;
    pendingRowMeasure = true;
    requestAnimationFrame(flushRowMeasure);
  }

  function handleRowResize(entries: ResizeObserverEntry[]) {
    if (!gridContainer) return;
    const firstVisible = visibleRange.start;
    let scrollAdjust = 0;
    let changed = false;
    for (const entry of entries) {
      const idx = rowElIndex.get(entry.target);
      if (idx == null) continue;
      // ``borderBoxSize`` is the modern API; ``contentRect.height``
      // is the fallback. Both report the .data-row element's outer
      // height, which is exactly what occupies vertical space in the
      // grid (cells inside align-items: stretch to fill the row).
      const next =
        entry.borderBoxSize?.[0]?.blockSize ??
        entry.contentRect?.height ??
        ROW_HEIGHT_PX;
      const prev = rowHeights.getHeight(idx);
      if (prev === next) continue;
      // Rows above the viewport that change height would visually
      // shift the rendered content; compensate scrollTop by the
      // delta so the user's eye stays on the same row. (Rows inside
      // the viewport reflow naturally; rows below don't matter.)
      if (idx < firstVisible) scrollAdjust += next - prev;
      rowHeights.setHeight(idx, next);
      changed = true;
    }
    if (!changed) return;
    if (scrollAdjust !== 0) {
      gridContainer.scrollTop += scrollAdjust;
      scrollTop = gridContainer.scrollTop;
    }
    scheduleRowMeasure();
  }

  // Svelte action: each ``.data-row`` element calls this on mount
  // with its 0-based row index. The action keeps ``rowElIndex`` and
  // the ResizeObserver subscription in sync, and tears down on
  // destroy so unmounted rows don't leak entries.
  function trackRow(node: HTMLElement, rowIndex: number) {
    rowElIndex.set(node, rowIndex);
    rowResizeObs?.observe(node);
    // Seed the height immediately so the first frame's spacer math
    // already has a real measurement (rather than the default
    // ROW_HEIGHT_PX) for the freshly-mounted row.
    const h = node.getBoundingClientRect().height;
    if (h > 0 && h !== rowHeights.getHeight(rowIndex)) {
      rowHeights.setHeight(rowIndex, h);
      scheduleRowMeasure();
    }
    return {
      update(nextIndex: number) {
        // Row identity changes (rare — visibleRows is keyed by row
        // number, so re-renders usually destroy + remount). Update
        // the index in case Svelte reuses the node across rows.
        rowElIndex.set(node, nextIndex);
      },
      destroy() {
        rowElIndex.delete(node);
        rowResizeObs?.unobserve(node);
      },
    };
  }

  function handleScroll() {
    if (!gridContainer) return;
    scrollTop = gridContainer.scrollTop;
  }

  // ───── Filter row hiding ────────────────────────────────────────
  //
  // [sheet.filter.row-hide]
  //
  // Two coordinated bits keep hidden rows from contributing to the
  // grid's geometry or compute load:
  //
  //   1. ``RowHeights.setHeight(idx, 0)`` for hidden rows so the
  //      prefix-sum + scrollbar extent collapse the row visually
  //      (zero-height rows occupy zero space in the viewport).
  //   2. ``visibleRows`` filters hidden indices out of the rendered
  //      window so we don't even mount the cell components for rows
  //      the user can't see — keeps the virtualization perf win.
  //
  // ``lastNonHiddenHeight`` stashes a row's prior height before we
  // collapse it, so unhide restores wrap-grown rows to their
  // measured height instead of snapping to ROW_HEIGHT_PX.
  const lastNonHiddenHeight = new Map<number, number>();
  let prevHidden = new Set<number>();

  $effect(() => {
    const hidden = $hiddenRowIndices;
    let changed = false;
    for (const idx of hidden) {
      if (prevHidden.has(idx)) continue;
      const cur = rowHeights.getHeight(idx);
      if (cur > 0) lastNonHiddenHeight.set(idx, cur);
      rowHeights.setHeight(idx, 0);
      changed = true;
    }
    for (const idx of prevHidden) {
      if (hidden.has(idx)) continue;
      const stash = lastNonHiddenHeight.get(idx) ?? ROW_HEIGHT_PX;
      rowHeights.setHeight(idx, stash);
      lastNonHiddenHeight.delete(idx);
      changed = true;
    }
    prevHidden = new Set(hidden);
    if (changed) heightsTick++;
  });

  // ``heightsTick`` (mutated by the row ResizeObserver) is referenced
  // here so Svelte re-derives visibleRange / spacers when a row's
  // measured height changes — RowHeights is mutated in-place, not
  // reassigned, so it isn't reactive on its own.
  let visibleRange = $derived(
    heightsTick >= 0
      ? visibleRowRange(scrollTop, viewportHeight, ROWS.length, rowHeights)
      : { start: 0, end: 0 },
  );
  // [sheet.filter.row-hide] Drop hidden rows from the rendered
  // window — height-0 alone would still mount the cells via the
  // buffer expansion. Filtering here keeps virtualization tight.
  let visibleRows = $derived(
    ROWS.slice(visibleRange.start, visibleRange.end).filter(
      (row) => !$hiddenRowIndices.has(row - 1),
    ),
  );
  let topSpacerHeight = $derived(
    heightsTick >= 0 ? rowHeights.offsetOf(visibleRange.start) : 0,
  );
  let bottomSpacerHeight = $derived(
    heightsTick >= 0
      ? rowHeights.totalHeight() - rowHeights.offsetOf(visibleRange.end)
      : 0,
  );

  onMount(() => {
    window.addEventListener("keydown", handleWindowKeydown);
    unsubSelHeaders = selectedCells.subscribe((sel) => {
      headerSelection.reconcileWith(sel);
    });
    if (gridContainer) {
      // Register the container + RowHeights so ``scrollRowIntoView``
      // (called from Cell.svelte's focusCell when arrow-nav hits an
      // offscreen row) can compute the right target offset without
      // DOM querying. Container is also the overflow:auto scroll
      // surface — its scrollTop drives the visible-row computation.
      setGridContainer(gridContainer, rowHeights);
      viewportHeight = gridContainer.clientHeight;
      // Track viewport resizes (window resize, panel collapse) so
      // ``visibleRange`` widens or narrows to match.
      resizeObs = new ResizeObserver(() => {
        if (gridContainer) viewportHeight = gridContainer.clientHeight;
      });
      resizeObs.observe(gridContainer);
      // The per-row observer (``rowResizeObs``) is created up-front
      // because ``trackRow`` actions fire before ``onMount``. Catch
      // up by observing every row that registered before this point.
      for (const node of rowElIndex.keys()) {
        rowResizeObs?.observe(node);
      }
    }
  });

  onDestroy(() => {
    // Clean up in case component unmounts during resize / drag.
    window.removeEventListener("mousemove", handleResizeMove);
    window.removeEventListener("mouseup", handleResizeEnd);
    window.removeEventListener("mouseup", endRowDrag);
    window.removeEventListener("mouseup", endColDrag);
    // [sheet.column.drag-reorder]
    window.removeEventListener("mousemove", handleColDragMove);
    window.removeEventListener("mouseup", handleColDragEnd);
    // [sheet.row.drag-reorder]
    window.removeEventListener("mousemove", handleRowDragMove);
    window.removeEventListener("mouseup", handleRowDragEnd);
    document.body.style.cursor = "";
    window.removeEventListener("keydown", handleWindowKeydown);
    setGridContainer(null);
    resizeObs?.disconnect();
    resizeObs = null;
    rowResizeObs?.disconnect();
    rowResizeObs = null;
    rowElIndex.clear();
    unsubSelHeaders?.();
    unsubSelHeaders = null;
  });

  // [sheet.delete.context-menu-dismiss]
  function closeHeaderMenus() {
    closeRowMenu();
    closeColMenu();
    closeCellMenu();
  }
</script>

<svelte:window onclick={closeHeaderMenus} />

<div class="grid-container" bind:this={gridContainer} onscroll={handleScroll}>
  <div class="grid">
    <!-- [sheet.column.drag-reorder] 2px accent vertical bar at the
         column gap nearest the pointer. Only mounted while a drag
         is armed; positioned in ``.grid`` coordinates so it scrolls
         with the body. ``pointer-events: none`` so it doesn't
         intercept the mousemove that's driving its position. -->
    {#if colDrag?.armed}
      <div
        class="col-drop-indicator"
        style:left="{colDrag.gapPx}px"
        aria-hidden="true"
      ></div>
    {/if}
    <!-- [sheet.row.drag-reorder] 2px accent horizontal bar at
         the row gap nearest the pointer. Same shape as the col
         indicator but on the Y axis. -->
    {#if rowDrag?.armed && rowDrag.gap !== null}
      <div
        class="row-drop-indicator"
        style:top="{rowDrag.gapPx}px"
        aria-hidden="true"
      ></div>
    {/if}
    <!-- Header row -->
    <div class="header-row">
      <div class="corner-cell"></div>
      {#each COLUMNS as col, colIdx (col)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="column-header"
          class:header-selected={$selectedCols.has(colIdx)}
          class:in-range={inRangeCols.has(colIdx)}
          class:dragging={colDrag?.armed === true &&
            colIdx >= colDrag.srcStart &&
            colIdx <= colDrag.srcEnd}
          style="width: {$columnWidths[col]}px"
          onmousedown={(e) => handleColHeaderMousedown(e, colIdx)}
          onmouseenter={() => handleColHeaderMouseenter(colIdx)}
          oncontextmenu={(e) => handleColHeaderContextmenu(e, colIdx)}
        >
          <span class="column-label">{col}</span>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="resize-handle"
            onmousedown={(e) => handleResizeStart(e, col)}
            ondblclick={(e) => handleResizeDblClick(e, col)}
          ></div>
        </div>
      {/each}
    </div>

    <!-- [sheet.grid.virtualization] Top spacer fills the unrendered
         rows above the viewport so the scrollbar reflects the full
         100-row sheet, not just the rendered slice. -->
    {#if topSpacerHeight > 0}
      <div
        class="row-spacer"
        style="height: {topSpacerHeight}px"
        aria-hidden="true"
      ></div>
    {/if}

    <!-- Data rows — only the visible window is mounted. -->
    {#each visibleRows as row (row)}
      <div class="data-row" use:trackRow={row - 1}>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="row-header"
          class:header-selected={$selectedRows.has(row)}
          class:in-range={inRangeRows.has(row)}
          class:dragging={rowDrag?.armed === true &&
            row - 1 >= rowDrag.srcStart &&
            row - 1 <= rowDrag.srcEnd}
          onmousedown={(e) => handleRowHeaderMousedown(e, row)}
          onmouseenter={() => handleRowHeaderMouseenter(row)}
          oncontextmenu={(e) => handleRowHeaderContextmenu(e, row)}
        >
          {row}
        </div>
        {#each COLUMNS as col (col)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            style="width: {$columnWidths[col]}px; flex-shrink: 0;"
            oncontextmenu={(e) =>
              handleCellContextmenu(e, `${col}${row}` as CellId)}
          >
            <Cell cellId={`${col}${row}`} />
          </div>
        {/each}
      </div>
    {/each}

    <!-- [sheet.grid.virtualization] Bottom spacer for unrendered rows
         below the viewport. Combined with the top spacer, the
         scroll extent matches what an unvirtualized grid would have. -->
    {#if bottomSpacerHeight > 0}
      <div
        class="row-spacer"
        style="height: {bottomSpacerHeight}px"
        aria-hidden="true"
      ></div>
    {/if}
  </div>
</div>

{#if rowMenu}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="row-menu popover"
    style="top: {rowMenu.y}px; left: {rowMenu.x}px"
    onclick={(e) => e.stopPropagation()}
    oncontextmenu={(e) => e.preventDefault()}
  >
    <button
      type="button"
      class="row-menu-item danger"
      onclick={deleteSelectedRows}
    >
      {rowMenu.rows.length === 1
        ? `Delete row ${rowMenu.rows[0]}`
        : `Delete ${rowMenu.rows.length} rows`}
    </button>
  </div>
{/if}

{#if colMenu}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="row-menu popover"
    style="top: {colMenu.y}px; left: {colMenu.x}px"
    onclick={(e) => e.stopPropagation()}
    oncontextmenu={(e) => e.preventDefault()}
  >
    <button
      type="button"
      class="row-menu-item"
      onclick={insertColsLeftOfSelected}
    >
      {colMenu.cols.length === 1
        ? "Insert 1 column to the left"
        : `Insert ${colMenu.cols.length} columns to the left`}
    </button>
    <button
      type="button"
      class="row-menu-item"
      onclick={insertColsRightOfSelected}
    >
      {colMenu.cols.length === 1
        ? "Insert 1 column to the right"
        : `Insert ${colMenu.cols.length} columns to the right`}
    </button>
    <div class="row-menu-divider" role="separator"></div>
    <button
      type="button"
      class="row-menu-item danger"
      onclick={deleteSelectedCols}
    >
      {colMenu.cols.length === 1
        ? `Delete column ${COLUMNS[colMenu.cols[0]] ?? colMenu.cols[0]}`
        : `Delete ${colMenu.cols.length} columns`}
    </button>
  </div>
{/if}

{#if cellMenu}
  <!-- [sheet.cell.context-menu] -->
  <CellContextMenu
    x={cellMenu.x}
    y={cellMenu.y}
    range={cellMenu.range}
    cellId={cellMenu.cellId}
    {database}
    {workbookId}
    onCut={onCutFromMenu}
    onCopy={onCopyFromMenu}
    onPaste={onPasteFromMenu}
    onClose={closeCellMenu}
  />
{/if}

<style>
  .grid-container {
    overflow: auto;
    border: 2px solid var(--sheet-border-strong);
    border-top: 1px solid var(--sheet-border-strong);
    background: var(--sheet-bg);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  }

  .grid {
    display: inline-block;
    min-width: 100%;
    /* [sheet.column.drag-reorder] Anchors the absolute-positioned
       drop indicator below. */
    position: relative;
  }

  /* [sheet.column.drag-reorder] Drop indicator + source-column
     fade. The indicator outranks the sticky header row's
     z-index: 3 so it stays visible across the column header strip. */
  .col-drop-indicator {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--sheet-accent, #6366f1);
    pointer-events: none;
    z-index: 5;
  }

  .column-header.dragging {
    opacity: 0.4;
  }

  /* [sheet.row.drag-reorder] Horizontal sibling of the column
     drop indicator. Same z-index + accent + pointer-events
     handling. */
  .row-drop-indicator {
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--sheet-accent, #6366f1);
    pointer-events: none;
    z-index: 5;
  }

  .row-header.dragging {
    opacity: 0.4;
  }

  /* Pin the column header row to the top while scrolling vertically. */
  .header-row {
    display: flex;
    position: sticky;
    top: 0;
    z-index: 3;
  }

  .data-row {
    display: flex;
  }

  /* [sheet.grid.virtualization] Spacer divs maintain the scroll
     extent for the rows that aren't currently rendered. ``display:
     block`` (browser default) is what we want — full-width, fixed
     height. No content, no interactions. */
  .row-spacer {
    display: block;
    width: 100%;
    pointer-events: none;
  }

  /* Top-left corner — pinned to both axes so it always covers the row-
     header strip when scrolling. */
  .corner-cell {
    width: var(--sheet-row-header-width);
    height: var(--sheet-header-height);
    background: var(--sheet-header-bg);
    border-right: 1px solid var(--sheet-border);
    border-bottom: 1px solid var(--sheet-border-strong);
    flex-shrink: 0;
    position: sticky;
    left: 0;
    z-index: 4;
  }

  .column-header {
    height: var(--sheet-header-height);
    background: var(--sheet-header-bg);
    border-right: 1px solid var(--sheet-border);
    border-bottom: 1px solid var(--sheet-border-strong);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--sheet-font-size);
    font-weight: 600;
    color: var(--sheet-text);
    user-select: none;
    font-family: var(--sheet-font);
    flex-shrink: 0;
    position: relative;
  }

  .column-header.header-selected {
    background: var(--sheet-accent);
    color: #fff;
  }

  .column-label {
    flex: 1;
    text-align: center;
  }

  .resize-handle {
    position: absolute;
    right: -2px;
    top: 0;
    width: 5px;
    height: 100%;
    cursor: col-resize;
    z-index: 2;
  }

  .resize-handle:hover {
    background: rgba(0, 0, 0, 0.15);
  }

  /* Pin the row-header column to the left while scrolling horizontally. */
  .row-header {
    width: var(--sheet-row-header-width);
    /* ``min-height`` — not fixed height — so the header grows along
       with a wrapped cell elsewhere in the row. The flex-row
       stretches every child to the tallest one. */
    min-height: var(--sheet-row-height);
    background: var(--sheet-header-bg);
    border-right: 1px solid var(--sheet-border-strong);
    border-bottom: 1px solid var(--sheet-border);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--sheet-font-size);
    font-weight: 600;
    color: var(--sheet-text);
    flex-shrink: 0;
    user-select: none;
    font-family: var(--sheet-font);
    position: sticky;
    left: 0;
    z-index: 2;
  }

  .row-header.header-selected {
    background: var(--sheet-accent);
    color: #fff;
  }

  /* Row/column headers that intersect a cell-range selection get a
     lighter tint (Google-Sheets style). ``.header-selected`` (full
     column/row click) takes precedence via specificity order. */
  .column-header.in-range:not(.header-selected),
  .row-header.in-range:not(.header-selected) {
    background: var(--sheet-highlight-bg);
    color: var(--sheet-accent);
  }

  .column-header,
  .row-header {
    cursor: pointer;
  }

  .column-header:hover:not(.header-selected):not(.in-range),
  .row-header:hover:not(.header-selected):not(.in-range) {
    background: var(--sheet-active-bg);
  }

  /* Right-click menu on a row header. Positioned in the viewport with
     fixed coords so it's not clipped by grid-container's overflow. */
  .row-menu {
    position: fixed;
    padding: 4px 0;
    min-width: 160px;
    z-index: var(--z-grid-menu);
  }

  .row-menu-item {
    display: block;
    width: 100%;
    padding: 6px 12px;
    font-size: 13px;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    color: var(--sheet-text, #111);
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
  }

  .row-menu-item:hover {
    background: var(--sheet-active-bg, #e8edf2);
  }

  .row-menu-item.danger {
    color: var(--sheet-error, #d00);
  }

  .row-menu-divider {
    height: 1px;
    background: var(--sheet-border-light, #eee);
    margin: 4px 0;
  }
</style>
