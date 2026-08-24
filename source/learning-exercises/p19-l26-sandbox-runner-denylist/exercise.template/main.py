"""
Sandbox runner with denylist, path jail, and timeout.

See: phases/19-capstone-projects/26-sandbox-runner-denylist/docs/en.md
Concept refs:
  - POSIX subprocess semantics (wall-clock timeout, return codes).
  - Symlink-safe path jail via realpath prefix check.
The demo at the bottom runs a battery of allow/deny calls and exits zero.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from typing import Iterable, Sequence


DENIED_EXIT_CODE = -100
TIMED_OUT_EXIT_CODE = -101

DEFAULT_DENYLIST: frozenset[str] = frozenset(
    {
        "rm",
        "sudo",
        "mkfs",
        "mkfs.ext4",
        "mkfs.fat",
        "curl",
        "wget",
        "chmod",
        "dd",
        "kill",
        "pkill",
        "shutdown",
        "reboot",
        "halt",
        "poweroff",
        "eval",
        "exec",
        "base64",
        "nc",
        "ncat",
        "telnet",
        "su",
        "iptables",
        "ufw",
    }
)

DEFAULT_INTERPRETER_BLOCK: frozenset[str] = frozenset(
    {
        "python",
        "python3",
        "bash",
        "sh",
        "zsh",
        "fish",
        "node",
        "deno",
        "perl",
        "ruby",
        "lua",
        "awk",
        "tclsh",
        "php",
    }
)

INTERPRETER_FLAG_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^-c$"),
    re.compile(r"^-e$"),
    re.compile(r"^--eval$"),
    re.compile(r"^--exec$"),
    re.compile(r"^-cu$"),
    re.compile(r"^-ce$"),
)

SHELL_METACHARS: tuple[str, ...] = (";", "|", "&", ">", "<", "`", "$(", "${", ")")

DEFAULT_MAX_OUTPUT_BYTES: int = 64 * 1024
DEFAULT_TIMEOUT_SECONDS: float = 30.0
TRUNCATION_MARKER: bytes = b"\n[sandbox: output truncated]\n"


# ---------------------------------------------------------------------------
# Result and configuration
# ---------------------------------------------------------------------------


@dataclass
class SandboxResult:
    """Structured outcome of a sandbox.run call."""

    argv: list[str]
    exit_code: int
    stdout: bytes = b""
    stderr: bytes = b""
    truncated: bool = False
    timed_out: bool = False
    denied: bool = False
    reason: str = ""
    duration_ms: float = 0.0

    @property
    def ok(self) -> bool:
        return self.exit_code == 0 and not self.denied and not self.timed_out

    def to_dict(self) -> dict:
        return {
            "argv": self.argv,
            "exit_code": self.exit_code,
            "stdout_bytes": len(self.stdout),
            "stderr_bytes": len(self.stderr),
            "truncated": self.truncated,
            "timed_out": self.timed_out,
            "denied": self.denied,
            "reason": self.reason,
            "duration_ms": round(self.duration_ms, 2),
        }


@dataclass
class SandboxConfig:
    """All knobs the sandbox accepts."""

    project_root: str
    max_output_bytes: int = DEFAULT_MAX_OUTPUT_BYTES
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS
    denylist: frozenset[str] = field(default_factory=lambda: DEFAULT_DENYLIST)
    interpreter_block: frozenset[str] = field(
        default_factory=lambda: DEFAULT_INTERPRETER_BLOCK
    )
    env_allowlist: tuple[str, ...] = ("PATH", "HOME", "LANG", "LC_ALL", "TERM")

    def __post_init__(self) -> None:
        # Resolve once and cache. The sandbox compares argument realpaths
        # against this value, so any later symlink resolution is consistent.
        self.project_root = os.path.realpath(self.project_root)


# ---------------------------------------------------------------------------
# Refusal helpers
# ---------------------------------------------------------------------------


def _basename(executable: str) -> str:
    return os.path.basename(executable.strip())


def _check_executable_denylist(argv: Sequence[str], cfg: SandboxConfig) -> str | None:
    """Проверь непустой argv и запрети исполняемый файл, если его basename входит в denylist конфигурации."""
    raise NotImplementedError


def _check_argv_interpreter(argv: Sequence[str], cfg: SandboxConfig) -> str | None:
    """Запрети запуск известных интерпретаторов с флагами выполнения переданного в argv кода, не запрещая запуск файлов-скриптов."""
    raise NotImplementedError


def _check_shell_metachars(argv: Sequence[str], shell: bool) -> str | None:
    """Обнаруживай shell-метасимволы во всех аргументах и возвращай причину отказа, когда shell-режим не включён."""
    raise NotImplementedError


_PATH_HINT = re.compile(r"[/\\]|^\.{1,2}$")


def _looks_like_path(arg: str) -> bool:
    """Conservative path-like detector.

    Returns True for arguments that look like file paths: contain a slash,
    are exactly . or .., or end in a common path-y suffix. The sandbox does
    not need to be exhaustive: any false negative just means the path is not
    jail-checked, which is fine for non-path arguments.
    """

    if not arg:
        return False
    if _PATH_HINT.search(arg):
        return True
    return False


def _check_path_jail(argv: Sequence[str], cfg: SandboxConfig) -> str | None:
    """Разрешай только path-like аргументы, чей realpath находится внутри project_root, включая защиту от относительного обхода и абсолютных внешних путей."""
    raise NotImplementedError


# ---------------------------------------------------------------------------
# Output truncation
# ---------------------------------------------------------------------------


def truncate_stream(buf: bytes, max_bytes: int) -> tuple[bytes, bool]:
    if len(buf) <= max_bytes:
        return buf, False
    head = buf[:max_bytes]
    return head + TRUNCATION_MARKER, True


# ---------------------------------------------------------------------------
# The sandbox
# ---------------------------------------------------------------------------


@dataclass
class Sandbox:
    """A subprocess runner that refuses dangerous calls and jails paths."""

    config: SandboxConfig

    def run(
        self,
        argv: Sequence[str],
        *,
        shell: bool = False,
        cwd: str | None = None,
        stdin: bytes | None = None,
    ) -> SandboxResult:
        """Собери проверки отказа и безопасный запуск subprocess: ограничь cwd корнем проекта, очисти окружение, обработай таймаут и отсутствие executable, обрежь потоки и верни структурированный SandboxResult."""
        raise NotImplementedError


# ---------------------------------------------------------------------------
# Helpers for the demo (cross-platform tool selection)
# ---------------------------------------------------------------------------


def find_executable(candidates: Iterable[str]) -> str | None:
    for name in candidates:
        path = _which(name)
        if path is not None:
            return path
    return None


def _which(name: str) -> str | None:
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        candidate = os.path.join(entry, name)
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None


# ---------------------------------------------------------------------------
# Demo
# ---------------------------------------------------------------------------


def _seed_project_root() -> str:
    """Create a temp project root with a single tracked file."""

    root = tempfile.mkdtemp(prefix="sandbox-demo-")
    with open(os.path.join(root, "hello.txt"), "w", encoding="utf-8") as fh:
        fh.write("hello from inside the sandbox\n")
    sub = os.path.join(root, "src")
    os.makedirs(sub, exist_ok=True)
    with open(os.path.join(sub, "main.py"), "w", encoding="utf-8") as fh:
        fh.write("print('main')\n")
    return root


def _print_outcome(label: str, result: SandboxResult) -> None:
    badge = (
        "OK"
        if result.ok
        else "DENIED"
        if result.denied
        else "TIMEOUT"
        if result.timed_out
        else f"EXIT {result.exit_code}"
    )
    print(f"  - {label:38s} -> {badge}")
    if result.denied or result.timed_out:
        print(f"      reason: {result.reason}")


def run_demo() -> int:
    """Self-terminating demo. Returns 0 on success."""

    root = _seed_project_root()
    config = SandboxConfig(
        project_root=root,
        max_output_bytes=512,
        timeout_seconds=2.0,
    )
    sandbox = Sandbox(config=config)

    echo = find_executable(("echo",)) or "echo"
    cat = find_executable(("cat",))
    yes = find_executable(("yes",))
    sleep = find_executable(("sleep",))
    ls = find_executable(("ls",))

    print("SANDBOX DEMO")
    print(f"project_root={root}")
    print("")

    print("legal calls:")
    if ls:
        _print_outcome("ls .", sandbox.run([ls, "."]))
    _print_outcome("echo hello", sandbox.run([echo, "hello", "from", "sandbox"]))
    if cat:
        _print_outcome("cat hello.txt", sandbox.run([cat, "hello.txt"]))
        _print_outcome("cat src/main.py", sandbox.run([cat, "src/main.py"]))

    print("")
    print("denied by name:")
    _print_outcome("rm -rf .", sandbox.run(["rm", "-rf", "."]))
    _print_outcome("sudo apt update", sandbox.run(["sudo", "apt", "update"]))
    _print_outcome("curl http://x", sandbox.run(["curl", "http://example.com"]))

    print("")
    print("denied by argv interpreter:")
    _print_outcome(
        "python3 -c '...'",
        sandbox.run(["python3", "-c", "print('hi')"]),
    )
    _print_outcome(
        "bash -c '...'",
        sandbox.run(["bash", "-c", "echo pwned"]),
    )

    print("")
    print("denied by shell metachar:")
    _print_outcome(
        "echo a ; rm -rf",
        sandbox.run([echo, "a", ";", "rm", "-rf"]),
    )

    print("")
    print("denied by path jail:")
    if cat:
        _print_outcome("cat ../../etc/passwd", sandbox.run([cat, "../../etc/passwd"]))
        _print_outcome("cat /etc/passwd", sandbox.run([cat, "/etc/passwd"]))

    print("")
    print("timeout / truncation:")
    if sleep:
        _print_outcome("sleep 5 (cap 2)", sandbox.run([sleep, "5"]))
    if yes:
        big = sandbox.run([yes, "y"])
        _print_outcome("yes y (truncated)", big)
    if echo:
        loud = sandbox.run([echo, "x" * 4096])
        _print_outcome("echo big (truncated)", loud)

    print("")
    print(
        json.dumps(
            {"project_root": root, "sandbox_ok": True},
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(run_demo())
