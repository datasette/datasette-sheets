// Inline-style payload for the cell root <div>. Builds a CSS-variable
// declaration string (no raw `background:` / `border-*:` shorthands)
// so the .cell stylesheet stays in charge of the actual cascade. See
// CELL-GRID-07 in frontend_review/ for the bug this replaces — inline
// `border-*:` was silently winning over `.cell.view-edge-*` and
// `.cell.clipboard-edge-*` classes.

import type { CellBorders } from "./types";

export interface CellStyleInputs {
  refColor: string | null;
  remoteCursor: { color: string } | null;
  remoteSelection: { color: string } | null;
  viewMeta: { color: string } | null;
  fillColor: string | null;
  borders: CellBorders | null;
  isEditing: boolean;
  // Per-side flags telling us a view / clipboard edge already paints
  // this side. We skip the user border there so the edge stays
  // visible — the conservative half of CELL-GRID-07's fix.
  viewEdgeTop?: boolean;
  viewEdgeRight?: boolean;
  viewEdgeBottom?: boolean;
  viewEdgeLeft?: boolean;
  clipboardEdgeTop?: boolean;
  clipboardEdgeRight?: boolean;
  clipboardEdgeBottom?: boolean;
  clipboardEdgeLeft?: boolean;
}

function borderShorthand(edge: { style: string; color: string }): string {
  return `1.5px ${edge.style} ${edge.color}`;
}

export function buildCellInlineStyle(inputs: CellStyleInputs): string {
  const parts: string[] = [];

  if (inputs.refColor && !inputs.isEditing) {
    parts.push(`--ref-color: ${inputs.refColor};`);
  }

  const remote = inputs.remoteCursor ?? inputs.remoteSelection;
  if (remote) {
    parts.push(`--remote-color: ${remote.color};`);
  }

  if (inputs.viewMeta) {
    parts.push(`--view-color: ${inputs.viewMeta.color};`);
  }

  if (inputs.fillColor) {
    parts.push(`--cell-fill: ${inputs.fillColor};`);
  }

  const b = inputs.borders;
  if (b) {
    // Sides covered by a view / clipboard edge keep the class-driven
    // dashed border instead of being overwritten by the user's edge.
    if (b.top && !inputs.viewEdgeTop && !inputs.clipboardEdgeTop) {
      parts.push(`--cell-border-top: ${borderShorthand(b.top)};`);
    }
    if (b.right && !inputs.viewEdgeRight && !inputs.clipboardEdgeRight) {
      parts.push(`--cell-border-right: ${borderShorthand(b.right)};`);
    }
    if (b.bottom && !inputs.viewEdgeBottom && !inputs.clipboardEdgeBottom) {
      parts.push(`--cell-border-bottom: ${borderShorthand(b.bottom)};`);
    }
    if (b.left && !inputs.viewEdgeLeft && !inputs.clipboardEdgeLeft) {
      parts.push(`--cell-border-left: ${borderShorthand(b.left)};`);
    }
  }

  return parts.join("");
}
