import { beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import Cell from "../Cell.svelte";
import {
  cells,
  editingCell,
  selectedCell,
  selectedCells,
  selectionAnchor,
} from "../../stores/spreadsheet";
import type { CellId } from "../../spreadsheet/types";

// URL-hyperlink affordance: cells whose entire value is a valid
// http(s) URL render a small ``↗`` icon that links out.

beforeEach(() => {
  cells.clear();
  selectedCell.set(null);
  selectionAnchor.set(null);
  selectedCells.set(new Set());
  editingCell.set(null);
});

function mount(cellId: CellId) {
  render(Cell, { props: { cellId } });
}

function linkEl(): HTMLAnchorElement | null {
  return document.querySelector<HTMLAnchorElement>(".cell-link");
}

test("cell whose value is an https URL renders a link to it", async () => {
  cells.setCellValue("A1" as CellId, "https://example.com/foo?q=1");
  mount("A1" as CellId);

  const link = linkEl();
  expect(link).not.toBeNull();
  expect(link!.href).toBe("https://example.com/foo?q=1");
  expect(link!.target).toBe("_blank");
  expect(link!.rel).toContain("noopener");
  expect(link!.rel).toContain("noreferrer");
});

test("cell whose value is an http URL also renders a link", async () => {
  cells.setCellValue("A1" as CellId, "http://localhost:8001/x");
  mount("A1" as CellId);

  expect(linkEl()).not.toBeNull();
});

test("plain text without a URL does not render a link", async () => {
  cells.setCellValue("A1" as CellId, "hello world");
  mount("A1" as CellId);

  expect(linkEl()).toBeNull();
});

test("text that merely contains a URL is not a hyperlink", async () => {
  cells.setCellValue("A1" as CellId, "visit https://example.com today");
  mount("A1" as CellId);

  expect(linkEl()).toBeNull();
});

test("javascript: and file: schemes are rejected", async () => {
  cells.setCellValue("A1" as CellId, "javascript:alert(1)");
  mount("A1" as CellId);
  expect(linkEl()).toBeNull();

  cells.clear();
  cells.setCellValue("A2" as CellId, "file:///etc/passwd");
  mount("A2" as CellId);
  expect(linkEl()).toBeNull();
});

test("editing mode hides the link icon", async () => {
  cells.setCellValue("A1" as CellId, "https://example.com");
  selectedCell.set("A1" as CellId);
  selectionAnchor.set("A1" as CellId);
  selectedCells.set(new Set(["A1" as CellId]));
  editingCell.set("A1" as CellId);
  mount("A1" as CellId);

  expect(linkEl()).toBeNull();
});

test("trailing whitespace disqualifies the URL", async () => {
  cells.setCellValue("A1" as CellId, "https://example.com ");
  mount("A1" as CellId);

  expect(linkEl()).toBeNull();
});
