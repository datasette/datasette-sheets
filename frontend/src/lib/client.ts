// Shared openapi-fetch client for the datasette-sheets backend.
//
// Important: we attach `Content-Type: application/json` as a default header.
// Datasette's built-in `skip_csrf` hook waives CSRF enforcement only for
// requests with that content-type. openapi-fetch auto-sets it whenever a
// body is present, but bodyless POSTs (e.g. `/delete` endpoints) get no
// content-type by default, which trips asgi_csrf (UNKNOWN_CONTENT_TYPE)
// → 403. Setting it here is the bulletproof fix.
import createClient from "openapi-fetch";
import type { paths } from "../../api.d.ts";

export const client = createClient<paths>({
  baseUrl: "/",
  headers: { "Content-Type": "application/json" },
});
