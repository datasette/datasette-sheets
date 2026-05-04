import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  parseSqlCall,
  buildSqlUrl,
  parseDatasetteJson,
  fetchSqlData,
  clearSqlCache,
  setSqlDefaultDatabase,
} from "../sql";

beforeEach(() => {
  clearSqlCache();
  setSqlDefaultDatabase("");
});

describe("parseSqlCall", () => {
  test("single-arg form returns sql with implicit database", () => {
    expect(parseSqlCall('=SQL("select * from t")')).toEqual({
      dbname: null,
      sql: "select * from t",
    });
  });

  test("two-arg form returns both dbname and sql", () => {
    expect(parseSqlCall('=SQL("mydb", "select 1")')).toEqual({
      dbname: "mydb",
      sql: "select 1",
    });
  });

  test("single-quoted strings are accepted", () => {
    expect(parseSqlCall("=SQL('select 1')")?.sql).toBe("select 1");
  });

  test("escape sequences inside strings are honoured", () => {
    // ``\"`` lets a user embed quotes in the SQL literal.
    expect(parseSqlCall('=SQL("select \\"a\\" from t")')?.sql).toBe(
      'select "a" from t',
    );
  });

  test("case-insensitive function name", () => {
    expect(parseSqlCall('=sql("x")')?.sql).toBe("x");
    expect(parseSqlCall('=Sql("x")')?.sql).toBe("x");
  });

  test("whitespace tolerance around tokens", () => {
    expect(parseSqlCall('  =  SQL  (  "a"  ,  "b"  )  ')).toEqual({
      dbname: "a",
      sql: "b",
    });
  });

  test.each([
    ["no leading equals", 'SQL("x")'],
    ["different function", '=FOO("x")'],
    ["cell ref arg", "=SQL(A1)"],
    ["number arg", "=SQL(42)"],
    ["extra arg", '=SQL("a", "b", "c")'],
    ["empty call", "=SQL()"],
    ["unterminated string", '=SQL("abc'],
    ["trailing junk", '=SQL("x") + 1'],
  ])("rejects: %s", (_label, raw) => {
    expect(parseSqlCall(raw)).toBeNull();
  });
});

describe("buildSqlUrl", () => {
  test("explicit dbname wins over the workbook default", () => {
    setSqlDefaultDatabase("workbook_db");
    const url = buildSqlUrl({ dbname: "other", sql: "select 1" });
    expect(url).toBe("/other.json?sql=select%201&_shape=array");
  });

  test("implicit dbname falls back to the workbook's database", () => {
    setSqlDefaultDatabase("workbook_db");
    const url = buildSqlUrl({ dbname: null, sql: "select * from t" });
    expect(url).toBe(
      "/workbook_db.json?sql=select%20*%20from%20t&_shape=array",
    );
  });

  test("returns null when no database is available", () => {
    setSqlDefaultDatabase("");
    expect(buildSqlUrl({ dbname: null, sql: "x" })).toBeNull();
  });

  test("database names with weird characters are URL-encoded", () => {
    setSqlDefaultDatabase("my db");
    const url = buildSqlUrl({ dbname: null, sql: "x" });
    expect(url).toBe("/my%20db.json?sql=x&_shape=array");
  });
});

describe("parseDatasetteJson", () => {
  test("array of objects ( ?_shape=array ) becomes [headers, ...rows]", () => {
    const body = [
      { id: 1, name: "alex" },
      { id: 2, name: "bob" },
    ];
    expect(parseDatasetteJson(body)).toEqual([
      ["id", "name"],
      ["1", "alex"],
      ["2", "bob"],
    ]);
  });

  test("{columns, rows} default shape with array rows", () => {
    const body = {
      columns: ["id", "name"],
      rows: [
        [1, "alex"],
        [2, "bob"],
      ],
    };
    expect(parseDatasetteJson(body)).toEqual([
      ["id", "name"],
      ["1", "alex"],
      ["2", "bob"],
    ]);
  });

  test("{columns, rows} with object rows maps keys to columns", () => {
    const body = {
      columns: ["id", "name"],
      rows: [
        { id: 1, name: "alex" },
        { id: 2, name: "bob" },
      ],
    };
    expect(parseDatasetteJson(body)).toEqual([
      ["id", "name"],
      ["1", "alex"],
      ["2", "bob"],
    ]);
  });

  test("null values become empty strings", () => {
    expect(parseDatasetteJson([{ id: 1, name: null }])).toEqual([
      ["id", "name"],
      ["1", ""],
    ]);
  });

  test("empty array returns an empty header row", () => {
    expect(parseDatasetteJson([])).toEqual([[]]);
  });

  test("garbage shape throws", () => {
    expect(() => parseDatasetteJson(42)).toThrow();
    expect(() => parseDatasetteJson({ foo: "bar" })).toThrow();
    expect(() => parseDatasetteJson("hello")).toThrow();
  });
});

describe("fetchSqlData", () => {
  test("OK response is parsed via parseDatasetteJson", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ id: 1, name: "alex" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const rows = await fetchSqlData("/db.json?sql=x&_shape=array");
    expect(rows).toEqual([
      ["id", "name"],
      ["1", "alex"],
    ]);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  test("non-OK response throws with status", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response("nope", { status: 500, statusText: "Server Error" }),
      );
    await expect(fetchSqlData("/x")).rejects.toThrow(/500/);
    spy.mockRestore();
  });
});
