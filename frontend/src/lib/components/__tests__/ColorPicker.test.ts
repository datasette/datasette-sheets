import { expect, test } from "vitest";
import { tick } from "svelte";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import ColorPicker from "../ColorPicker.svelte";
import { CATEGORICAL_PALETTE } from "../../spreadsheet/palettes";

// [tests-08] ColorPicker is reused across the toolbar (text +
// fill), the FormatMenu submenus, and the DropdownRuleEditor chip
// editor. The component dispatches ``change`` with ``string | null`` —
// the null branch (Reset) is critical: getting it wrong silently
// writes ``"null"`` into the format. The DropdownRuleEditor.test.ts
// suite covers the ``nullable={false}`` reuse path; this file pins
// the standalone surface.

function picker(): HTMLElement {
  const el = document.querySelector<HTMLElement>(".color-picker");
  if (!el) throw new Error("color-picker not mounted");
  return el;
}

function paletteSwatches(): HTMLButtonElement[] {
  return Array.from(
    picker().querySelectorAll<HTMLButtonElement>(".swatch"),
  ).filter((b) => !b.classList.contains("reset"));
}

function resetSwatch(): HTMLButtonElement | null {
  return picker().querySelector<HTMLButtonElement>(".swatch.reset");
}

test("clicking a palette swatch dispatches change with the swatch hex", async () => {
  const events: (string | null)[] = [];
  render(ColorPicker, {
    props: {
      value: null,
      label: "Test color",
      onchange: (color: string | null) => events.push(color),
    },
  });
  const swatches = paletteSwatches();
  expect(swatches.length).toBe(CATEGORICAL_PALETTE.length);
  // Pick the second hue so we don't collide with the default null state.
  const target = swatches[5];
  const expectedHex = target.getAttribute("title")!;
  await userEvent.click(target);
  expect(events).toEqual([expectedHex]);
});

test("clicking Reset dispatches change with strict null (not falsy)", async () => {
  const events: (string | null)[] = [];
  render(ColorPicker, {
    props: {
      value: "#ff0000",
      onchange: (color: string | null) => events.push(color),
    },
  });
  const reset = resetSwatch();
  expect(reset).toBeTruthy();
  await userEvent.click(reset!);
  expect(events.length).toBe(1);
  // Strict identity check — the failure mode we care about is "null"
  // (string) or 0 / undefined / false sneaking through.
  expect(events[0]).toBeNull();
  expect(events[0] === null).toBe(true);
});

test("nullable=false hides the Reset swatch", () => {
  render(ColorPicker, {
    props: { value: "#cccccc", nullable: false },
  });
  expect(resetSwatch()).toBeNull();
  // Palette swatches still rendered.
  expect(paletteSwatches().length).toBe(CATEGORICAL_PALETTE.length);
});

test("custom hex input accepts #rrggbb on Enter and dispatches", async () => {
  const events: (string | null)[] = [];
  render(ColorPicker, {
    props: {
      value: null,
      onchange: (color: string | null) => events.push(color),
    },
  });
  const input = picker().querySelector<HTMLInputElement>(".custom-input")!;
  input.focus();
  // Replace the seeded "#000000" with our value.
  await userEvent.fill(input, "#abcdef");
  await userEvent.keyboard("{Enter}");
  expect(events).toEqual(["#abcdef"]);
});

test("custom hex input accepts shorthand #rgb via the Apply button", async () => {
  const events: (string | null)[] = [];
  render(ColorPicker, {
    props: {
      value: null,
      onchange: (color: string | null) => events.push(color),
    },
  });
  const input = picker().querySelector<HTMLInputElement>(".custom-input")!;
  input.focus();
  await userEvent.fill(input, "#abc");
  const apply = picker().querySelector<HTMLButtonElement>(".custom-apply")!;
  await userEvent.click(apply);
  expect(events).toEqual(["#abc"]);
});

test("custom hex input rejects garbage and does not dispatch", async () => {
  const events: (string | null)[] = [];
  render(ColorPicker, {
    props: {
      value: null,
      onchange: (color: string | null) => events.push(color),
    },
  });
  const input = picker().querySelector<HTMLInputElement>(".custom-input")!;
  input.focus();
  await userEvent.fill(input, "not-a-color");
  await userEvent.keyboard("{Enter}");
  expect(events).toEqual([]);

  // Also reject a hex without the leading # and a 4-char invalid length.
  await userEvent.fill(input, "ff0000");
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(input, "#abcd");
  await userEvent.keyboard("{Enter}");
  expect(events).toEqual([]);
});

test("active value renders the matching swatch with .selected (case-insensitive)", async () => {
  // Use uppercase to verify the case-insensitive comparison the
  // component does between value and palette entries.
  render(ColorPicker, { props: { value: "#FB8C00" } });
  await tick();
  const selected =
    picker().querySelectorAll<HTMLButtonElement>(".swatch.selected");
  expect(selected.length).toBe(1);
  expect(selected[0].getAttribute("title")?.toLowerCase()).toBe("#fb8c00");
});

test("value=null marks the Reset swatch as selected", () => {
  render(ColorPicker, { props: { value: null } });
  const reset = resetSwatch();
  expect(reset).toBeTruthy();
  expect(reset!.classList.contains("selected")).toBe(true);
});
