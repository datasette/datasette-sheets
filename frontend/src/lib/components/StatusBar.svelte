<script lang="ts">
  import { selectionStats, selectedCells } from "../stores/spreadsheet";

  type StatKind = "sum" | "avg" | "min" | "max";
  const STAT_STORAGE_KEY = "datasette-sheets.status-stat";
  // Preserve insertion order — same order appears in the dropdown.
  const STAT_OPTIONS: ReadonlyArray<{ kind: StatKind; label: string }> = [
    { kind: "sum", label: "Sum" },
    { kind: "avg", label: "Avg" },
    { kind: "min", label: "Min" },
    { kind: "max", label: "Max" },
  ];

  // Persist the user's choice across sessions — matches Google
  // Sheets, where the bottom-bar summary remembers what you picked.
  // [sheet.status-bar.stat-picker]
  let statKind: StatKind = $state(readInitialStat());

  function readInitialStat(): StatKind {
    try {
      const raw = localStorage.getItem(STAT_STORAGE_KEY);
      if (raw === "sum" || raw === "avg" || raw === "min" || raw === "max") {
        return raw;
      }
    } catch {
      // localStorage can throw (private browsing, disabled, etc.) —
      // just fall back to the default.
    }
    return "avg";
  }

  $effect(() => {
    try {
      localStorage.setItem(STAT_STORAGE_KEY, statKind);
    } catch {
      // ignore persistence failures
    }
  });

  let pickedValue = $derived(
    $selectionStats
      ? $selectionStats[
          statKind === "avg" ? "average" : (statKind as "sum" | "min" | "max")
        ]
      : null,
  );
</script>

<div class="status-bar">
  {#if $selectionStats}
    <div class="stats">
      <span class="stat">
        <span class="stat-label">Count</span>
        <span class="stat-value">{$selectionStats.count}</span>
      </span>
      <span class="stat">
        <select
          bind:value={statKind}
          class="stat-select"
          aria-label="Statistic to display"
        >
          {#each STAT_OPTIONS as opt (opt.kind)}
            <option value={opt.kind}>{opt.label}</option>
          {/each}
        </select>
        <span class="stat-value"
          >{pickedValue !== null
            ? pickedValue.toLocaleString("en-US", {
                maximumFractionDigits: 4,
              })
            : "—"}</span
        >
      </span>
    </div>
    <!-- [sheet.status-bar.count-only] -->
  {:else if $selectedCells.size > 1}
    <div class="stats muted">
      <span>{$selectedCells.size} cells selected</span>
    </div>
  {/if}
</div>

<style>
  .status-bar {
    height: 28px;
    display: flex;
    align-items: center;
    padding: 0 8px;
    background: var(--sheet-header-bg);
    border: 1px solid var(--sheet-border-strong);
    border-top: none;
    border-bottom-left-radius: 4px;
    border-bottom-right-radius: 4px;
    font-family: var(--sheet-font);
    font-size: 13px;
    color: var(--sheet-text);
  }

  .stats {
    display: flex;
    gap: 16px;
    width: 100%;
    justify-content: flex-end;
  }

  .stats.muted {
    color: var(--sheet-text-secondary);
  }

  .stat {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .stat-label {
    color: var(--sheet-text-secondary);
  }

  .stat-value {
    font-weight: 600;
    color: var(--sheet-accent);
  }

  .stat-select {
    font-family: var(--sheet-font);
    font-size: 13px;
    color: var(--sheet-text-secondary);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 3px;
    padding: 0 4px;
    cursor: pointer;
  }

  .stat-select:hover,
  .stat-select:focus {
    border-color: var(--sheet-border-strong);
    outline: none;
  }
</style>
