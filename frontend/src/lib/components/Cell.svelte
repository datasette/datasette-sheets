<script lang="ts">
  import { tick, onMount, onDestroy } from "svelte";
  import {
    cells,
    cellStore,
    selectedCell,
    editingCell,
    editValue,
    navigate,
    selectedCells,
    selectSingle,
    selectToggle,
    selectRange,
    isDragging,
    formulaRefColors,
    formulaInOpenCall,
    pushUndo,
    undo,
    redo,
    clipboardBounds,
    selectionFarEdge,
    isActiveCellSignal,
    isEditingCellSignal,
    isHighlightedCellSignal,
    isClipboardMarkedCellSignal,
    formulaRefColorCellSignal,
  } from "../stores/spreadsheet";
  import { formatValue } from "../spreadsheet/formatter";
  import {
    canInsertCellRef,
    extractFormulaRefs,
    expandRefCells,
    isFunctionName,
  } from "../spreadsheet/formula-helpers";
  import {
    buildFormulaSegments,
    createFormulaEditState,
    handleFormulaArrowKey,
  } from "../spreadsheet/formula-edit";
  import SignatureHelpPopup from "./SignatureHelpPopup.svelte";
  import { anchorTo } from "../actions/anchorTo";
  import { namedRanges } from "../stores/namedRanges";
  import { get } from "svelte/store";
  import {
    presenceCursorByCell,
    presenceSelectionByCell,
    presenceKey,
  } from "../stores/presence";
  import { scrollRowIntoView } from "../virtualization";
  import { viewCellMap, viewTopLeftCells, activeView } from "../stores/views";
  import {
    filterEdgeMap,
    filterHeaderCells,
    sheetFilter,
    openFilterPopover,
    maybeAutoExpandLocally,
  } from "../stores/filter";
  import { COLUMNS, ROWS } from "../stores/spreadsheet";
  import { markCellDirty, flushSave } from "../stores/persistence";
  import { parseCellId } from "../stores/spreadsheet";
  import {
    toggleFormatFlag,
    clearAllFormat,
    toggleCheckboxes,
    clearDropdownStep,
  } from "../formatCommands";
  import {
    cellNavBindings,
    dispatchKeydown,
    isPrintableEditTrigger,
    type CellKeydownContext,
  } from "../spreadsheet/keymap";
  import {
    dropdownRulesById,
    openDropdownPopover,
    splitMultiValue,
  } from "../stores/dropdownRules";
  import type { CellId } from "../spreadsheet/types";
  import { buildCellInlineStyle } from "../spreadsheet/cell-style";

  interface Props {
    cellId: CellId;
  }

  let { cellId }: Props = $props();

  let inputRef = $state<HTMLInputElement | null>(null);

  // [perf] Subscribe to a per-cell store instead of the global
  // ``$cells`` map. The per-cell store only fires when *this* cell's
  // data reference changes (driven by ``mergeComputedIntoCells``
  // producing new objects only for cells that actually changed), so
  // editing B2 no longer wakes the ~1500 other cells' reactive
  // blocks. When ``cellId`` changes (prop rebind), Svelte's
  // auto-subscribe resubscribes to the new store automatically.
  let cell$ = $derived(cellStore(cellId));
  let cell = $derived($cell$);
  // [perf] Cache the parsed id once per cellId prop change instead of
  // re-parsing (four regex hits) in every reactive block. cellId is
  // stable for the lifetime of a rendered cell in 99% of cases —
  // Grid never rebinds — so this typically runs once.
  let parsed = $derived(parseCellId(cellId));
  // [perf] Per-cell indexed selection signals — only fire for the
  // two cells involved in a selection transition, not all 1500. See
  // ``indexedSingleSignal`` / ``indexedSetSignal`` in
  // stores/spreadsheet.ts.
  let isSelected$ = $derived(isActiveCellSignal(cellId));
  let isSelected = $derived($isSelected$);
  let isHighlighted$ = $derived(isHighlightedCellSignal(cellId));
  let isHighlighted = $derived($isHighlighted$);
  let isEditing$ = $derived(isEditingCellSignal(cellId));
  let isEditing = $derived($isEditing$);
  let isClipboardMarked$ = $derived(isClipboardMarkedCellSignal(cellId));
  let isClipboardMarked = $derived($isClipboardMarked$);
  let refColor$ = $derived(formulaRefColorCellSignal(cellId));
  let refColor = $derived($refColor$ ?? null);

  // Dashed "marching ants" border for copy/cut ranges is drawn only
  // on the outer edges of the range, matching Google Sheets. Both
  // Cmd+C and Cmd+X paint this; the clipboardMode decides what
  // paste does to the source.
  let clipboardEdgeTop = $derived(
    isClipboardMarked &&
      $clipboardBounds !== null &&
      parsed.row === $clipboardBounds.minRow,
  );
  let clipboardEdgeBottom = $derived(
    isClipboardMarked &&
      $clipboardBounds !== null &&
      parsed.row === $clipboardBounds.maxRow,
  );
  let clipboardEdgeLeft = $derived(
    isClipboardMarked &&
      $clipboardBounds !== null &&
      parsed.colIndex === $clipboardBounds.minCol,
  );
  let clipboardEdgeRight = $derived(
    isClipboardMarked &&
      $clipboardBounds !== null &&
      parsed.colIndex === $clipboardBounds.maxCol,
  );

  // [perf] O(1) presence lookup against the cell-indexed presence
  // stores. Previously every cell did a full ``.find()`` over the
  // remote-cursors array on every presence tick — 1500 cells × N
  // users of work per tick.
  // [sheet.presence.remote-cursor]
  let cursorIdxKey = $derived(presenceKey(parsed.row - 1, parsed.colIndex));
  let remoteCursor = $derived($presenceCursorByCell.get(cursorIdxKey) ?? null);
  // [sheet.presence.remote-selection]
  let remoteSelection = $derived($presenceSelectionByCell.get(cellId) ?? null);

  // Named view indicators
  let viewMeta = $derived($viewCellMap.get(cellId) ?? null);
  let isViewTopLeft = $derived($viewTopLeftCells.has(cellId));

  // Which edges of the view range is this cell on?
  // [sheet.view.border]
  let viewEdgeTop = $derived(
    viewMeta ? parsed.row - 1 === viewMeta.min_row : false,
  );
  let viewEdgeBottom = $derived(
    viewMeta ? parsed.row - 1 === viewMeta.max_row : false,
  );
  let viewEdgeLeft = $derived(
    viewMeta ? parsed.colIndex === viewMeta.min_col : false,
  );
  let viewEdgeRight = $derived(
    viewMeta ? parsed.colIndex === viewMeta.max_col : false,
  );

  // [sheet.view.triangle-indicator]
  function handleViewTriangleClick(e: MouseEvent) {
    e.stopPropagation();
    activeView.set(viewMeta);
  }

  // [sheet.filter.border] [sheet.filter.header-bold]
  // Filter rectangle visual treatment. ``filterEdges`` is the per-cell
  // edge-flags map (top/right/bottom/left), ``filterHeaderInfo``
  // marks cells in the filter's header row. Edges stack with the
  // dashed view-edge classes — filter is solid, view is dashed, both
  // can render on the same cell when the rectangles overlap.
  let filterEdges = $derived($filterEdgeMap.get(cellId) ?? null);
  let filterHeaderInfo = $derived($filterHeaderCells.get(cellId) ?? null);
  let isFilterHeader = $derived(filterHeaderInfo !== null);

  // [sheet.filter.column-icon]
  // Chevron icon flags for the active filter column. ``hasPredicate``
  // is wired up in Phase D when predicate writes land; for now it's
  // always false. ``isSortColumn`` is wired up in Phase E.
  let hasPredicate = $derived.by(() => {
    if (!filterHeaderInfo || !$sheetFilter) return false;
    const p = $sheetFilter.predicates?.[String(filterHeaderInfo.colIdx)];
    return p != null && (p.hidden?.length ?? 0) > 0;
  });
  let isSortColumn = $derived(
    filterHeaderInfo !== null &&
      $sheetFilter !== null &&
      $sheetFilter.sort_col_idx === filterHeaderInfo.colIdx,
  );

  // [sheet.filter.column-popover]
  function handleFilterChevronClick(e: MouseEvent) {
    e.stopPropagation();
    if (!filterHeaderInfo) return;
    openFilterPopover(filterHeaderInfo.colIdx, e.currentTarget as HTMLElement);
  }

  let displayValue = $derived.by(() => {
    if (!cell) return "";
    if (cell.error) return cell.error;
    return formatValue(cell.computedValue, cell.format);
  });

  let isNumeric = $derived(
    cell != null && typeof cell.computedValue === "number",
  );
  // [sheet.cell.boolean] Booleans render centered + accent-coloured by
  // default — same "type signal" treatment as numeric, but along the
  // centre axis so the column reads as a TRUE/FALSE flag column.
  let isBoolean = $derived(
    cell != null && typeof cell.computedValue === "boolean",
  );
  // [sheet.cell.custom] Engine-typed Custom values (jdate / jtime /
  // jdatetime / jzoned / jspan + host-registered handlers) render
  // right-aligned in the accent colour — same "type signal" treatment
  // as numeric, since most custom types behave numerically (date math
  // produces spans, etc.).
  let isCustom = $derived(
    cell != null &&
      typeof cell.computedValue === "object" &&
      cell.computedValue !== null &&
      "type_tag" in cell.computedValue,
  );
  // [sheet.format.checkbox] A checkbox cell renders an interactive
  // glyph instead of text. Truthy ``computedValue`` → checked.
  let isCheckbox = $derived(cell?.format.controlType === "checkbox");
  let isChecked = $derived(isCheckbox && Boolean(cell?.computedValue));
  // [sheet.data.dropdown] A dropdown cell renders one or more
  // colored chips with a caret; clicking opens the popover. The
  // chip's color comes from the rule's option list — look up by
  // ``raw_value`` (single) or comma-split values (multi). Values
  // not in the option list render as muted "invalid" chips.
  let isDropdown = $derived(
    cell?.format.controlType === "dropdown" &&
      cell?.format.dropdownRuleId != null,
  );
  let dropdownRule = $derived(
    isDropdown
      ? ($dropdownRulesById.get(cell!.format.dropdownRuleId!) ?? null)
      : null,
  );
  let dropdownSelected = $derived.by(() => {
    if (!isDropdown || !cell) return [] as string[];
    const raw = cell.rawValue ?? "";
    if (raw === "") return [];
    if (dropdownRule?.multi) return splitMultiValue(raw);
    return [raw];
  });
  let dropdownChips = $derived.by(() => {
    if (!dropdownRule)
      return [] as Array<{ value: string; color: string | null }>;
    const byValue = new Map(
      dropdownRule.source.options.map((o) => [o.value, o.color]),
    );
    return dropdownSelected.map((v) => ({
      value: v,
      color: byValue.get(v) ?? null,
    }));
  });
  let isBold = $derived(cell?.format.bold === true);
  let isItalic = $derived(cell?.format.italic === true);
  let isUnderline = $derived(cell?.format.underline === true);
  let isStrikethrough = $derived(cell?.format.strikethrough === true);
  let hAlign = $derived(cell?.format.hAlign ?? null);
  let vAlign = $derived(cell?.format.vAlign ?? null);
  let textColor = $derived(cell?.format.textColor ?? null);
  let fillColor = $derived(cell?.format.fillColor ?? null);
  let fontSize = $derived(cell?.format.fontSize ?? null);
  let wrapMode = $derived(cell?.format.wrap ?? null);
  let borders = $derived(cell?.format.borders ?? null);

  // The `.cell` style attribute is built in one place — see
  // ``buildCellInlineStyle``. Everything emitted is a CSS variable
  // (``--ref-color``, ``--cell-fill``, ``--cell-border-top``, …) so
  // the stylesheet stays the source of truth for the cascade. Per-side
  // user borders are skipped on sides that already carry a view /
  // clipboard edge, so the dashed edge stays visible.
  let cellInlineStyle = $derived(
    buildCellInlineStyle({
      refColor,
      remoteCursor,
      remoteSelection,
      viewMeta,
      fillColor,
      borders,
      isEditing,
      viewEdgeTop,
      viewEdgeRight,
      viewEdgeBottom,
      viewEdgeLeft,
      clipboardEdgeTop,
      clipboardEdgeRight,
      clipboardEdgeBottom,
      clipboardEdgeLeft,
    }),
  );

  // [sheet.cell.hyperlink]
  // If the cell's whole displayed value is an http(s) URL, expose it
  // as ``cellUrl`` so the template can render an "open in new tab"
  // affordance. Require the string to parse cleanly as a URL with an
  // http/https scheme — reject `file:`, `javascript:`, and anything
  // with surrounding whitespace or stray text, so we don't build a
  // link out of "visit https://example.com".
  let cellUrl = $derived.by(() => {
    if (typeof displayValue !== "string") return null;
    const trimmed = displayValue.trim();
    if (trimmed !== displayValue) return null;
    if (!/^https?:\/\//i.test(trimmed)) return null;
    try {
      const u = new URL(trimmed);
      return u.protocol === "http:" || u.protocol === "https:" ? trimmed : null;
    } catch {
      return null;
    }
  });

  // Update formula ref colors whenever editValue changes while editing a formula
  $effect(() => {
    if (isEditing && $editValue.startsWith("=")) {
      updateFormulaRefColors($editValue);
    } else if (isEditing) {
      formulaRefColors.set(new Map());
    }
  });

  function updateFormulaRefColors(formula: string) {
    const refs = extractFormulaRefs(formula);
    const nameDefs = new Map<string, string>();
    for (const n of get(namedRanges)) {
      nameDefs.set(n.name.toUpperCase(), n.definition);
    }
    const maxCol = COLUMNS.length - 1;
    const maxRow = ROWS[ROWS.length - 1];
    const colorMap = new Map<CellId, string>();
    for (const ref of refs) {
      const cells = expandRefCells(ref, nameDefs, maxCol, maxRow);
      for (const cellId of cells) {
        colorMap.set(cellId as CellId, ref.color);
      }
    }
    formulaRefColors.set(colorMap);
  }

  // Per-edit-session state for autocomplete / signature-help / pointing.
  // The popup ``mode`` is a discriminated union (autocomplete vs
  // signature-help vs idle) — mutual exclusion is type-level rather
  // than a hand-coded "if (autocompleteMatches.length > 0)" guard.
  // ``pointingRef`` lives separately because pointing persists across
  // signature-help refreshes after an arrow-key insert.
  // [sheet.editing.formula-autocomplete] [sheet.editing.formula-signature-help] [sheet.editing.formula-ref-pointing]
  const formulaEdit = createFormulaEditState();
  const formulaMode = formulaEdit.mode;

  // Build colored segments for the formula overlay
  // [sheet.editing.formula-string-coloring]
  let formulaSegments = $derived(
    isEditing && $editValue.startsWith("=")
      ? buildFormulaSegments($editValue)
      : [],
  );

  // Reactive views the template binds to. The discriminated-union
  // mode lets the template branch on ``$formulaMode.kind`` without
  // unpacking — but the legacy template shape used three separate
  // bindings, so derive them here for minimal churn.
  let autocompleteMatches = $derived(
    $formulaMode.kind === "autocomplete" ? $formulaMode.matches : [],
  );
  let autocompleteIndex = $derived(
    $formulaMode.kind === "autocomplete" ? $formulaMode.index : 0,
  );
  let functionHelp = $derived(
    $formulaMode.kind === "signature-help"
      ? { info: $formulaMode.info, argIndex: $formulaMode.argIndex }
      : null,
  );

  let mousedownHandled = $state(false);

  // Returns the live input element so the autocomplete / signature
  // popups can re-pin themselves on every scroll / resize. ``inputRef``
  // may briefly be null between rebinds; the action skips when it
  // returns null.
  // [sheet.editing.formula-autocomplete]
  function getAutocompleteAnchor(): HTMLInputElement | null {
    return inputRef;
  }

  function applyAutocomplete(name: string) {
    const m = get(formulaMode);
    if (!inputRef || m.kind !== "autocomplete") return;
    const val = $editValue;
    const { start, end } = m.replace;
    // Function completions auto-insert the opening ``(`` and drop the
    // caret between the parens so the signature-help popup can fire
    // on the same keystroke.
    const asFunction = isFunctionName(name);
    const insert = asFunction ? `${name}(` : name;
    const newValue = val.slice(0, start) + insert + val.slice(end);
    editValue.set(newValue);
    formulaEdit.closeAutocomplete();
    tick().then(() => {
      if (inputRef) {
        const pos = start + insert.length;
        inputRef.setSelectionRange(pos, pos);
        inputRef.focus();
        // Programmatic caret move doesn't fire keyup, so signature
        // help wouldn't otherwise refresh after the insertion.
        formulaEdit.updateSignatureHelp(inputRef);
      }
    });
  }

  function refreshAutocomplete(input: HTMLInputElement) {
    formulaEdit.updateAutocomplete(
      input,
      get(namedRanges).map((n) => n.name),
    );
  }

  // Edit-mode auto-widen: the browser's default ``<input>`` clips at
  // the column width and scrolls horizontally, which makes long
  // formulas unreadable (user can't see the beginning without
  // scrolling back). Mirror the value in a hidden span to measure
  // its natural width, then grow the wrapper to match — capped by
  // the wrapper's ``max-width`` so one pathological cell doesn't
  // cover half the viewport. Matches Google Sheets' "edit box
  // expands over empty neighbours" behaviour.
  let measureRef = $state<HTMLSpanElement | null>(null);
  let editContentWidth = $state(0);

  // Re-runs after every DOM flush whose inputs we read below — most
  // importantly ``$editValue``, which refreshes the mirror's
  // textContent and thus its ``offsetWidth``. Guarding on equality
  // keeps the assignment a no-op when the measured width hasn't
  // changed, so this never feeds its own reactivity back in.
  $effect(() => {
    // Track ``$editValue`` so the effect re-runs when the user types,
    // mirroring legacy ``afterUpdate``'s "fires after every DOM flush"
    // behaviour for our purposes.
    void $editValue;
    if (!isEditing || !measureRef) return;
    // Small buffer so the caret + the inset outline don't clip the
    // trailing character. 3px ≈ 2px for outline-offset + 1px of
    // slack. Was 8px — too generous; left visible trailing space
    // between the last character and the focus ring.
    const w = measureRef.offsetWidth + 3;
    if (w !== editContentWidth) editContentWidth = w;
  });

  function handleInputKeyup(e: KeyboardEvent) {
    // Caret-movement keys (arrows, Home/End) and typing both land
    // here; cheap enough to re-run on every key.
    const target = e.currentTarget as HTMLInputElement;
    formulaEdit.updateSignatureHelp(target);
  }

  function handleInputClick(e: MouseEvent) {
    const target = e.currentTarget as HTMLInputElement;
    formulaEdit.updateSignatureHelp(target);
  }

  // [sheet.data.dropdown] Svelte action — measures the chip
  // container and hides chips that won't fit, updating the trailing
  // ``+N`` badge to reflect the hidden count.
  //
  // Re-run triggers:
  //   1. Cell resize (column drag) — the ``ResizeObserver`` on the
  //      container fires.
  //   2. Chip list change — Svelte calls our ``update()`` whenever the
  //      action parameter (the ``dropdownChips`` array reference)
  //      changes.
  //
  // **Contract**: the parameter MUST be the live chip array — even
  // though ``measure()`` reads the chips back out of the DOM via
  // ``querySelectorAll``, Svelte only invokes ``update()`` when the
  // parameter reference changes. Drop the parameter and the action
  // stops re-measuring on chip-text changes that don't change the
  // container's width. Don't "clean up the unused param" — it's the
  // dependency.
  //
  // **Coalescing**: ``schedule()`` collapses any number of triggers
  // in the same frame down to a single ``requestAnimationFrame`` —
  // formula recompute storms touch dozens of dropdown cells, each
  // would otherwise queue its own measure. One pending ``raf`` per
  // action instance is plenty.
  function fitChips(node: HTMLElement, _chips: typeof dropdownChips) {
    const GAP_PX = 3; // matches CSS ``gap`` on .dropdown-chips
    let pendingRaf = 0;

    function measure() {
      pendingRaf = 0;
      const realChips = Array.from(
        node.querySelectorAll<HTMLElement>(".dropdown-chip"),
      );
      const badge = node.querySelector<HTMLElement>(".dropdown-chip-overflow");
      if (!badge) return;

      // Reset everything visible so widths can be measured naturally.
      for (const c of realChips) c.style.display = "";
      badge.style.display = "";

      if (realChips.length === 0) {
        badge.style.display = "none";
        return;
      }

      const containerWidth = node.clientWidth;
      const widths = realChips.map((c) => c.offsetWidth);

      // First pass: do all chips fit without the badge?
      let total = 0;
      for (let i = 0; i < widths.length; i++) {
        total += widths[i] + (i > 0 ? GAP_PX : 0);
      }
      if (total <= containerWidth) {
        badge.style.display = "none";
        return;
      }

      // Doesn't all fit. Reserve room for the badge and walk again.
      const badgeWidth = badge.offsetWidth;
      let used = 0;
      let fitting = 0;
      for (let i = 0; i < widths.length; i++) {
        const next =
          used + (i > 0 ? GAP_PX : 0) + widths[i] + GAP_PX + badgeWidth;
        if (next <= containerWidth) {
          used += (i > 0 ? GAP_PX : 0) + widths[i];
          fitting = i + 1;
        } else {
          break;
        }
      }
      // Always show at least one chip so the cell is never blank
      // when there's a value — even if the chip itself overflows
      // (text-overflow: ellipsis caps it).
      if (fitting === 0) fitting = 1;

      for (let i = 0; i < realChips.length; i++) {
        realChips[i].style.display = i < fitting ? "" : "none";
      }
      const hidden = realChips.length - fitting;
      badge.textContent = `+${hidden}`;
      badge.style.display = hidden > 0 ? "" : "none";
    }

    function schedule() {
      if (pendingRaf !== 0) return;
      pendingRaf = requestAnimationFrame(measure);
    }

    const ro = new ResizeObserver(schedule);
    ro.observe(node);
    schedule();

    return {
      update(_nextChips: typeof dropdownChips) {
        // ``_nextChips`` is the new chip array — referencing it here
        // is what makes the dependency contract above explicit. The
        // measurement still reads chips back out of the DOM, but
        // Svelte only schedules us when this parameter changes.
        void _nextChips;
        schedule();
      },
      destroy() {
        ro.disconnect();
        if (pendingRaf !== 0) cancelAnimationFrame(pendingRaf);
      },
    };
  }

  // [sheet.cell.force-text] Commit a cell-edit input through the
  // right write path. A leading ``'`` strips the prefix and routes
  // the rest as a literal String (typed override). A formula or
  // empty value clears any prior force-text override; otherwise a
  // re-edit of an already-force-text cell preserves the override.
  function commitCellEdit(value: string): void {
    if (value.startsWith("'")) {
      cells.setCellValueAsString(cellId, value.slice(1));
    } else if (value === "" || value.startsWith("=")) {
      cells.setCellValue(cellId, value);
    } else if (cell?.typedKind === "string") {
      cells.setCellValueAsString(cellId, value);
    } else {
      cells.setCellValue(cellId, value);
    }
    // [sheet.filter.auto-expand] Optimistic mirror — the server runs
    // the same check and broadcasts the authoritative filter-update
    // via SSE. For the originating client the SSE event is a no-op
    // (max_row already matches); for collaborators it's the only
    // signal that the filter grew.
    maybeAutoExpandLocally(parsed.row - 1, parsed.colIndex, value);
  }

  // [sheet.format.checkbox] Toggle the checkbox cell's value. Spill
  // members are rendered with the format but their value is owned by
  // the anchor — clicking would put the cell into #SPILL!, so guard.
  function handleCheckboxToggle() {
    if (cell?.isSpillMember) return;
    selectSingle(cellId);
    pushUndo();
    markCellDirty(cellId);
    cells.setCellValue(cellId, isChecked ? "FALSE" : "TRUE");
    flushSave();
  }

  // True when the active multi-selection contains at least one
  // checkbox-formatted cell — used to decide whether Space should be
  // intercepted on a non-checkbox active cell whose selection
  // *includes* checkboxes. [sheet.format.checkbox]
  function hasCheckboxInSelection(): boolean {
    for (const id of $selectedCells) {
      if (cells.getCell(id)?.format.controlType === "checkbox") return true;
    }
    return false;
  }

  // [sheet.data.dropdown] Click on the chip / caret opens the
  // popover. Spill members render the chip but click is a no-op
  // (selecting a value would put the cell into #SPILL!).
  function handleDropdownOpen() {
    if (cell?.isSpillMember) return;
    selectSingle(cellId);
    openDropdownPopover(cellId);
  }

  // [sheet.selection.shift-click]
  function handleMousedown(e: MouseEvent) {
    if (isEditing) return;
    // Right-click is handled by Grid's contextmenu listener; don't
    // let it drag-select or disturb the current selection here.
    if (e.button === 2) return;
    mousedownHandled = true;
    activeView.set(null);

    if (e.shiftKey) {
      selectRange(cellId);
    } else if (e.metaKey || e.ctrlKey) {
      selectToggle(cellId);
    } else {
      selectSingle(cellId);
      isDragging.set(true);
    }
  }

  // [sheet.selection.click]
  function handleClick(e: MouseEvent) {
    if (isEditing) return;
    if (mousedownHandled) {
      mousedownHandled = false;
      return;
    }

    if (e.shiftKey) {
      selectRange(cellId);
    } else if (e.metaKey || e.ctrlKey) {
      selectToggle(cellId);
    } else {
      selectSingle(cellId);
    }
  }

  // [sheet.selection.drag]
  function handleMouseenter() {
    if ($isDragging) {
      // Keep the active cell at the anchor (where the drag started)
      // — matches Google Sheets, where click-B3 + drag-to-C10 keeps
      // the thick selection box on B3. Without ``keepActive`` the
      // box would chase the cursor.
      selectRange(cellId, { keepActive: true });
    }
  }

  // [sheet.editing.double-click]
  function handleDoubleClick() {
    // Click→click already solo-selected this cell; skipping a redundant
    // selectSingle avoids three store writes that'd re-fire every cell's
    // reactive subscriptions.
    if ($selectedCell !== cellId || $selectedCells.size !== 1) {
      selectSingle(cellId);
    }
    editingCell.set(cellId);
    editValue.set(cell?.rawValue ?? "");
  }

  // [sheet.editing.blur-commits]
  function handleBlur() {
    if ($editingCell === cellId) {
      pushUndo();
      markCellDirty(cellId);
      commitCellEdit($editValue);
      flushSave();
      editingCell.set(null);
      formulaRefColors.set(new Map());
      formulaEdit.reset();
    }
  }

  // [sheet.editing.formula-ref-pointing]
  function handleKeydown(e: KeyboardEvent) {
    // Autocomplete takes precedence while the popup is open: Arrow
    // keys navigate the list, Enter/Tab commit the selected name,
    // Escape dismisses. Any other key flows through to the regular
    // edit handler (so typing more characters refines the match).
    // [sheet.editing.formula-autocomplete]
    const popup = $formulaMode;
    if (popup.kind === "autocomplete") {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        formulaMode.set({
          ...popup,
          index: (popup.index + 1) % popup.matches.length,
        });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        formulaMode.set({
          ...popup,
          index:
            (popup.index - 1 + popup.matches.length) % popup.matches.length,
        });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        applyAutocomplete(popup.matches[popup.index]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        formulaEdit.closeAutocomplete();
        return;
      }
    }

    // Signature help is passive (``pointer-events: none``), so it
    // doesn't intercept Escape — Escape falls through to the
    // edit-mode cancel block below, which exits edit mode AND
    // drops the popup as a side effect (isEditing=false unmounts
    // it). Two-step "Esc closes popup, Esc exits edit" was a worse
    // UX than one-step cancel.
    if (e.key.startsWith("Arrow")) {
      const arrowResult = handleFormulaArrowKey(formulaEdit, e, {
        cellId,
        editValue: $editValue,
        input: inputRef,
        canInsertCellRef,
        navigate: (from, dir) => navigate(from as CellId, dir),
        setEditValue: (v) => editValue.set(v),
      });
      if (arrowResult.kind === "handled") {
        const { caret, refreshSignatureHelp } = arrowResult;
        tick().then(() => {
          if (inputRef) {
            inputRef.setSelectionRange(caret, caret);
            if (refreshSignatureHelp) {
              formulaEdit.updateSignatureHelp(inputRef);
            }
          }
        });
        return;
      }

      // Arrow key but not in pointing mode — let the caret move
      // natively, and drop any stale pointing ref so the next arrow
      // starts a fresh insertion if the caret lands on an
      // insertable position.
      e.stopPropagation();
      formulaEdit.clearPointing();
      return;
    }

    formulaEdit.clearPointing();

    // [sheet.navigation.enter-commit-down]
    if (e.key === "Enter") {
      e.stopPropagation();
      pushUndo();
      markCellDirty(cellId);
      commitCellEdit($editValue);
      flushSave();
      editingCell.set(null);
      formulaRefColors.set(new Map());
      formulaEdit.closeSignatureHelp();

      const targetId = navigate(cellId, "down", false);
      if (targetId !== cellId) {
        selectSingle(targetId);
        focusCell(targetId);
      }
      // [sheet.editing.escape-cancels]
    } else if (e.key === "Escape") {
      e.stopPropagation();
      editingCell.set(null);
      formulaRefColors.set(new Map());
      formulaEdit.closeSignatureHelp();
      focusCell(cellId);
      // [sheet.navigation.tab-commit-right]
    } else if (e.key === "Tab") {
      e.preventDefault();
      markCellDirty(cellId);
      commitCellEdit($editValue);
      flushSave();
      editingCell.set(null);
      formulaRefColors.set(new Map());
      formulaEdit.closeSignatureHelp();

      const targetId = navigate(cellId, "right", false);
      if (targetId !== cellId) {
        selectSingle(targetId);
        focusCell(targetId);
      }
    }
  }

  function focusCell(targetId: CellId) {
    // [sheet.grid.virtualization] Arrow nav can land on a row outside
    // the rendered window — Grid only mounts visible rows. Scroll
    // the container so the target row is in view BEFORE the
    // querySelector below; the scroll triggers Grid's
    // ``visibleRange`` re-derive, which renders the row, and then
    // the next tick finds it. No-op when Grid isn't mounted (cell
    // unit tests) — falls back to "if it's in the DOM, focus it".
    const { row } = parseCellId(targetId);
    scrollRowIntoView(row);
    tick().then(() => {
      const el = document.querySelector(
        `[data-cell-id="${targetId}"]`,
      ) as HTMLElement | null;
      el?.focus();
    });
  }

  function handleInput(e: Event) {
    const target = e.target as HTMLInputElement;
    editValue.set(target.value);
    formulaEdit.clearPointing();
    refreshAutocomplete(target);
    formulaEdit.updateSignatureHelp(target);
  }

  function startEditing(initialValue: string = cell?.rawValue ?? "") {
    // Enter/F2/first-keypress only ever fires on the focused cell, which is
    // always the sole selection. Skipping selectSingle here avoids three
    // extra store writes whose reactive fanout across ~1500 cells was the
    // dominant ~200ms of the "cell → Enter → edit" latency.
    if ($selectedCell !== cellId || $selectedCells.size !== 1) {
      selectSingle(cellId);
    }
    editingCell.set(cellId);
    editValue.set(initialValue);
    // The <input> is focused synchronously via the `use:focusOnMount`
    // action below — no need to `await tick()` for the reactive flush.
  }

  // Focus an input as soon as it's in the DOM, without waiting on the
  // Svelte microtask queue. Using an action (instead of `autofocus`) makes
  // this work reliably on dynamically-mounted inputs across browsers.
  function focusOnMount(node: HTMLInputElement) {
    node.focus();
    // Put the caret at the end so typing-to-edit appends naturally.
    const len = node.value.length;
    node.setSelectionRange(len, len);
  }

  // Paste is handled at the document level in SheetsPage so it works
  // regardless of which element inside the sheet has focus. See
  // SheetsPage::handlePaste.

  // Nav-mode keystrokes. Edit-mode keystrokes go to handleKeydown (on the <input>).
  // Every cell div below has `tabindex="0"`, so any focus-moving key
  // (Tab, Shift+Tab, PageUp/Down, etc.) left unhandled here falls
  // through to the browser's default — which shuffles DOM focus
  // without touching $selectedCell, so the .selected outline desyncs
  // from the focused cell until the next store-touching keystroke.
  // If you add a key here that moves focus, preventDefault + call
  // selectSingle + focusCell in lockstep (see the Tab/arrow blocks).
  //
  // The binding inventory itself lives in
  // ``lib/spreadsheet/keymap.ts::cellNavBindings`` — this function
  // is only the dispatcher + the printable-key fallback (which
  // can't be expressed as a fixed-key binding). [CELL-GRID-08]
  function handleCellKeydown(e: KeyboardEvent) {
    if (isEditing) return;

    const ctx: CellKeydownContext = {
      event: e,
      cellId,
      isDropdown,
      isCheckbox,
      selectionFarEdge: $selectionFarEdge,
      hasCheckboxInSelection,
      handleDropdownOpen,
      startEditing,
      focusCell,
      navigate,
      selectSingle,
      selectRange,
      toggleFormatFlag,
      clearAllFormat,
      toggleCheckboxes,
      clearDropdownStep,
      flushSave,
      pushUndo,
      undo,
      redo,
    };

    if (dispatchKeydown(e, ctx, cellNavBindings)) return;

    // [sheet.editing.type-replaces]
    // Printable-character fallback — type-to-edit. Only fires if no
    // binding above consumed the event. The predicate's regex
    // (``[a-zA-Z0-9=]``) is narrower than Google Sheets'
    // "any printable char" rule; expanding it is deferred (see
    // CELL-GRID-08 secondary issue #5).
    if (isPrintableEditTrigger(e)) {
      e.preventDefault();
      startEditing(e.key);
      return;
    }
  }

  function handleWindowMouseup() {
    if ($isDragging) {
      isDragging.set(false);
    }
  }

  onMount(() => {
    window.addEventListener("mouseup", handleWindowMouseup);
  });

  onDestroy(() => {
    window.removeEventListener("mouseup", handleWindowMouseup);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="cell"
  class:selected={isSelected}
  class:highlighted={isHighlighted && !isSelected}
  class:editing={isEditing}
  class:clipboard-marked={isClipboardMarked}
  class:clipboard-edge-top={clipboardEdgeTop}
  class:clipboard-edge-bottom={clipboardEdgeBottom}
  class:clipboard-edge-left={clipboardEdgeLeft}
  class:clipboard-edge-right={clipboardEdgeRight}
  class:error={cell?.error}
  class:ref-highlighted={refColor !== null && !isEditing}
  class:in-open-call={refColor !== null && !isEditing && $formulaInOpenCall}
  class:spill-anchor={cell?.isSpillAnchor === true}
  class:spill-member={cell?.isSpillMember === true}
  class:remote-cursor={remoteCursor !== null}
  class:remote-selection={remoteSelection !== null && remoteCursor === null}
  class:view-edge-top={viewEdgeTop}
  class:view-edge-bottom={viewEdgeBottom}
  class:view-edge-left={viewEdgeLeft}
  class:view-edge-right={viewEdgeRight}
  class:filter-edge-top={filterEdges?.top}
  class:filter-edge-right={filterEdges?.right}
  class:filter-edge-bottom={filterEdges?.bottom}
  class:filter-edge-left={filterEdges?.left}
  class:filter-header={isFilterHeader}
  class:v-top={vAlign === "top"}
  class:v-middle={vAlign === "middle"}
  class:v-bottom={vAlign === "bottom"}
  class:wrap-wrap={wrapMode === "wrap"}
  class:wrap-clip={wrapMode === "clip"}
  style={cellInlineStyle}
  onmousedown={handleMousedown}
  onmouseenter={handleMouseenter}
  onclick={handleClick}
  ondblclick={handleDoubleClick}
  onkeydown={handleCellKeydown}
  data-cell-id={cellId}
  role="gridcell"
  tabindex="0"
>
  {#if isEditing}
    <div
      class="formula-edit-wrapper"
      style="--edit-content-width: {editContentWidth}px"
    >
      <!--
        Hidden mirror for auto-widening while editing. Same font +
        padding as the input so its measured offsetWidth matches what
        the real input would need to show the value without clipping.
      -->
      <span class="edit-measure" aria-hidden="true" bind:this={measureRef}
        >{$editValue || " "}</span
      >
      <!-- Colored overlay (rendered text with colors, not interactive) -->
      {#if formulaSegments.length > 0}
        <div class="formula-overlay" aria-hidden="true">
          {#each formulaSegments as seg, i (i)}
            {#if seg.color}
              <span style="color: {seg.color}; font-weight: 600;"
                >{seg.text}</span
              >
            {:else}
              <span>{seg.text}</span>
            {/if}
          {/each}
        </div>
      {/if}
      <input
        bind:this={inputRef}
        use:focusOnMount
        type="text"
        class="cell-input"
        class:has-overlay={formulaSegments.length > 0}
        value={$editValue}
        onblur={handleBlur}
        onkeydown={handleKeydown}
        oninput={handleInput}
        onkeyup={handleInputKeyup}
        onclick={handleInputClick}
      />
    </div>
    {#if functionHelp}
      <!-- [sheet.editing.formula-signature-help] -->
      <SignatureHelpPopup
        info={functionHelp.info}
        argIndex={functionHelp.argIndex}
        getAnchor={getAutocompleteAnchor}
      />
    {/if}
    {#if autocompleteMatches.length > 0 && inputRef}
      <!-- [sheet.editing.formula-autocomplete] -->
      <div
        class="autocomplete-popup popover"
        use:anchorTo={{ getAnchor: getAutocompleteAnchor, placement: "below" }}
        role="listbox"
        aria-label="Named range suggestions"
      >
        {#each autocompleteMatches as match, i (match)}
          <button
            type="button"
            class="autocomplete-item"
            class:active={i === autocompleteIndex}
            data-cell-id="autocomplete-item"
            onmousedown={(e) => {
              e.preventDefault();
              applyAutocomplete(match);
            }}
          >
            {match}
          </button>
        {/each}
      </div>
    {/if}
  {:else if isCheckbox}
    <!-- [sheet.format.checkbox] Interactive checkbox replaces the
         text rendering entirely. ``stopPropagation`` on click so we
         toggle without also re-selecting / starting an edit. -->
    <button
      type="button"
      class="cell-checkbox"
      class:checked={isChecked}
      role="checkbox"
      aria-checked={isChecked}
      onclick={(e) => {
        e.stopPropagation();
        handleCheckboxToggle();
      }}
      onmousedown={(e) => e.stopPropagation()}
      ondblclick={(e) => e.stopPropagation()}
    >
      {#if isChecked}<span class="check-glyph" aria-hidden="true">✓</span>{/if}
    </button>
  {:else if isDropdown}
    <!-- [sheet.data.dropdown] Chip + caret. The chip pill takes its
         background from the option's color; values not in the rule's
         option list render as muted "invalid" chips so the user can
         see (and clear) bad data. Caret-only when nothing's selected
         yet so an empty cell still has a visible affordance. -->
    <button
      type="button"
      class="cell-dropdown"
      aria-haspopup="listbox"
      title={dropdownRule
        ? dropdownRule.name || "Dropdown"
        : "Dropdown rule missing"}
      onclick={(e) => {
        e.stopPropagation();
        handleDropdownOpen();
      }}
      onmousedown={(e) => e.stopPropagation()}
      ondblclick={(e) => e.stopPropagation()}
    >
      <!-- Render every chip + a trailing "+N" overflow badge; the
           ``fitChips`` action measures the container and hides
           chips that don't fit, updating the badge text to the
           hidden count. Hover any chip for the full comma-separated
           list as a tooltip. -->
      <span class="dropdown-chips" use:fitChips={dropdownChips}>
        {#each dropdownChips as chip (chip.value)}
          <span
            class="dropdown-chip"
            class:invalid={chip.color === null}
            style={chip.color ? `background: ${chip.color};` : ""}
            title={dropdownSelected.join(", ")}>{chip.value}</span
          >
        {/each}
        <span class="dropdown-chip-overflow" style="display: none">+0</span>
      </span>
      <!-- Caret. Empty-state cell: prominent (button-shaped, accent
           tint) so an unset dropdown reads as a clear affordance.
           Filled cell: subtle next-to-chip indicator. -->
      <span
        class="dropdown-caret"
        class:empty={dropdownChips.length === 0}
        aria-hidden="true"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="10"
          height="10"
          fill="currentColor"
          viewBox="0 0 16 16"
        >
          <path
            d="M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z"
          />
        </svg>
      </span>
    </button>
  {:else}
    <!-- ``.numeric`` / ``.boolean`` rules in <style> below MUST sit
         before ``.h-left / .h-center / .h-right`` so an explicit
         ``hAlign`` overrides the auto-numeric/boolean text-align via
         document order (single-class selectors all tie on
         specificity). New variants on this surface — see
         frontend/CLAUDE.md "Adding a new CellValue variant" — must
         keep that ordering. -->
    <span
      class="cell-value"
      class:numeric={isNumeric}
      class:boolean={isBoolean}
      class:custom={isCustom}
      class:bold={isBold}
      class:italic={isItalic}
      class:underline={isUnderline}
      class:strikethrough={isStrikethrough}
      class:h-left={hAlign === "left"}
      class:h-center={hAlign === "center"}
      class:h-right={hAlign === "right"}
      style="{textColor ? `color: ${textColor};` : ''}{fontSize
        ? ` font-size: ${fontSize}pt;`
        : ''}">{displayValue}</span
    >
    {#if cellUrl}
      <!-- [sheet.cell.hyperlink] -->
      <a
        class="cell-link"
        href={cellUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="Open {cellUrl} in new tab"
        onclick={(e) => e.stopPropagation()}
        onmousedown={(e) => e.stopPropagation()}>↗</a
      >
    {/if}
  {/if}
  {#if remoteCursor}
    <span class="presence-label" style="background: {remoteCursor.color}"
      >{remoteCursor.displayName}</span
    >
  {/if}
  {#if isViewTopLeft && viewMeta}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <span
      class="view-triangle"
      style="border-color: {viewMeta.color} transparent transparent transparent"
      onclick={handleViewTriangleClick}
      title={viewMeta.view_name}
    ></span>
  {/if}
  {#if isFilterHeader}
    <!-- [sheet.filter.column-icon] -->
    <button
      type="button"
      class="filter-chevron"
      class:has-predicate={hasPredicate}
      class:is-sort={isSortColumn}
      onclick={handleFilterChevronClick}
      onmousedown={(e) => e.stopPropagation()}
      title={isSortColumn
        ? `Sort: ${$sheetFilter?.sort_direction ?? ""}`
        : hasPredicate
          ? "Filter applied"
          : "Filter / sort"}
      aria-label="Filter column"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M6 10.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5m-2-3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5m-2-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5"
        />
      </svg>
    </button>
  {/if}
</div>

<style>
  .cell {
    width: 100%;
    /* ``min-height`` (not ``height``) so that a cell with
       ``wrap: wrap`` can grow vertically and stretch its row. The
       flex parent (``.data-row``) defaults to ``align-items: stretch``
       so every cell in the row takes the tallest cell's height. The
       row header does the same — see Grid.svelte. */
    min-height: var(--sheet-row-height);
    /* Per-side user borders ride on ``--cell-border-*`` so the
       ``view-edge-*`` / ``clipboard-edge-*`` classes below can still
       override them. ``buildCellInlineStyle`` skips emission on any
       side that already has a view / clipboard edge so the dashed
       edge stays visible (CELL-GRID-07). */
    border-top: var(--cell-border-top, none);
    border-right: var(--cell-border-right, 1px solid var(--sheet-border));
    border-bottom: var(--cell-border-bottom, 1px solid var(--sheet-border));
    border-left: var(--cell-border-left, none);
    padding: 0 var(--sheet-cell-padding-x);
    display: flex;
    align-items: center;
    /* User-set fillColor lands as ``--cell-fill``; the ``var(...,
       fallback)`` pattern keeps it winning over the state-based
       backgrounds below without needing inline ``background:`` to
       beat their specificity. */
    background: var(--cell-fill, var(--sheet-surface));
    cursor: cell;
    overflow: hidden;
    box-sizing: border-box;
    user-select: none;
    position: relative;
    /* Set once on the cell so .cell-value and .cell-input (which uses
       `font-size: inherit`) render identically — otherwise the input
       inherits Datasette's body font-size (16px) and the editing cell
       looks bigger than its neighbors. */
    font-size: var(--sheet-font-size);
  }

  .cell:hover {
    background: var(--cell-fill, var(--sheet-hover-bg));
  }

  .cell.selected {
    z-index: 1;
    background: var(--cell-fill, var(--sheet-selected-bg));
  }

  /* Selection border is drawn as a pseudo-element inside the cell rather
     than as an outline. An outline with negative offset got visually eaten
     by the left-neighbor's 1px right-border; this pseudo sits entirely
     inside the cell (at z-index above the <input>) so all four sides look
     symmetric, whether the cell is idle or editing. */
  .cell.selected::after {
    content: "";
    position: absolute;
    inset: 0;
    border: 2px solid var(--sheet-accent);
    pointer-events: none;
    box-sizing: border-box;
    z-index: 10;
  }

  /* While editing, the wrapper carries the focus ring (around the
     expanded content). The cell-bounds ::after would double up at
     the original column width, so suppress it. */
  .cell.selected.editing::after {
    display: none;
  }

  /* Suppress the browser's default focus ring. Arrow-nav calls
     .focus() on the target cell, which triggers Chrome's
     :focus-visible and stacks an extra rounded outline on top of
     ::after, making keyboard-selected cells look subtly different
     from click-selected ones. ::after is our canonical selection
     indicator; it renders the same regardless of focus mechanism. */
  .cell:focus,
  .cell:focus-visible {
    outline: none;
  }

  .cell.highlighted {
    background: var(--cell-fill, var(--sheet-highlight-bg));
  }

  .cell.ref-highlighted {
    outline: 2px solid var(--ref-color);
    outline-offset: -1px;
    z-index: 1;
  }

  /* Fill only while the caret is inside an unclosed function call
     (``=SUM(B:B`` vs ``=SUM(B:B)``) — Google-Sheets parity. Keeping
     the outline either way so you can still see which cells a
     completed formula references; the fill's the "active argument"
     emphasis that disappears once the ``)`` closes the call. */
  .cell.ref-highlighted.in-open-call {
    background: var(--cell-fill, color-mix(in srgb, var(--ref-color) 8%, #fff));
  }

  .cell.editing {
    padding: 0;
    user-select: text;
    /* Let the auto-widened wrapper overflow into empty neighbours
       on the right; z-index lifts it above sibling cells so their
       borders / content don't bleed through. */
    overflow: visible;
    z-index: 10;
  }

  .cell.error {
    color: var(--sheet-error);
  }

  /* Spill members — cells populated by another cell's array formula.
     Italicised so it reads as "this isn't what you typed here" and
     tinted muted so the anchor's authored value reads as the source
     of truth. [sheet.cell.spill] */
  .cell.spill-member .cell-value {
    font-style: italic;
    color: var(--sheet-text-secondary, #666);
  }

  /* Spill anchors get a subtle coloured left-edge so users can spot
     the origin of a filled region at a glance. Intentionally subtle
     — the computed value is the main signal. [sheet.cell.spill] */
  .cell.spill-anchor {
    box-shadow: inset 2px 0 0 var(--sheet-accent, #276890);
  }

  .formula-edit-wrapper {
    position: relative;
    /* Grow to the mirror's measured width when it exceeds the
       column, capped so a 1000-char formula doesn't blanket the
       viewport. Native input horizontal scroll kicks in past the
       cap. Floor at the cell width so short formulas in a wide
       column don't leave the input clinging to a few characters of
       space — Google-Sheets parity. */
    width: min(80vw, var(--edit-content-width, 100%));
    min-width: 100%;
    /* ``flex-shrink: 0`` prevents the cell (a flex container) from
       collapsing the wrapper back to the column width. Without this
       the declared ``width`` above is capped by the flex parent's
       content box and the auto-widen is silently a no-op. */
    flex-shrink: 0;
    /* ``align-self: stretch`` overrides the cell's
       ``align-items: center`` so the wrapper fills the cell's full
       height instead of collapsing. */
    align-self: stretch;
    background: var(--sheet-surface);
    /* Focus ring follows the expanded content. ``outline`` sits
       outside box geometry so flex sizing never clips a side — an
       earlier ``border`` attempt lost its bottom edge inside the
       cell's border-box content area. */
    outline: 2px solid var(--sheet-accent);
    outline-offset: -2px;
  }

  .edit-measure {
    position: absolute;
    top: 0;
    left: 0;
    visibility: hidden;
    white-space: pre;
    font-family: var(--sheet-font);
    font-size: var(--sheet-font-size);
    /* Match ``.cell-input`` padding so offsetWidth already includes
       both sides of horizontal padding. */
    padding: 0 var(--sheet-cell-padding-x);
    pointer-events: none;
  }

  .formula-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 0 var(--sheet-cell-padding-x);
    /* line-height (not flex) centers the text vertically. Flex
       treats each child span as a flex item, which on some
       platforms introduces tiny inter-item gaps that don't exist
       in the mirror's plain text layout; that mismatch is what
       made the caret sit visibly past the last visible character. */
    line-height: var(--sheet-row-height);
    font-family: var(--sheet-font);
    font-size: var(--sheet-font-size);
    white-space: nowrap;
    pointer-events: none;
    color: var(--sheet-text);
  }

  .cell-input {
    width: 100%;
    height: 100%;
    border: none;
    outline: none;
    font-family: var(--sheet-font);
    font-size: inherit;
    padding: 0 var(--sheet-cell-padding-x);
    background: var(--sheet-surface);
    color: var(--sheet-text);
  }

  .cell-input.has-overlay {
    color: transparent;
    caret-color: var(--sheet-text);
  }

  /* Named-range autocomplete popup. Fixed-positioned so it escapes
     the cell's overflow clip; its top/left are computed from the
     input's bounding rect when the popup opens. */
  .autocomplete-popup {
    position: fixed;
    padding: 2px 0;
    min-width: 140px;
    max-height: 180px;
    overflow-y: auto;
    z-index: var(--z-modal);
    font-size: 12px;
    font-family: var(--sheet-font, monospace);
  }

  .autocomplete-item {
    display: block;
    width: 100%;
    padding: 4px 10px;
    background: none;
    border: none;
    text-align: left;
    color: var(--sheet-text, #111);
    font: inherit;
    cursor: pointer;
  }

  .autocomplete-item:hover,
  .autocomplete-item.active {
    background: var(--sheet-active-bg, #e8edf2);
  }

  .cell-value {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: var(--sheet-font-size);
    font-family: var(--sheet-font);
    color: var(--sheet-text);
    width: 100%;
  }

  /* Wrap mode: the span wraps within the column width and the cell
     grows vertically to fit. Row height is driven by the tallest cell
     thanks to the flex-row's ``align-items: stretch``. Padding above
     and below keeps text from touching the borders once the cell is
     multi-line. [sheet.format.wrap] */
  .cell.wrap-wrap {
    align-items: flex-start;
    padding-top: 2px;
    padding-bottom: 2px;
  }

  .cell.wrap-wrap .cell-value {
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }

  /* Clip mode: no ellipsis, hard clip. One character more than
     ``overflow`` (the default) but less confusing than the "..." —
     matches Google Sheets' "Clip". [sheet.format.wrap] */
  .cell.wrap-clip .cell-value {
    text-overflow: clip;
  }

  .cell-value.numeric {
    text-align: right;
    color: var(--sheet-accent);
  }

  /* Booleans render TRUE/FALSE centered in the accent colour so a
     column of flags scans as a flag column at a glance. Same "type
     signal" treatment as numeric, just along the centre axis.
     [sheet.cell.boolean] */
  .cell-value.boolean {
    text-align: center;
    color: var(--sheet-accent);
  }

  /* Engine-typed Custom values (jdate / jtime / jdatetime / jzoned /
     jspan and host-registered handlers) render right-aligned in the
     accent colour — most custom types behave numerically (date math
     produces spans), so the same "type signal" treatment as numeric
     keeps the column legible. Explicit hAlign on the cell still wins
     via document order. [sheet.cell.custom] */
  .cell-value.custom {
    text-align: right;
    color: var(--sheet-accent);
  }

  /* Dropdown chip cell: a pill (or row of pills, multi-select) +
     caret. The pill takes its background from the option's color.
     Values not in the rule's option list show as muted "invalid"
     chips so the user can see and clear bad data.
     [sheet.data.dropdown] */
  .cell-dropdown {
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0 4px 0 2px;
    border: none;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 4px;
    cursor: pointer;
    font: inherit;
    color: inherit;
    overflow: hidden;
  }
  .cell-dropdown:hover {
    background: var(--sheet-hover-bg);
  }
  .dropdown-chips {
    display: inline-flex;
    flex-wrap: nowrap;
    gap: 3px;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
  .dropdown-chip {
    display: inline-block;
    padding: 1px 8px;
    border-radius: 9999px;
    font-size: 11px;
    line-height: 14px;
    color: #1a1a1a;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    /* ``flex-shrink: 0`` so chips keep their natural width during
       measurement — the ``fitChips`` action measures
       ``offsetWidth`` and decides which chips to hide. If they
       shrunk-to-fit instead, the action would always think
       everything fits and never trigger overflow. ``max-width:
       100%`` then caps a single oversize chip so it ellipsises
       inside the cell instead of overflowing horizontally. */
    flex-shrink: 0;
    max-width: 100%;
  }
  .dropdown-chip-overflow {
    flex-shrink: 0;
    padding: 1px 6px;
    border-radius: 9999px;
    background: var(--sheet-border-light, #eee);
    color: var(--sheet-text-secondary, #666);
    font-size: 10px;
    line-height: 14px;
    font-weight: 600;
  }
  .dropdown-chip.invalid {
    background: var(--sheet-border-light, #eee);
    color: var(--sheet-error, #d00);
    border: 1px dashed var(--sheet-error, #d00);
    padding: 0 7px;
  }
  .dropdown-caret {
    flex-shrink: 0;
    color: var(--sheet-text-secondary, #666);
    opacity: 0.6;
    margin-left: 2px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }
  .cell-dropdown:hover .dropdown-caret {
    opacity: 1;
  }
  /* Empty state: full-opacity dark caret on the right edge — same
     position as the filled state, just more visible so the cell
     reads as clickable. No pill background; the cell hover already
     does that work. */
  .dropdown-caret.empty {
    color: var(--sheet-text, #111);
    opacity: 1;
  }

  /* Interactive checkbox replacing the text rendering. Centred in
     the cell, ~14×14 with a 2px border; checked state fills with the
     accent colour and shows a ✓. Click toggles via
     ``handleCheckboxToggle``. [sheet.format.checkbox] */
  .cell-checkbox {
    margin: 0 auto;
    width: 14px;
    height: 14px;
    padding: 0;
    border: 1.5px solid var(--sheet-border, #999);
    border-radius: 2px;
    background: var(--sheet-surface, #fff);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    color: #fff;
    font-size: 11px;
    font-weight: 700;
  }
  .cell-checkbox.checked {
    background: var(--sheet-accent, #276890);
    border-color: var(--sheet-accent, #276890);
  }
  .cell-checkbox:hover {
    border-color: var(--sheet-accent, #276890);
  }
  .cell-checkbox:focus-visible {
    outline: 2px solid var(--sheet-accent, #276890);
    outline-offset: 1px;
  }
  .check-glyph {
    pointer-events: none;
  }

  /* Explicit alignment overrides the auto-numeric rule above. The
     accent colour goes with the auto rule — once the user has made
     an alignment choice, the cell is no longer "just a number", so
     render it in the default text colour. [sheet.format.h-align] */
  .cell-value.h-left {
    text-align: left;
    color: var(--sheet-text);
  }
  .cell-value.h-center {
    text-align: center;
    color: var(--sheet-text);
  }
  .cell-value.h-right {
    text-align: right;
    color: var(--sheet-text);
  }

  /* Vertical alignment maps to the outer flex container's
     ``align-items``; default is ``center``. Keep .cell.editing
     centered regardless so the input box sits in its usual spot.
     [sheet.format.v-align] */
  .cell.v-top {
    align-items: flex-start;
  }
  .cell.v-middle {
    align-items: center;
  }
  .cell.v-bottom {
    align-items: flex-end;
  }

  .cell-value.bold {
    font-weight: 700;
  }

  .cell-value.italic {
    font-style: italic;
  }

  /* Underline + strikethrough stack in a single text-decoration value.
     Using two independent declarations would make the second overwrite
     the first — apply both when both flags are on. */
  .cell-value.underline {
    text-decoration: underline;
  }

  .cell-value.strikethrough {
    text-decoration: line-through;
  }

  .cell-value.underline.strikethrough {
    text-decoration: underline line-through;
  }

  /* Hyperlink affordance for URL-valued cells. The cell text stays a
     plain span so click-to-select / right-click-menu still work; the
     tiny ↗ icon is the actual <a target="_blank"> so the link only
     fires when the user clicks it deliberately. Hover reveals at
     full opacity; otherwise it sits muted so it doesn't compete with
     the text. */
  .cell-link {
    position: absolute;
    top: 0;
    right: 2px;
    height: 100%;
    display: flex;
    align-items: center;
    padding: 0 4px;
    font-size: 11px;
    line-height: 1;
    color: var(--sheet-accent, #276890);
    text-decoration: none;
    opacity: 0.55;
    cursor: pointer;
    z-index: 3;
  }

  .cell-link:hover,
  .cell:hover .cell-link,
  .cell.selected .cell-link {
    opacity: 1;
    text-decoration: underline;
  }

  .cell.remote-cursor {
    outline: 2px solid var(--remote-color);
    outline-offset: -1px;
    z-index: 1;
  }

  .cell.remote-selection {
    background: var(
      --cell-fill,
      color-mix(in srgb, var(--remote-color) 10%, #fff)
    );
  }

  .presence-label {
    position: absolute;
    top: -14px;
    left: -1px;
    font-size: 10px;
    line-height: 13px;
    padding: 0 3px;
    color: #fff;
    border-radius: 2px 2px 0 0;
    white-space: nowrap;
    pointer-events: none;
    z-index: 2;
  }

  .cell.view-edge-top {
    border-top: 1.5px dashed var(--view-color, #6366f1);
  }
  .cell.view-edge-bottom {
    border-bottom: 1.5px dashed var(--view-color, #6366f1);
  }
  .cell.view-edge-left {
    border-left: 1.5px dashed var(--view-color, #6366f1);
  }
  .cell.view-edge-right {
    border-right: 1.5px dashed var(--view-color, #6366f1);
  }

  /* [sheet.filter.border] Solid 2px outline on the outer perimeter
     of the filter rectangle. Distinguishable from the view's dashed
     outline by being solid + thicker. Stacks over view edges
     because filter rules come later in the cascade — when a view
     and a filter share an edge, the filter's solid green wins. */
  .cell.filter-edge-top {
    border-top: 2px solid var(--sheet-filter-border, #1a7f37);
  }
  .cell.filter-edge-bottom {
    border-bottom: 2px solid var(--sheet-filter-border, #1a7f37);
  }
  .cell.filter-edge-left {
    border-left: 2px solid var(--sheet-filter-border, #1a7f37);
  }
  .cell.filter-edge-right {
    border-right: 2px solid var(--sheet-filter-border, #1a7f37);
  }
  /* [sheet.filter.header-bold] Light green tint + bold on the
     header row inside the filter. Background stays subordinate to
     ``--cell-fill`` so user-set fills still win. */
  .cell.filter-header {
    background: var(--sheet-filter-header-bg, #def0d8);
  }
  .cell.filter-header .cell-value {
    font-weight: 600;
  }
  /* [sheet.filter.column-icon] Chevron in the right edge of every
     filter header cell. Tinted green when an active predicate or
     sort exists on the column; muted otherwise. The button itself
     is a flexed 18×18 square so the SVG center aligns nicely with
     the cell-value text. ``z-index: 1`` lifts it above .cell-value
     so a long header text doesn't render on top of the icon. */
  .filter-chevron {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--sheet-text-muted, #5f6b7a);
    border-radius: 3px;
    z-index: 1;
  }
  .filter-chevron:hover {
    background: rgba(0, 0, 0, 0.06);
  }
  .filter-chevron.is-sort {
    color: var(--sheet-filter-border, #1a7f37);
  }
  /* Active predicate ⇒ filled dark bg so the column reads as
     "filtered" at a glance without opening the popover. Sort-only
     stays as a green tint (less visually loud than a filled chip). */
  .filter-chevron.has-predicate {
    background: var(--sheet-filter-border, #1a7f37);
    color: #fff;
  }
  .filter-chevron.has-predicate:hover {
    background: var(--sheet-filter-border, #1a7f37);
    filter: brightness(0.9);
  }

  /* Clipboard marker (Cmd+C or Cmd+X pending) — dashed border on the
     outer edges of the range only. Survives clicking away; cleared
     on Esc, fresh copy/cut, sheet switch, or (for cut) paste. */
  .cell.clipboard-edge-top {
    border-top: 1.5px dashed var(--sheet-accent);
  }
  .cell.clipboard-edge-bottom {
    border-bottom: 1.5px dashed var(--sheet-accent);
  }
  .cell.clipboard-edge-left {
    border-left: 1.5px dashed var(--sheet-accent);
  }
  .cell.clipboard-edge-right {
    border-right: 1.5px dashed var(--sheet-accent);
  }

  .view-triangle {
    position: absolute;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
    border-style: solid;
    border-width: 10px 10px 0 0;
    cursor: pointer;
    z-index: 3;
  }

  .view-triangle:hover {
    opacity: 0.8;
  }
</style>
