"""
Observability for an agent harness: GenAI spans + Prometheus metrics.

See: phases/19-capstone-projects/28-observability-otel-traces/docs/en.md
Concept refs:
  - OpenTelemetry GenAI semantic conventions (gen_ai.* attribute keys).
  - Prometheus text exposition format (counters and histograms).
  - W3C Trace Context (16-byte trace_id, 8-byte span_id).
The demo at the bottom emits spans to a temp jsonl, prints the
Prometheus exposition, and exits zero.
"""

from __future__ import annotations

import json
import math
import os
import sys
import tempfile
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Iterator


# ---------------------------------------------------------------------------
# OTel semantic-convention keys
# ---------------------------------------------------------------------------

# Standard GenAI attributes (OpenTelemetry GenAI semantic conventions).
# These keys are stable; only new keys get added, never renamed.
GEN_AI_SYSTEM = "gen_ai.system"
GEN_AI_REQUEST_MODEL = "gen_ai.request.model"
GEN_AI_REQUEST_MAX_TOKENS = "gen_ai.request.max_tokens"
GEN_AI_REQUEST_TEMPERATURE = "gen_ai.request.temperature"
GEN_AI_USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens"
GEN_AI_USAGE_OUTPUT_TOKENS = "gen_ai.usage.output_tokens"
GEN_AI_RESPONSE_MODEL = "gen_ai.response.model"
GEN_AI_RESPONSE_ID = "gen_ai.response.id"
GEN_AI_OPERATION_NAME = "gen_ai.operation.name"
GEN_AI_TOOL_NAME = "gen_ai.tool.name"
GEN_AI_TOOL_CALL_ID = "gen_ai.tool.call.id"
GEN_AI_TOOL_RESULT_BYTES = "gen_ai.tool.result.bytes"

# Harness-specific attributes (under a non-conflicting prefix).
HARNESS_GATE_DECISION = "agent.harness.gate.decision"
HARNESS_GATE_REASON = "agent.harness.gate.reason"

STATUS_UNSET = "UNSET"
STATUS_OK = "OK"
STATUS_ERROR = "ERROR"


# ---------------------------------------------------------------------------
# Span data shape
# ---------------------------------------------------------------------------


@dataclass
class SpanEvent:
    """Discrete event recorded inside a span (per OTel)."""

    name: str
    timestamp_unix_nano: int
    attributes: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "timestamp_unix_nano": self.timestamp_unix_nano,
            "attributes": dict(self.attributes),
        }


@dataclass
class GenAISpan:
    """A single span shaped to OTel GenAI conventions."""

    trace_id: str
    span_id: str
    name: str
    start_unix_nano: int
    end_unix_nano: int = 0
    parent_span_id: str = ""
    attributes: dict[str, Any] = field(default_factory=dict)
    events: list[SpanEvent] = field(default_factory=list)
    status: str = STATUS_UNSET
    status_message: str = ""
    kind: str = "INTERNAL"

    @property
    def duration_ms(self) -> float:
        if self.end_unix_nano <= 0:
            return 0.0
        return (self.end_unix_nano - self.start_unix_nano) / 1_000_000.0

    def to_dict(self) -> dict:
        return {
            "trace_id": self.trace_id,
            "span_id": self.span_id,
            "parent_span_id": self.parent_span_id,
            "name": self.name,
            "kind": self.kind,
            "start_unix_nano": self.start_unix_nano,
            "end_unix_nano": self.end_unix_nano,
            "duration_ms": round(self.duration_ms, 4),
            "attributes": dict(self.attributes),
            "events": [e.to_dict() for e in self.events],
            "status": {"code": self.status, "message": self.status_message},
        }


# ---------------------------------------------------------------------------
# ID generation
# ---------------------------------------------------------------------------


def new_trace_id() -> str:
    """Random 16-byte hex string. Matches W3C trace context."""

    return uuid.uuid4().hex + uuid.uuid4().hex[:0]  # uuid4 hex is already 32 chars


def new_span_id() -> str:
    """Random 8-byte hex string. Matches W3C trace context span id."""

    return uuid.uuid4().hex[:16]


def now_unix_nano() -> int:
    return time.time_ns()


# ---------------------------------------------------------------------------
# Exporter
# ---------------------------------------------------------------------------


@dataclass
class JSONLExporter:
    """Append-only exporter: one span per JSON line."""

    path: str
    fh: Any = None
    closed: bool = False

    def _ensure_open(self) -> None:
        if self.fh is None:
            os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
            self.fh = open(self.path, "a", encoding="utf-8")

    def export(self, span: GenAISpan) -> None:
        """Реализуйте добавление завершённого span в JSONL-файл как одной самодостаточной JSON-строки с немедленной записью на диск."""
        raise NotImplementedError

    def close(self) -> None:
        if self.fh is not None and not self.closed:
            self.fh.close()
            self.closed = True


class InMemoryExporter:
    """Test-friendly exporter that keeps spans in a list."""

    def __init__(self) -> None:
        self.spans: list[GenAISpan] = []

    def export(self, span: GenAISpan) -> None:
        self.spans.append(span)

    def close(self) -> None:
        return None


# ---------------------------------------------------------------------------
# Metrics primitives
# ---------------------------------------------------------------------------


def _label_key(labels: dict[str, str]) -> tuple[tuple[str, str], ...]:
    return tuple(sorted(labels.items()))


def _format_labels(labels: dict[str, str]) -> str:
    if not labels:
        return ""
    parts = []
    for k, v in sorted(labels.items()):
        escaped = str(v).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        parts.append(f'{k}="{escaped}"')
    return "{" + ",".join(parts) + "}"


@dataclass
class Counter:
    """A simple labelled counter."""

    name: str
    help: str = ""
    values: dict[tuple[tuple[str, str], ...], float] = field(default_factory=dict)

    def inc(self, labels: dict[str, str] | None = None, by: float = 1.0) -> None:
        """Реализуйте накопительное увеличение счётчика отдельно для каждого нормализованного набора меток."""
        raise NotImplementedError

    def get(self, labels: dict[str, str] | None = None) -> float:
        return self.values.get(_label_key(labels or {}), 0.0)


@dataclass
class Histogram:
    """A histogram with explicit buckets, in line with OTel's default ms set."""

    name: str
    help: str = ""
    buckets: tuple[float, ...] = (
        5.0,
        10.0,
        25.0,
        50.0,
        100.0,
        250.0,
        500.0,
        1000.0,
        2500.0,
        5000.0,
        10000.0,
    )
    samples: dict[tuple[tuple[str, str], ...], list[float]] = field(
        default_factory=dict
    )

    def observe(self, value: float, labels: dict[str, str] | None = None) -> None:
        key = _label_key(labels or {})
        self.samples.setdefault(key, []).append(float(value))

    def bucket_counts(
        self, labels: dict[str, str] | None = None
    ) -> dict[float, int]:
        """Вычислите накопительные количества наблюдений для всех границ гистограммы и итоговой границы +Inf с учётом меток."""
        raise NotImplementedError

    def total_count(self, labels: dict[str, str] | None = None) -> int:
        return len(self.samples.get(_label_key(labels or {}), []))

    def total_sum(self, labels: dict[str, str] | None = None) -> float:
        return float(sum(self.samples.get(_label_key(labels or {}), [])))


@dataclass
class MetricsRegistry:
    counters: dict[str, Counter] = field(default_factory=dict)
    histograms: dict[str, Histogram] = field(default_factory=dict)

    def counter(self, name: str, help: str = "") -> Counter:
        if name not in self.counters:
            self.counters[name] = Counter(name=name, help=help)
        return self.counters[name]

    def histogram(self, name: str, help: str = "") -> Histogram:
        if name not in self.histograms:
            self.histograms[name] = Histogram(name=name, help=help)
        return self.histograms[name]


def prometheus_exposition(registry: MetricsRegistry) -> str:
    """Сформируйте Prometheus text exposition для счётчиков и гистограмм, включая HELP, TYPE, метки, накопительные buckets, sum и count."""
    raise NotImplementedError


def _format_le(bound: float) -> str:
    if bound == int(bound):
        return str(int(bound))
    return repr(bound)


# ---------------------------------------------------------------------------
# Span builder
# ---------------------------------------------------------------------------


@dataclass
class SpanBuilder:
    """Owns a trace id and emits spans through one or more exporters."""

    trace_id: str = field(default_factory=new_trace_id)
    exporters: list[Any] = field(default_factory=list)
    metrics: MetricsRegistry | None = None

    @contextmanager
    def span(
        self,
        name: str,
        attributes: dict[str, Any] | None = None,
        parent: GenAISpan | None = None,
        kind: str = "INTERNAL",
    ) -> Iterator[GenAISpan]:
        """Реализуйте контекстный менеджер жизненного цикла span: создание и связь с родителем, статусы успеха и ошибки, событие исключения, завершение, экспорт и обновление метрик инструментов."""
        raise NotImplementedError


# ---------------------------------------------------------------------------
# Demo
# ---------------------------------------------------------------------------


def run_demo() -> int:
    tmp_dir = tempfile.mkdtemp(prefix="otel-demo-")
    trace_path = os.path.join(tmp_dir, "traces.jsonl")

    jsonl = JSONLExporter(path=trace_path)
    metrics = MetricsRegistry()
    in_mem = InMemoryExporter()
    builder = SpanBuilder(exporters=[jsonl, in_mem], metrics=metrics)

    print("OBSERVABILITY DEMO")
    print(f"trace_id={builder.trace_id}")
    print(f"writing traces to {trace_path}")

    # Synthesize an agent turn: a gen_ai.chat span around two tool spans.
    with builder.span(
        "gen_ai.chat",
        attributes={
            GEN_AI_SYSTEM: "anthropic",
            GEN_AI_REQUEST_MODEL: "claude-track-a",
            GEN_AI_REQUEST_MAX_TOKENS: 1024,
            GEN_AI_REQUEST_TEMPERATURE: 0.0,
            GEN_AI_OPERATION_NAME: "chat",
        },
        kind="CLIENT",
    ) as chat_span:
        time.sleep(0.01)
        chat_span.attributes[GEN_AI_USAGE_INPUT_TOKENS] = 412
        chat_span.attributes[GEN_AI_USAGE_OUTPUT_TOKENS] = 96
        chat_span.attributes[GEN_AI_RESPONSE_MODEL] = "claude-track-a-2026-05-25"
        chat_span.attributes[GEN_AI_RESPONSE_ID] = "msg_" + uuid.uuid4().hex[:8]

        with builder.span(
            "gen_ai.tool.execution",
            parent=chat_span,
            attributes={
                GEN_AI_TOOL_NAME: "read_file",
                GEN_AI_TOOL_CALL_ID: "call_001",
            },
        ) as tool1:
            time.sleep(0.005)
            tool1.attributes[GEN_AI_TOOL_RESULT_BYTES] = 1024
            tool1.events.append(
                SpanEvent(
                    name="agent.harness.gate.decision",
                    timestamp_unix_nano=now_unix_nano(),
                    attributes={
                        HARNESS_GATE_DECISION: "ALLOW",
                        HARNESS_GATE_REASON: "passed gate chain",
                    },
                )
            )

        with builder.span(
            "gen_ai.tool.execution",
            parent=chat_span,
            attributes={
                GEN_AI_TOOL_NAME: "run_tests",
                GEN_AI_TOOL_CALL_ID: "call_002",
            },
        ) as tool2:
            time.sleep(0.003)
            tool2.attributes[GEN_AI_TOOL_RESULT_BYTES] = 256

    # A second turn with an intentionally denied gate to exercise an error span.
    try:
        with builder.span(
            "gen_ai.tool.execution",
            attributes={
                GEN_AI_TOOL_NAME: "shell",
                GEN_AI_TOOL_CALL_ID: "call_003",
            },
        ) as bad_tool:
            bad_tool.events.append(
                SpanEvent(
                    name="agent.harness.gate.decision",
                    timestamp_unix_nano=now_unix_nano(),
                    attributes={
                        HARNESS_GATE_DECISION: "DENY",
                        HARNESS_GATE_REASON: "tool not in allow-set",
                    },
                )
            )
            raise PermissionError("tool 'shell' not in allow-set")
    except PermissionError:
        pass

    print("")
    print(f"emitted {len(in_mem.spans)} span(s):")
    for span in in_mem.spans:
        attrs_compact = {
            k: v
            for k, v in span.attributes.items()
            if k.startswith("gen_ai.")
        }
        print(
            f"  - {span.name:32s} dur={span.duration_ms:7.2f}ms "
            f"status={span.status} keys={sorted(attrs_compact)[:3]}"
        )

    print("")
    print("--- prometheus exposition ---")
    print(prometheus_exposition(metrics))

    jsonl.close()

    # Sanity: roundtrip the jsonl file.
    with open(trace_path, "r", encoding="utf-8") as fh:
        lines = [json.loads(line) for line in fh if line.strip()]
    print(f"roundtrip parsed {len(lines)} spans from {trace_path}")

    return 0


if __name__ == "__main__":
    sys.exit(run_demo())
