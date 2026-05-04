import { test, expect } from "@playwright/test";
import {
  gotoSheets,
  selectCell,
  getCell,
  expectCellValue,
  pasteHtml,
  pasteTsv,
  waitForAutoSave,
} from "./helpers";

const HTML_TABLE = `<table>
<thead><tr><th>Gas Station</th><th>Price</th><th>Coffee Shop</th><th>Price</th></tr></thead>
<tbody>
<tr><td>chevron beverly/norwalk</td><td>6.279</td><td>mundae</td><td>6.50</td></tr>
<tr><td>super 8 whittier/norwalk</td><td>5.359</td><td>bark</td><td>5.05</td></tr>
<tr><td>arco pickering/hadley</td><td>5.499</td><td>favorite</td><td>6.75</td></tr>
</tbody>
</table>`;

const TSV_DATA = "Name\tAge\tCity\nAlice\t30\tNYC\nBob\t25\tLA";

// Google Sheets style: inline font-weight:bold on header cells
const GOOGLE_SHEETS_HTML = `<google-sheets-html-origin><table>
<tbody>
<tr><td style="font-weight:bold;">name</td><td style="font-weight:bold;">age</td><td style="font-weight:bold;">ratio</td></tr>
<tr><td>alex</td><td>10</td><td>10.00%</td></tr>
<tr><td>Brian</td><td>22</td><td>22.00%</td></tr>
</tbody>
</table>`;

test("paste HTML table into grid", async ({ page }) => {
  await gotoSheets(page);
  await selectCell(page, "A1");

  await pasteHtml(page, HTML_TABLE, { plain: "fallback" });

  // Headers
  await expectCellValue(page, "A1", "Gas Station");
  await expectCellValue(page, "B1", "Price");
  await expectCellValue(page, "C1", "Coffee Shop");
  await expectCellValue(page, "D1", "Price");

  // Data rows
  await expectCellValue(page, "A2", "chevron beverly/norwalk");
  await expectCellValue(page, "B2", "6.279");
  await expectCellValue(page, "C2", "mundae");
  await expectCellValue(page, "D2", "6.5");

  await expectCellValue(page, "A3", "super 8 whittier/norwalk");
  await expectCellValue(page, "B3", "5.359");

  await expectCellValue(page, "A4", "arco pickering/hadley");
  await expectCellValue(page, "D4", "6.75");
});

test("paste HTML table at offset position", async ({ page }) => {
  await gotoSheets(page);
  await selectCell(page, "C3");

  await pasteHtml(page, HTML_TABLE);

  // Headers start at C3
  await expectCellValue(page, "C3", "Gas Station");
  await expectCellValue(page, "D3", "Price");
  await expectCellValue(page, "E3", "Coffee Shop");
  await expectCellValue(page, "F3", "Price");

  // First data row at C4
  await expectCellValue(page, "C4", "chevron beverly/norwalk");
  await expectCellValue(page, "D4", "6.279");
});

test("paste TSV data", async ({ page }) => {
  await gotoSheets(page);
  await selectCell(page, "A1");

  await pasteTsv(page, TSV_DATA);

  await expectCellValue(page, "A1", "Name");
  await expectCellValue(page, "B1", "Age");
  await expectCellValue(page, "C1", "City");
  await expectCellValue(page, "A2", "Alice");
  await expectCellValue(page, "B2", "30");
  await expectCellValue(page, "C2", "NYC");
  await expectCellValue(page, "A3", "Bob");
});

test("pasted data persists across reload", async ({ page }) => {
  await gotoSheets(page);
  await selectCell(page, "A1");

  await pasteHtml(page, HTML_TABLE);

  await waitForAutoSave(page, 3000);

  await page.reload();
  await expect(page.locator(".sheets-root")).toBeVisible({ timeout: 5000 });

  await expectCellValue(page, "A1", "Gas Station");
  await expectCellValue(page, "B2", "6.279");
  await expectCellValue(page, "D4", "6.75");
});

test("paste from Google Sheets preserves bold headers", async ({ page }) => {
  await gotoSheets(page);
  await selectCell(page, "A1");

  await pasteHtml(page, GOOGLE_SHEETS_HTML);

  // Values
  await expectCellValue(page, "A1", "name");
  await expectCellValue(page, "B1", "age");
  await expectCellValue(page, "C1", "ratio");
  await expectCellValue(page, "A2", "alex");
  await expectCellValue(page, "B2", "10");

  // Bold headers (from inline font-weight:bold)
  await expect(getCell(page, "A1").locator(".cell-value")).toHaveClass(/bold/);
  await expect(getCell(page, "B1").locator(".cell-value")).toHaveClass(/bold/);
  await expect(getCell(page, "C1").locator(".cell-value")).toHaveClass(/bold/);

  // Data rows not bold
  await expect(getCell(page, "A2").locator(".cell-value")).not.toHaveClass(
    /bold/,
  );
});

test("paste <th> headers are bold", async ({ page }) => {
  await gotoSheets(page);
  await selectCell(page, "A1");

  // Obsidian/standard HTML with <th>
  await pasteHtml(page, HTML_TABLE);

  // <th> headers should be bold
  await expect(getCell(page, "A1").locator(".cell-value")).toHaveClass(/bold/);
  await expect(getCell(page, "B1").locator(".cell-value")).toHaveClass(/bold/);

  // <td> data rows not bold
  await expect(getCell(page, "A2").locator(".cell-value")).not.toHaveClass(
    /bold/,
  );
});
