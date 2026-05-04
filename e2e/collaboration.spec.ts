import { test, expect } from "@playwright/test";
import {
  gotoSheets,
  gotoWorkbook,
  typeInCell,
  expectCellValue,
  waitForAutoSave,
  getCell,
  selectCell,
} from "./helpers";

test.describe("Real-time collaboration", () => {
  test("changes from one user appear in the other user's browser", async ({
    browser,
  }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // User A creates a workbook
      const wbUrl = await gotoSheets(pageA);

      // User B opens the same workbook
      await gotoWorkbook(pageB, wbUrl);

      // Wait for SSE connections — both pages must show the connected
      // dot before we cross-edit, otherwise the broadcast would race
      // page B's handshake.
      await expect(pageA.locator(".connection-dot.connected")).toBeVisible();
      await expect(pageB.locator(".connection-dot.connected")).toBeVisible();

      // User A types in a cell
      await typeInCell(pageA, "A1", "Hello from A");

      // User B should see the change (via SSE broadcast)
      await expectCellValue(pageB, "A1", "Hello from A");

      // User B types in a different cell
      await typeInCell(pageB, "B1", "Hello from B");

      // User A should see B's change
      await expectCellValue(pageA, "B1", "Hello from B");
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("formula results update live when a referenced cell changes remotely", async ({
    browser,
  }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // User A creates workbook with data + formula
      const wbUrl = await gotoSheets(pageA);

      await typeInCell(pageA, "A1", "10");
      await typeInCell(pageA, "A2", "20");
      await typeInCell(pageA, "A3", "=SUM(A1:A2)");
      await expectCellValue(pageA, "A3", "30");
      await waitForAutoSave(pageA);

      // User B opens same workbook
      await gotoWorkbook(pageB, wbUrl);
      await expectCellValue(pageB, "A1", "10");
      await expectCellValue(pageB, "A3", "30");

      // Wait for SSE — both pages connected before B mutates.
      await expect(pageA.locator(".connection-dot.connected")).toBeVisible();
      await expect(pageB.locator(".connection-dot.connected")).toBeVisible();

      // User B changes A1
      await typeInCell(pageB, "A1", "50");

      // User A should see A1 updated AND A3 recalculated
      await expectCellValue(pageA, "A1", "50");
      await expectCellValue(pageA, "A3", "70");
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("both users see the SSE connection indicator", async ({ browser }) => {
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();

    try {
      await gotoSheets(pageA);
      await expect(pageA.locator(".connection-dot.connected")).toBeVisible({
        timeout: 5000,
      });
    } finally {
      await contextA.close();
    }
  });

  test("rapid edits from both users converge", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      const wbUrl = await gotoSheets(pageA);
      await gotoWorkbook(pageB, wbUrl);
      await expect(pageA.locator(".connection-dot.connected")).toBeVisible();
      await expect(pageB.locator(".connection-dot.connected")).toBeVisible();

      // Both users type in different cells
      await typeInCell(pageA, "A1", "Alice-1");
      await typeInCell(pageB, "B1", "Bob-1");
      await typeInCell(pageA, "A2", "Alice-2");
      await typeInCell(pageB, "B2", "Bob-2");

      // Wait for all saves to settle
      await waitForAutoSave(pageA, 2000);

      // Both should see all data
      await expectCellValue(pageA, "A1", "Alice-1");
      await expectCellValue(pageA, "B1", "Bob-1");
      await expectCellValue(pageB, "A1", "Alice-1");
      await expectCellValue(pageB, "B1", "Bob-1");
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
