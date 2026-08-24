"""Experiment runner: subprocess sandbox with timeout, memory poller, ablation table.

Conceptual references:
- ./docs/en.md (this lesson)
- Phase 19 Track A lessons 20-29 (agent harness primitives)

Stdlib only. Run: python3 code/main.py
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Iterable


_LOGGER = logging.getLogger(__name__)
_MEMORY_POLLER_UNSUPPORTED_WARNED = False


@dataclass
class ExperimentSpec:
    spec_id: str
    hypothesis_id: int
    script_path: str
    config: dict
    seed: int = 0
    wall_timeout_s: float = 30.0
    memory_cap_mb: int = 512
    metric_keys: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "spec_id": self.spec_id,
            "hypothesis_id": self.hypothesis_id,
            "script_path": self.script_path,
            "config": dict(self.config),
            "seed": self.seed,
            "wall_timeout_s": self.wall_timeout_s,
            "memory_cap_mb": self.memory_cap_mb,
            "metric_keys": list(self.metric_keys),
        }


@dataclass
class ExperimentResult:
    spec_id: str
    hypothesis_id: int
    exit_code: int
    terminal: str
    wall_time_s: float
    peak_rss_mb: float | None
    metrics: dict
    intermediate_metrics: list[dict]
    stdout_tail: str
    stderr_tail: str

    def to_dict(self) -> dict:
        return {
            "spec_id": self.spec_id,
            "hypothesis_id": self.hypothesis_id,
            "exit_code": self.exit_code,
            "terminal": self.terminal,
            "wall_time_s": round(self.wall_time_s, 4),
            "peak_rss_mb": None if self.peak_rss_mb is None else round(self.peak_rss_mb, 2),
            "metrics": dict(self.metrics),
            "intermediate_metrics": [dict(m) for m in self.intermediate_metrics],
            "stdout_tail": self.stdout_tail[-400:],
            "stderr_tail": self.stderr_tail[-400:],
        }


def _rss_mb(pid: int) -> float | None:
    """Best effort RSS read in MB. Returns None on unsupported platforms."""
    proc_status = f"/proc/{pid}/status"
    if os.path.exists(proc_status):
        try:
            with open(proc_status, "rt", encoding="utf-8") as fh:
                for line in fh:
                    if line.startswith("VmRSS:"):
                        parts = line.split()
                        if len(parts) >= 2:
                            return float(parts[1]) / 1024.0
        except OSError:
            return None
        return 0.0
    if shutil.which("ps"):
        try:
            out = subprocess.run(
                ["ps", "-o", "rss=", "-p", str(pid)],
                capture_output=True, text=True, timeout=2.0,
            )
            value = out.stdout.strip()
            if value:
                return float(value) / 1024.0
        except (OSError, subprocess.SubprocessError, ValueError):
            return None
    return None


class _MemoryPoller(threading.Thread):
    """Polls subprocess RSS in MB; kills the process if it crosses the cap."""

    def __init__(self, proc: subprocess.Popen, cap_mb: int, interval_s: float = 0.05) -> None:
        super().__init__(daemon=True)
        self._proc = proc
        self._cap = cap_mb
        self._interval = interval_s
        self._stop_event = threading.Event()
        self.peak_rss_mb: float | None = None
        self.killed_for_oom = False
        self.unsupported = False

    def stop(self) -> None:
        self._stop_event.set()

    def run(self) -> None:
        global _MEMORY_POLLER_UNSUPPORTED_WARNED
        while not self._stop_event.is_set() and self._proc.poll() is None:
            rss = _rss_mb(self._proc.pid)
            if rss is None:
                self.unsupported = True
                if not _MEMORY_POLLER_UNSUPPORTED_WARNED:
                    _MEMORY_POLLER_UNSUPPORTED_WARNED = True
                    _LOGGER.warning(
                        "memory poller disabled: platform does not expose RSS via /proc or ps; wall clock timeout still applies",
                    )
                return
            self.peak_rss_mb = rss if self.peak_rss_mb is None else max(self.peak_rss_mb, rss)
            if rss > self._cap:
                self.killed_for_oom = True
                try:
                    self._proc.kill()
                except OSError:
                    pass
                return
            self._stop_event.wait(self._interval)


def _scan_intermediates(stdout: str, metric_keys: list[str]) -> tuple[dict, list[dict]]:
    """Разберите строки stdout: отфильтруйте подходящие JSON-объекты, выберите последний как итоговые метрики, а предыдущие сохраните как промежуточные."""
    raise NotImplementedError


class ExperimentRunner:
    """Spawn a subprocess, enforce timeout and memory cap, return an ExperimentResult."""

    def __init__(self, python_path: str | None = None, poll_interval_s: float = 0.05) -> None:
        self._python = python_path or sys.executable
        self._poll_interval = poll_interval_s

    def run(self, spec: ExperimentSpec) -> ExperimentResult:
        with tempfile.TemporaryDirectory(prefix="exp_") as workdir:
            config_path = os.path.join(workdir, "config.json")
            merged_config = dict(spec.config)
            merged_config["__seed"] = spec.seed
            with open(config_path, "w", encoding="utf-8") as fh:
                json.dump(merged_config, fh)
            return self._run_subprocess(spec, config_path)

    def _run_subprocess(self, spec: ExperimentSpec, config_path: str) -> ExperimentResult:
        """Запустите эксперимент в подпроцессе, примените ограничения времени и памяти, соберите оба потока и верните ExperimentResult с корректным терминальным состоянием."""
        raise NotImplementedError

    @staticmethod
    def _terminal_label(exit_code: int | None, timed_out: bool, oomed: bool, have_metrics: bool) -> str:
        if oomed:
            return "oom"
        if timed_out:
            return "timeout"
        if exit_code == 0 and have_metrics:
            return "ok"
        if exit_code == 0 and not have_metrics:
            return "crash"
        return "crash"


def ablate(base: ExperimentSpec, knob: str, values: Iterable[Any]) -> list[ExperimentSpec]:
    """Постройте по одной независимой спецификации на каждое значение ручки, сохранив параметры базового эксперимента и изменив только выбранную настройку и идентификатор."""
    raise NotImplementedError


@dataclass
class AblationTable:
    knob: str
    rows: list[tuple[Any, ExperimentResult]]

    def to_dict(self) -> dict:
        return {
            "knob": self.knob,
            "rows": [{"value": v, "result": r.to_dict()} for v, r in self.rows],
        }


class AblationRunner:
    def __init__(self, runner: ExperimentRunner) -> None:
        self._runner = runner

    def sweep(self, base: ExperimentSpec, knob: str, values: Iterable[Any]) -> AblationTable:
        """Последовательно выполните однофакторные спецификации и соберите результаты в AblationTable с привязкой каждой строки к исходному значению ручки."""
        raise NotImplementedError


def _demo() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    script = os.path.join(here, "experiments", "sparsity_experiment.py")
    base = ExperimentSpec(
        spec_id="demo_base",
        hypothesis_id=1,
        script_path=script,
        config={"k": 16, "steps": 4, "sleep_s": 0.0},
        seed=7,
        wall_timeout_s=15.0,
        memory_cap_mb=256,
        metric_keys=["perplexity", "final_loss"],
    )
    runner = ExperimentRunner()
    base_result = runner.run(base)
    sweep = AblationRunner(runner).sweep(base, "k", [4, 8, 16, 32])
    print(json.dumps({
        "base": base_result.to_dict(),
        "ablation": sweep.to_dict(),
    }, indent=2))


if __name__ == "__main__":
    _demo()
