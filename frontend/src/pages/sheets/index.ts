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
  // Sharing wiring (phase-08/04): can-manage gates the Share button; self-actor
  // marks "(you)" in the dialog; csrftoken is forwarded on writes (optional
  // under datasette 1.0a30, but passed for completeness).
  const canManage = target.dataset.canManage === "1";
  const selfActor = target.dataset.selfActor ?? "";
  const csrftoken = target.dataset.csrftoken ?? "";
  mount(SheetsPage, {
    target,
    props: {
      database,
      workbookId,
      workbookName,
      canManage,
      selfActor,
      csrftoken,
    },
  });
}
