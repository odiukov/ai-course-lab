"""Tool registry with JSON Schema 2020-12 subset validation.

Conceptual references:
- ./docs/en.md (this lesson)
- IETF draft draft-bhutton-json-schema-2020-12 (subset: type, properties,
  required, enum, minLength, maxLength, pattern, items)
- RFC 6901 (JSON Pointer for error paths)

Stdlib only. Run: python3 code/main.py
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable


PRIMITIVE_TYPE_MAP: dict[str, tuple[type, ...]] = {
    "string": (str,),
    "integer": (int,),
    "number": (int, float),
    "boolean": (bool,),
    "object": (dict,),
    "array": (list,),
    "null": (type(None),),
}

ALLOWED_KEYWORDS = {
    "type", "properties", "required", "enum",
    "minLength", "maxLength", "pattern", "items", "description",
}


@dataclass
class ValidationError:
    path: str
    keyword: str
    message: str

    def to_dict(self) -> dict:
        return {"path": self.path, "keyword": self.keyword, "message": self.message}


@dataclass
class Ok:
    pass


@dataclass
class ToolRecord:
    name: str
    description: str
    schema: dict
    handler: Callable[..., Any]
    idempotent: bool = False
    timeout_ms: int = 30_000


class ToolRegistry:
    """Name-keyed table of tool records with schema validation."""

    _NAME_RE = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$")

    def __init__(self) -> None:
        self._records: dict[str, ToolRecord] = {}
        self._order: list[str] = []

    def register(
        self,
        name: str,
        schema: dict,
        handler: Callable[..., Any],
        description: str = "",
        idempotent: bool = False,
        timeout_ms: int = 30_000,
        override: bool = False,
    ) -> ToolRecord:
        """Зарегистрируй валидированный ToolRecord, проверяя имя и дубликаты, сохраняя порядок и разрешая замену только при override=True."""
        raise NotImplementedError

    def get(self, name: str) -> ToolRecord:
        if name not in self._records:
            raise KeyError(f"unknown tool {name!r}")
        return self._records[name]

    def names(self) -> list[str]:
        return list(self._order)

    def validate(self, name: str, args: Any) -> Ok | list[ValidationError]:
        rec = self.get(name)
        errors: list[ValidationError] = []
        _walk(rec.schema, args, "", errors)
        if errors:
            return errors
        return Ok()


def validate_schema_shape(schema: dict) -> None:
    """Рекурсивно проверь структуру схемы и отклони неподдерживаемые ключевые слова, типы и некорректные значения ограничений."""
    raise NotImplementedError


def _path(prefix: str, segment: str | int) -> str:
    seg = str(segment).replace("~", "~0").replace("/", "~1")
    return f"{prefix}/{seg}"


def _type_matches(value: Any, expected: str) -> bool:
    types = PRIMITIVE_TYPE_MAP[expected]
    if expected == "boolean":
        return isinstance(value, bool)
    if expected in ("integer", "number"):
        if isinstance(value, bool):
            return False
        return isinstance(value, types)
    return isinstance(value, types)


def _walk(schema: dict, value: Any, path: str, errs: list[ValidationError]) -> None:
    """Реализуй рекурсивный проход валидатора: проверь type и enum, сформируй ошибку текущего пути и передай значение специализированной проверке."""
    raise NotImplementedError


def _check_string(schema: dict, value: str, path: str, errs: list[ValidationError]) -> None:
    if "minLength" in schema and len(value) < schema["minLength"]:
        errs.append(ValidationError(
            path=path or "/", keyword="minLength",
            message=f"length {len(value)} < minLength {schema['minLength']}",
        ))
    if "maxLength" in schema and len(value) > schema["maxLength"]:
        errs.append(ValidationError(
            path=path or "/", keyword="maxLength",
            message=f"length {len(value)} > maxLength {schema['maxLength']}",
        ))
    if "pattern" in schema:
        try:
            if not re.search(schema["pattern"], value):
                errs.append(ValidationError(
                    path=path or "/", keyword="pattern",
                    message=f"value {value!r} does not match pattern {schema['pattern']!r}",
                ))
        except re.error as exc:
            errs.append(ValidationError(
                path=path or "/", keyword="pattern",
                message=f"invalid regex: {exc}",
            ))


def _check_object(schema: dict, value: dict, path: str, errs: list[ValidationError]) -> None:
    """Проверь обязательные свойства объекта и рекурсивно провалидируй известные свойства с точными JSON Pointer-путями, собирая все ошибки."""
    raise NotImplementedError


def _check_array(schema: dict, value: list, path: str, errs: list[ValidationError]) -> None:
    """Провалидируй каждый элемент массива по схеме items и добавь индекс элемента к JSON Pointer-пути."""
    raise NotImplementedError


def _demo() -> None:
    registry = ToolRegistry()

    def get_user(id: int) -> dict:
        return {"id": id, "name": "ada"}

    registry.register(
        name="db.get_user",
        description="Fetch a user record by id.",
        schema={
            "type": "object",
            "required": ["id"],
            "properties": {
                "id": {"type": "integer"},
                "fields": {
                    "type": "array",
                    "items": {"type": "string", "enum": ["id", "name", "email"]},
                },
            },
        },
        handler=get_user,
        idempotent=True,
    )

    cases = [
        {"id": 42, "fields": ["id", "name"]},
        {"id": "forty-two"},
        {"fields": ["id"]},
        {"id": 1, "fields": ["id", "phone"]},
    ]
    report = []
    for c in cases:
        result = registry.validate("db.get_user", c)
        if isinstance(result, Ok):
            report.append({"args": c, "ok": True})
        else:
            report.append({"args": c, "ok": False, "errors": [e.to_dict() for e in result]})
    print(json.dumps({"tools": registry.names(), "cases": report}, indent=2))


if __name__ == "__main__":
    _demo()
