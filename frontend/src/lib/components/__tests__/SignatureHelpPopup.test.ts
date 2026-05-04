import { expect, test, describe } from "vitest";
import { render } from "vitest-browser-svelte";
import SignatureHelpPopup from "../SignatureHelpPopup.svelte";
import type { FnInfo } from "../../spreadsheet/formula-helpers";

// Pure component tests — SignatureHelpPopup takes props and renders.
// No stores, no backend, no edit mode. Exercises the signature
// formatting rules directly:
//   - optional params carry a trailing `?`
//   - variadic/repeatable params carry a leading `…`
//   - the "active" arg gets .active (bold + underline)
//   - repeatable tail stays active for any arg past its index
//   - summary shows when present, stays absent otherwise

function mount(info: FnInfo, argIndex: number) {
  // The popup pins itself to an anchor via the ``anchorTo`` action,
  // so create a stand-in anchor at a fixed position. The action's
  // ``getAnchor`` callback returns this element on every reposition.
  const anchor = document.createElement("div");
  anchor.style.position = "fixed";
  anchor.style.top = "100px";
  anchor.style.left = "50px";
  anchor.style.width = "120px";
  anchor.style.height = "20px";
  document.body.appendChild(anchor);
  render(SignatureHelpPopup, {
    props: { info, argIndex, getAnchor: () => anchor },
  });
  return document.querySelector<HTMLElement>(".signature-popup")!;
}

function paramTexts(popup: HTMLElement): string[] {
  return Array.from(popup.querySelectorAll(".param")).map(
    (el) => el.textContent ?? "",
  );
}

function activeParam(popup: HTMLElement): HTMLElement | null {
  return popup.querySelector<HTMLElement>(".param.active");
}

const sumInfo: FnInfo = {
  name: "SUM",
  params: [
    { name: "value1" },
    { name: "value2", optional: true, repeatable: true },
  ],
  summary: "Sum of a set of numbers and/or cells.",
};

const roundInfo: FnInfo = {
  name: "ROUND",
  params: [{ name: "value" }, { name: "decimals", optional: true }],
  summary: "Round to a given number of decimal places (default 0).",
};

const ifInfo: FnInfo = {
  name: "IF",
  params: [
    { name: "condition" },
    { name: "value_if_true" },
    { name: "value_if_false", optional: true },
  ],
  summary: "Return one value when the condition is TRUE, another when FALSE.",
};

const noSummaryInfo: FnInfo = {
  name: "ABS",
  params: [{ name: "value" }],
  summary: "",
};

describe("param formatting", () => {
  test("required param renders verbatim", () => {
    const popup = mount(roundInfo, 0);
    expect(paramTexts(popup)).toEqual(["value", "decimals?"]);
  });

  test("optional param carries a trailing `?`", () => {
    const popup = mount(ifInfo, 0);
    expect(paramTexts(popup)[2]).toBe("value_if_false?");
  });

  test("variadic param carries a leading `…`", () => {
    const popup = mount(sumInfo, 0);
    expect(paramTexts(popup)[1]).toBe("…value2");
  });

  test("signature text includes the function name", () => {
    const popup = mount(sumInfo, 0);
    expect(popup.textContent).toContain("SUM");
  });
});

describe("active arg highlighting", () => {
  test("active at index 0 bolds the first param", () => {
    const popup = mount(ifInfo, 0);
    expect(activeParam(popup)?.textContent).toBe("condition");
  });

  test("active at middle index bolds that param", () => {
    const popup = mount(ifInfo, 1);
    expect(activeParam(popup)?.textContent).toBe("value_if_true");
  });

  test("active at last (optional) param bolds it", () => {
    const popup = mount(ifInfo, 2);
    expect(activeParam(popup)?.textContent).toBe("value_if_false?");
  });

  test("active past last non-repeatable index has no active class", () => {
    const popup = mount(ifInfo, 99);
    // IF's params are all non-repeatable, so argIndex past the end
    // leaves nothing highlighted.
    expect(activeParam(popup)).toBeNull();
  });

  test("repeatable tail stays active for any arg past its index", () => {
    // SUM has value1 (idx 0) then repeatable value2 (idx 1).
    // argIndex 7 → user is typing the 8th arg → still value2.
    const popup = mount(sumInfo, 7);
    expect(activeParam(popup)?.textContent).toBe("…value2");
  });

  test("argIndex 0 on a variadic catalog bolds the first param, not the tail", () => {
    const popup = mount(sumInfo, 0);
    expect(activeParam(popup)?.textContent).toBe("value1");
  });
});

describe("optional styling", () => {
  test("optional params get the .optional class", () => {
    const popup = mount(ifInfo, 0);
    const params = popup.querySelectorAll<HTMLElement>(".param");
    expect(params[0].classList.contains("optional")).toBe(false);
    expect(params[1].classList.contains("optional")).toBe(false);
    expect(params[2].classList.contains("optional")).toBe(true);
  });
});

describe("summary", () => {
  test("renders when the info carries one", () => {
    const popup = mount(ifInfo, 0);
    expect(popup.querySelector(".summary")?.textContent).toBe(ifInfo.summary);
  });

  test("omitted when summary is an empty string", () => {
    const popup = mount(noSummaryInfo, 0);
    expect(popup.querySelector(".summary")).toBeNull();
  });
});

describe("positioning", () => {
  test("anchors above the supplied target via ``getAnchor``", () => {
    // The popup uses ``placement: 'above'`` internally — it pins
    // ``top`` to the anchor's ``rect.top`` and the popup's own
    // ``transform: translateY(-100%)`` lifts it above visually.
    const anchor = document.createElement("div");
    anchor.style.position = "fixed";
    anchor.style.top = "137px";
    anchor.style.left = "42px";
    anchor.style.width = "100px";
    anchor.style.height = "20px";
    document.body.appendChild(anchor);
    render(SignatureHelpPopup, {
      props: { info: roundInfo, argIndex: 0, getAnchor: () => anchor },
    });
    const popup = document.querySelector<HTMLElement>(".signature-popup")!;
    expect(parseFloat(popup.style.top)).toBeCloseTo(137, 0);
    // ``left`` may be clamped down by the right-edge guard if the
    // viewport is narrow; on a normally-sized test viewport it
    // matches the anchor's left edge.
    expect(parseFloat(popup.style.left)).toBeLessThanOrEqual(42);
  });
});
