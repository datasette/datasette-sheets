import { expect, test } from "vitest";
import { tick } from "svelte";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import BorderPicker from "../BorderPicker.svelte";
import type { CellBorders } from "../../spreadsheet/types";

// [tests-08] BorderPicker has nine presets that produce distinct
// CellBorders payloads. Each preset's payload shape is what the
// rest of the format pipeline assumes. Pin them.

function presetButton(label: string): HTMLButtonElement {
  const btn = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".preset-item"),
  ).find((b) => b.textContent?.trim().startsWith(label));
  if (!btn) throw new Error(`preset "${label}" not found`);
  return btn;
}

async function dispatchAndCapture(
  props: { color?: string; style?: "solid" | "dashed" | "dotted" } = {},
): Promise<{
  events: (CellBorders | null)[];
}> {
  const events: (CellBorders | null)[] = [];
  render(BorderPicker, {
    props: {
      ...props,
      onchange: (payload: CellBorders | null) => events.push(payload),
    },
  });
  await tick();
  return { events };
}

test("'All' preset emits every edge with the active color + style", async () => {
  const { events } = await dispatchAndCapture({
    color: "#ff0000",
    style: "solid",
  });
  await userEvent.click(presetButton("All"));
  expect(events).toEqual([
    {
      top: { style: "solid", color: "#ff0000" },
      right: { style: "solid", color: "#ff0000" },
      bottom: { style: "solid", color: "#ff0000" },
      left: { style: "solid", color: "#ff0000" },
    },
  ]);
});

test("'Outer' on a single cell collapses to All (every edge)", async () => {
  const { events } = await dispatchAndCapture({
    color: "#000000",
    style: "dashed",
  });
  await userEvent.click(presetButton("Outer"));
  expect(events.length).toBe(1);
  expect(Object.keys(events[0]!).sort()).toEqual([
    "bottom",
    "left",
    "right",
    "top",
  ]);
  expect(events[0]).toEqual({
    top: { style: "dashed", color: "#000000" },
    right: { style: "dashed", color: "#000000" },
    bottom: { style: "dashed", color: "#000000" },
    left: { style: "dashed", color: "#000000" },
  });
});

test.each<[string, keyof Required<CellBorders>]>([
  ["Top", "top"],
  ["Right", "right"],
  ["Bottom", "bottom"],
  ["Left", "left"],
])("'%s' preset emits a single-edge payload", async (label, side) => {
  const { events } = await dispatchAndCapture({
    color: "#0000ff",
    style: "solid",
  });
  await userEvent.click(presetButton(label));
  expect(events.length).toBe(1);
  const payload = events[0]!;
  expect(Object.keys(payload).sort()).toEqual([side]);
  expect((payload as Record<string, unknown>)[side]).toEqual({
    style: "solid",
    color: "#0000ff",
  });
});

test("'Top + bottom' emits exactly top + bottom edges", async () => {
  const { events } = await dispatchAndCapture({
    color: "#aa00aa",
    style: "dotted",
  });
  await userEvent.click(presetButton("Top + bottom"));
  expect(events.length).toBe(1);
  expect(events[0]).toEqual({
    top: { style: "dotted", color: "#aa00aa" },
    bottom: { style: "dotted", color: "#aa00aa" },
  });
});

test("'Left + right' emits exactly left + right edges", async () => {
  const { events } = await dispatchAndCapture({
    color: "#00aaaa",
    style: "solid",
  });
  await userEvent.click(presetButton("Left + right"));
  expect(events.length).toBe(1);
  expect(events[0]).toEqual({
    left: { style: "solid", color: "#00aaaa" },
    right: { style: "solid", color: "#00aaaa" },
  });
});

test("'Clear' emits null (no edges payload)", async () => {
  const { events } = await dispatchAndCapture();
  await userEvent.click(presetButton("Clear"));
  expect(events).toEqual([null]);
});

test("changing the style select then picking 'All' uses the updated style", async () => {
  const { events } = await dispatchAndCapture({
    color: "#123456",
    style: "solid",
  });
  // Drive the style select directly — the component binds to it via
  // ``bind:value``, so the next preset click picks up the change.
  const select = document.querySelector<HTMLSelectElement>(
    ".border-picker select",
  )!;
  select.value = "dashed";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await tick();
  await userEvent.click(presetButton("All"));
  expect(events.length).toBe(1);
  for (const side of ["top", "right", "bottom", "left"] as const) {
    expect(
      (events[0] as Record<string, { style: string; color: string }>)[side],
    ).toEqual({ style: "dashed", color: "#123456" });
  }
});
