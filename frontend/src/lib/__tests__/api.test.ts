import { describe, expect, test } from "vitest";
import { ApiError, unwrap } from "../api";

// `unwrap` is the single funnel every API call passes through. It
// used to collapse every error to `new Error(JSON.stringify(body))`,
// which made structured handling (status === 409, parsed Pydantic
// detail, …) impossible upstream. These tests pin the new contract:
// errors throw `ApiError` carrying status + body, and the empty-body
// branch only fires on parse failures, not on 200 No Content.

function mockResponse(init: { status: number; ok?: boolean }): Response {
  // We don't need a real Response — `unwrap` only reads `.status` and
  // `.ok`. Casting through `unknown` keeps the test independent of any
  // future fields openapi-fetch might add.
  return {
    status: init.status,
    ok: init.ok ?? (init.status >= 200 && init.status < 300),
  } as unknown as Response;
}

describe("unwrap", () => {
  test("200 with body returns the data verbatim", () => {
    const data = { sheets: [{ id: "s1", name: "Sheet1" }] };
    const result = unwrap({ data, response: mockResponse({ status: 200 }) });
    expect(result).toBe(data);
  });

  test("200 with empty body returns undefined for void callers", () => {
    // Some endpoints (delete*) shape as `Promise<void>`; openapi-fetch
    // can land them with `data: undefined` while `response.ok` is true.
    const result = unwrap<void>({
      data: undefined,
      response: mockResponse({ status: 200, ok: true }),
    });
    expect(result).toBeUndefined();
  });

  test("204 No Content with undefined data returns undefined", () => {
    const result = unwrap<void>({
      data: undefined,
      response: mockResponse({ status: 204, ok: true }),
    });
    expect(result).toBeUndefined();
  });

  test("422 Pydantic body throws ApiError with parsed body intact", () => {
    const body = {
      detail: [
        {
          loc: ["body", "cells", 0, "raw_value"],
          msg: "field required",
          type: "value_error.missing",
        },
      ],
    };
    let caught: unknown;
    try {
      unwrap({ error: body, response: mockResponse({ status: 422 }) });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    const err = caught as ApiError;
    expect(err.status).toBe(422);
    // Critically: body is the parsed object, not a stringified blob.
    expect(err.body).toBe(body);
    expect(err.message).toBe("API error 422");
    expect(err.name).toBe("ApiError");
  });

  test("409 conflict surfaces a status callers can branch on", () => {
    let caught: unknown;
    try {
      unwrap({
        error: { detail: "version conflict" },
        response: mockResponse({ status: 409 }),
      });
    } catch (e) {
      caught = e;
    }
    // The whole point of the structured class — pin the canonical
    // pattern downstream code should adopt.
    if (caught instanceof ApiError && caught.status === 409) {
      expect(caught.body).toEqual({ detail: "version conflict" });
    } else {
      throw new Error("expected ApiError with status 409");
    }
  });

  test("500 with text body keeps the body raw", () => {
    let caught: unknown;
    try {
      unwrap({
        error: "internal server error",
        response: mockResponse({ status: 500 }),
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    const err = caught as ApiError;
    expect(err.status).toBe(500);
    expect(err.body).toBe("internal server error");
  });

  test("missing response falls back to status 0", () => {
    // Defensive — openapi-fetch always supplies a response, but the
    // optional access in `unwrap` keeps the contract safe.
    let caught: unknown;
    try {
      unwrap({
        error: "boom",
        response: undefined as unknown as Response,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(0);
  });

  test("ApiError is a real Error subclass", () => {
    const err = new ApiError("API error 400", 400, { detail: "bad" });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("API error 400");
  });
});
