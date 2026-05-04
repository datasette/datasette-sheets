"""Unit tests for tools/gen_queries.py — the codegen step that turns
solite-dev's JSON IR into a typed Python module.

We compile the generator's output string with ``exec`` into a throwaway
module, then inspect annotations and dataclass fields directly.
That's sturdier than string-matching the emitted source (which is
whitespace-sensitive and would churn every time we tweak formatting)
and still catches the semantic behaviours that matter:

* result_type (Void / Rows / Row / Value / List) -> return type shape
* nullability -> ``T | None`` wrapping on dataclass fields + Value/List returns
* decltype -> base Python type
* typed (``$foo::text``) vs untyped (``:foo``) params -> arg typing + bind key
* camelCase query names -> snake_case functions + CamelCase row classes
* duplicate row classes -> dedupe on identical shape, raise on conflict
"""

from __future__ import annotations

import dataclasses
import sys
import types
from pathlib import Path

import pytest

# tools/ isn't on the Python path by default; the generator is a
# standalone script rather than an installed package.
sys.path.insert(0, str(Path(__file__).parent.parent / "tools"))

from gen_queries import generate  # noqa: E402


def _col(
    name: str,
    decltype: str | None = "TEXT",
    nullable: bool = True,
) -> dict:
    return {"name": name, "decltype": decltype, "nullable": nullable}


def _param(
    full_name: str,
    name: str,
    annotated_type: str | None = None,
    nullable: bool = False,
) -> dict:
    return {
        "full_name": full_name,
        "name": name,
        "annotated_type": annotated_type,
        "nullable": nullable,
    }


def _export(
    name: str = "foo",
    result_type: str = "Rows",
    columns: list | None = None,
    parameters: list | None = None,
    sql: str = "select 1",
    result_class: str | None = None,
) -> dict:
    out = {
        "name": name,
        "result_type": result_type,
        "sql": sql,
        "parameters": parameters or [],
        "columns": columns or [],
    }
    if result_class is not None:
        out["result_class"] = result_class
    return out


_MODULE_COUNTER = 0


def _compile(exports: list[dict]) -> types.ModuleType:
    """Generate + exec. Returns the live module so tests can poke at it.

    The generated code uses ``@dataclass``, which needs the module to
    be registered in ``sys.modules`` to resolve forward-reference
    annotations via ``cls.__module__`` — otherwise dataclasses raises
    during class construction. Use a unique name per call so parallel
    or repeated invocations don't trample each other.
    """
    global _MODULE_COUNTER
    _MODULE_COUNTER += 1
    name = f"_test_generated_{_MODULE_COUNTER}"
    source = generate({"exports": exports})
    mod = types.ModuleType(name)
    sys.modules[name] = mod
    try:
        exec(compile(source, f"<generated:{name}>", "exec"), mod.__dict__)
    except Exception:
        del sys.modules[name]
        raise
    return mod


# --- return type shape --------------------------------------------------------


def test_void_result_returns_none():
    mod = _compile(
        [
            _export(
                name="insertFoo", result_type="Void", parameters=[_param(":id", "id")]
            )
        ]
    )
    assert mod.insert_foo.__annotations__["return"] == "None"


def test_rows_default_result_returns_list_of_rowclass():
    mod = _compile([_export(name="listFoos", columns=[_col("id", "TEXT", False)])])
    assert mod.list_foos.__annotations__["return"] == "list[ListFoosRow]"


def test_row_result_returns_rowclass_or_none():
    mod = _compile(
        [_export(name="getFoo", result_type="Row", columns=[_col("id", "TEXT", False)])]
    )
    assert mod.get_foo.__annotations__["return"] == "GetFooRow | None"


def test_value_result_is_always_optional_even_when_column_not_null():
    # An empty result set yields None regardless of column nullability,
    # so `:value` always returns `T | None`.
    mod = _compile(
        [
            _export(
                name="countFoos",
                result_type="Value",
                columns=[_col("n", "INTEGER", nullable=False)],
            )
        ]
    )
    assert mod.count_foos.__annotations__["return"] == "int | None"


def test_list_result_propagates_column_nullability():
    mod = _compile(
        [
            _export(
                name="allIds",
                result_type="List",
                columns=[_col("id", "TEXT", nullable=False)],
            )
        ]
    )
    assert mod.all_ids.__annotations__["return"] == "list[str]"

    mod_nullable = _compile(
        [
            _export(
                name="allMaybe",
                result_type="List",
                columns=[_col("x", "TEXT", nullable=True)],
            )
        ]
    )
    assert mod_nullable.all_maybe.__annotations__["return"] == "list[str | None]"


# --- dataclass shape ----------------------------------------------------------


def test_row_class_fields_match_column_order_and_types():
    mod = _compile(
        [
            _export(
                name="getFoo",
                result_type="Row",
                columns=[
                    _col("id", "TEXT", nullable=False),
                    _col("count", "INTEGER", nullable=False),
                    _col("note", "TEXT", nullable=True),
                ],
            )
        ]
    )
    fields = {f.name: f for f in dataclasses.fields(mod.GetFooRow)}
    assert list(fields) == ["id", "count", "note"]
    # dataclasses store annotations as strings under
    # `from __future__ import annotations`.
    assert fields["id"].type == "str"
    assert fields["count"].type == "int"
    assert fields["note"].type == "str | None"


def test_decltype_unknown_becomes_any_without_none_wrap():
    # ``Any`` already covers None; don't noisy-wrap it.
    mod = _compile(
        [
            _export(
                name="getCell",
                result_type="Row",
                columns=[_col("computed_value", decltype=None, nullable=True)],
            )
        ]
    )
    fields = {f.name: f for f in dataclasses.fields(mod.GetCellRow)}
    assert fields["computed_value"].type == "Any"


@pytest.mark.parametrize(
    "decltype,expected",
    [
        ("TEXT", "str"),
        ("INTEGER", "int"),
        ("BIGINT", "int"),
        ("REAL", "float"),
        ("FLOAT", "float"),
        ("BLOB", "bytes"),
        ("BOOLEAN", "bool"),
        ("WIDGET", "Any"),
    ],
)
def test_decltype_to_python_mapping(decltype, expected):
    mod = _compile(
        [
            _export(
                name="getFoo",
                result_type="Row",
                columns=[_col("v", decltype, nullable=False)],
            )
        ]
    )
    fields = {f.name: f for f in dataclasses.fields(mod.GetFooRow)}
    assert fields["v"].type == expected


# --- parameters ---------------------------------------------------------------


def test_untyped_param_gets_any_and_short_bind_key():
    mod = _compile(
        [
            _export(
                name="getFoo",
                result_type="Row",
                parameters=[_param(":user_id", "user_id")],
                columns=[_col("id", "TEXT", False)],
                sql="select id from foo where id = :user_id",
            )
        ]
    )
    assert mod.get_foo.__annotations__["user_id"] == "Any"
    # The bind dict literal is embedded in the function source; re-run
    # the function to verify sqlite would actually see the right key.
    # Cheaper check: read the generated source and confirm the bind key.
    source = generate(
        {
            "exports": [
                _export(
                    name="getFoo",
                    result_type="Row",
                    parameters=[_param(":user_id", "user_id")],
                    columns=[_col("id", "TEXT", False)],
                    sql="select id from foo where id = :user_id",
                )
            ]
        }
    )
    assert '"user_id": user_id' in source


def test_typed_param_types_the_arg_and_preserves_cast_in_bind_key():
    # sqlite3 keeps the ``::text`` cast in the bind key, so our bind
    # dict must too. Python-side arg name is just the bare name.
    source = generate(
        {
            "exports": [
                _export(
                    name="getFoo",
                    result_type="Row",
                    parameters=[_param("$user_id::text", "user_id", "text")],
                    columns=[_col("id", "TEXT", False)],
                    sql="select id from foo where id = $user_id::text",
                )
            ]
        }
    )
    mod = _compile(
        [
            _export(
                name="getFoo",
                result_type="Row",
                parameters=[_param("$user_id::text", "user_id", "text")],
                columns=[_col("id", "TEXT", False)],
                sql="select id from foo where id = $user_id::text",
            )
        ]
    )
    assert mod.get_foo.__annotations__["user_id"] == "str"
    assert '"user_id::text": user_id' in source


@pytest.mark.parametrize(
    "annotated,expected",
    [
        ("text", "str"),
        ("str", "str"),
        ("integer", "int"),
        ("bigint", "int"),
        ("real", "float"),
        ("float", "float"),
        ("blob", "bytes"),
        ("boolean", "bool"),
        (None, "Any"),
        ("widget", "Any"),
    ],
)
def test_annotated_type_to_python_mapping(annotated, expected):
    mod = _compile(
        [
            _export(
                name="getFoo",
                result_type="Row",
                parameters=[_param("$x::" + (annotated or "x"), "x", annotated)],
                columns=[_col("id", "TEXT", False)],
            )
        ]
    )
    assert mod.get_foo.__annotations__["x"] == expected


# --- naming -------------------------------------------------------------------


def test_camel_query_name_becomes_snake_function_and_camel_rowclass():
    mod = _compile(
        [
            _export(
                name="listWorkbooks",
                columns=[_col("id", "TEXT", False)],
            )
        ]
    )
    assert hasattr(mod, "list_workbooks")
    assert hasattr(mod, "ListWorkbooksRow")
    assert not hasattr(mod, "listWorkbooks")


def test_conn_is_always_first_positional_arg():
    mod = _compile(
        [
            _export(
                name="getFoo",
                result_type="Row",
                parameters=[_param(":id", "id")],
                columns=[_col("id", "TEXT", False)],
            )
        ]
    )
    # dict insertion order is source order; ``conn`` must come first.
    params = list(mod.get_foo.__annotations__)
    params.remove("return")
    assert params == ["conn", "id"]
    assert mod.get_foo.__annotations__["conn"] == "sqlite3.Connection"


# --- row class dedupe / conflict ----------------------------------------------


def test_identical_row_class_shapes_are_deduplicated():
    # Two exports both named ``foo`` (different call shape, same
    # output columns) would ordinarily emit two identical dataclasses.
    # Dedupe keeps the module tidy.
    exports = [
        _export(name="fooByA", columns=[_col("id", "TEXT", False)]),
        _export(name="fooByA", columns=[_col("id", "TEXT", False)]),
    ]
    source = generate({"exports": exports})
    # One @dataclass header for FooByARow.
    assert source.count("class FooByARow:") == 1


def test_conflicting_row_class_shapes_raise():
    # Same camel name, different column list -> can't dedupe, and the
    # generator should shout rather than silently pick a winner.
    exports = [
        _export(name="foo", columns=[_col("a", "TEXT", False)]),
        _export(name="foo", columns=[_col("b", "INTEGER", False)]),
    ]
    with pytest.raises(ValueError, match="conflicting shapes"):
        generate({"exports": exports})


# --- module shape -------------------------------------------------------------


def test_empty_ir_still_produces_a_valid_module():
    mod = _compile([])
    # The only guarantees: it imports clean, and sqlite3/dataclass/Any
    # are accessible at module level so downstream edits can reuse them.
    assert hasattr(mod, "sqlite3")
    # No row classes, no functions — just the preamble.
    user_defined = [
        name
        for name, val in vars(mod).items()
        if not name.startswith("_") and not isinstance(val, types.ModuleType)
    ]
    # ``dataclass`` and ``Any`` are imported names; everything else
    # would be a stray function/class. None should exist.
    assert set(user_defined) <= {"dataclass", "Any", "annotations"}


# --- nullable parameters (solite-dev P1-A) ------------------------------------


def test_nullable_param_wraps_annotated_type_in_optional():
    mod = _compile(
        [
            _export(
                name="insertThing",
                result_type="Void",
                parameters=[_param("$note::text::", "note", "text", nullable=True)],
            )
        ]
    )
    assert mod.insert_thing.__annotations__["note"] == "str | None"


def test_non_null_param_stays_bare():
    mod = _compile(
        [
            _export(
                name="insertThing",
                result_type="Void",
                parameters=[_param("$name::text", "name", "text", nullable=False)],
            )
        ]
    )
    assert mod.insert_thing.__annotations__["name"] == "str"


def test_nullable_untyped_param_stays_any_without_none_wrap():
    # ``Any`` already covers None; no noisy ``Any | None``.
    mod = _compile(
        [
            _export(
                name="updateComputed",
                result_type="Void",
                parameters=[_param("$value::", "value", None, nullable=True)],
            )
        ]
    )
    assert mod.update_computed.__annotations__["value"] == "Any"


def test_nullable_default_is_false_for_older_ir():
    # Parameter dicts from older solite builds won't carry the
    # ``nullable`` field at all. Backward-compat: treat as non-null.
    mod = _compile(
        [
            _export(
                name="insertThing",
                result_type="Void",
                parameters=[
                    # Legacy-shape dict without the nullable key.
                    {
                        "full_name": "$name::text",
                        "name": "name",
                        "annotated_type": "text",
                    }
                ],
            )
        ]
    )
    assert mod.insert_thing.__annotations__["name"] == "str"


# --- row-class hint (solite-dev P1-B) -----------------------------------------


def test_result_class_hint_overrides_default_row_class_name():
    mod = _compile(
        [
            _export(
                name="listWorkbooks",
                columns=[_col("id", "TEXT", False)],
                result_class="Workbook",
            )
        ]
    )
    # Without a hint this would be ``ListWorkbooksRow``.
    assert hasattr(mod, "Workbook")
    assert not hasattr(mod, "ListWorkbooksRow")
    assert mod.list_workbooks.__annotations__["return"] == "list[Workbook]"


def test_same_result_class_across_queries_emits_one_dataclass():
    # The whole point of the hint: share the dataclass across
    # list / get / insert / update for the same entity.
    exports = [
        _export(
            name="listThings",
            columns=[_col("id", "TEXT", False), _col("name", "TEXT", False)],
            result_class="Thing",
        ),
        _export(
            name="getThing",
            result_type="Row",
            columns=[_col("id", "TEXT", False), _col("name", "TEXT", False)],
            result_class="Thing",
        ),
    ]
    source = generate({"exports": exports})
    assert source.count("class Thing:") == 1


def test_missing_result_class_falls_back_to_query_derived_name():
    # When no hint is given, the generator keeps its old behaviour so
    # narrow / single-use shapes still get a reasonable class name.
    mod = _compile(
        [
            _export(
                name="listFormulaCells",
                columns=[_col("row_idx", "INTEGER", False)],
            )
        ]
    )
    assert hasattr(mod, "ListFormulaCellsRow")
