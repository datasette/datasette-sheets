import { writable, derived } from "svelte/store";

export interface PresenceInfo {
  actor: string;
  displayName: string;
  profilePictureUrl: string | null;
  cursor: { row: number; col: number } | null;
  selection: string[];
  color: string;
  lastSeen: number;
}

// Map of actor ID → presence info
const _presenceMap = writable<Map<string, PresenceInfo>>(new Map());

export const presenceMap = derived(_presenceMap, ($m) => $m);

/** All remote cursors as an array, for rendering */
export const remoteCursors = derived(_presenceMap, ($m) => {
  return Array.from($m.values()).filter((p) => p.cursor !== null);
});

/**
 * [perf] Cell-indexed view of remote presence so ``Cell.svelte`` does
 * O(1) lookups instead of O(users) ``.find()`` calls per cell per
 * presence tick.
 *
 *   ``presenceCursorByCell`` — single PresenceInfo whose cursor is on
 *     the cell. Built by row:col key string (matches ``Cell.svelte``'s
 *     parsed id). If two remote users sit on the same cell, last
 *     writer wins — rare in practice and the previous code returned
 *     the first ``.find()`` match which was also ambiguous.
 *   ``presenceSelectionByCell`` — first PresenceInfo whose selection
 *     list contains the cell. Same rationale as above.
 *
 * Both rebuild on any presence tick. That's fine: presences change at
 * ~1Hz even with many users, and the Cell-side `.find()`s were 1500×
 * per tick — this is 2× Map builds per tick (one for cursors, one
 * for selections), which dominates only once there are thousands of
 * selection cells in presence.
 */
function cursorKey(row: number, col: number): string {
  return `${row}:${col}`;
}

export const presenceCursorByCell = derived(_presenceMap, ($m) => {
  const map = new Map<string, PresenceInfo>();
  for (const p of $m.values()) {
    if (!p.cursor) continue;
    map.set(cursorKey(p.cursor.row, p.cursor.col), p);
  }
  return map;
});

export const presenceSelectionByCell = derived(_presenceMap, ($m) => {
  const map = new Map<string, PresenceInfo>();
  for (const p of $m.values()) {
    for (const id of p.selection) {
      if (!map.has(id)) map.set(id, p);
    }
  }
  return map;
});

/** [perf] Pre-computed row:col key helper so ``Cell.svelte`` can
 *  build the lookup key once per component and reuse it across
 *  the cursor + selection checks. Exported because it needs to
 *  agree with the one used in ``presenceCursorByCell`` above. */
export function presenceKey(row: number, col: number): string {
  return cursorKey(row, col);
}

/** All unique active users (for the user list display) */
export const activeUsers = derived(_presenceMap, ($m) => {
  return Array.from($m.values());
});

export function updatePresence(
  actor: string,
  displayName: string,
  profilePictureUrl: string | null,
  cursor: { row: number; col: number } | null,
  selection: string[],
  color: string,
) {
  _presenceMap.update((m) => {
    const next = new Map(m);
    next.set(actor, {
      actor,
      displayName,
      profilePictureUrl,
      cursor,
      selection,
      color,
      lastSeen: Date.now(),
    });
    return next;
  });
}

export function removePresence(actor: string) {
  _presenceMap.update((m) => {
    const next = new Map(m);
    next.delete(actor);
    return next;
  });
}

/** Remove stale presences (not seen in the last `timeout` ms) */
// [sheet.presence.expiry]
export function cleanStalePresences(timeout = 10000) {
  const now = Date.now();
  _presenceMap.update((m) => {
    const next = new Map(m);
    for (const [actor, info] of next) {
      if (now - info.lastSeen > timeout) {
        next.delete(actor);
      }
    }
    return next;
  });
}

export function clearAllPresences() {
  _presenceMap.set(new Map());
}
