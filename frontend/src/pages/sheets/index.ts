import { mount } from "svelte";
import "../../lib/styles/shared.css";
import SheetsPage from "./SheetsPage.svelte";

const target = document.getElementById("sheets-app");
if (target) {
  const database = target.dataset.database ?? "";
  const workbookId = target.dataset.workbookId ?? "";
  const workbookName = target.dataset.workbookName ?? "";
  mount(SheetsPage, {
    target,
    props: { database, workbookId, workbookName },
  });
}
