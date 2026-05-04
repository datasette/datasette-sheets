import { mount } from "svelte";
import "../../lib/styles/shared.css";
import SheetsPage from "./SheetsPage.svelte";

const target = document.getElementById("sheets-app");
if (target) {
  const database = target.dataset.database ?? "";
  // ``data-workbook-id`` is a digit string emitted server-side; the
  // backend regex (`\d+`) guarantees it parses cleanly.
  const workbookId = Number(target.dataset.workbookId ?? "0");
  const workbookName = target.dataset.workbookName ?? "";
  mount(SheetsPage, {
    target,
    props: { database, workbookId, workbookName },
  });
}
