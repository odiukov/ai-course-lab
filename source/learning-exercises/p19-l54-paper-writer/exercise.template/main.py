"""LaTeX paper skeleton generator with figure injection and a mocked prose generator.

Conceptual references:
- ./docs/en.md (this lesson)
- Phase 19 lessons 50-53 (earlier auto-research stages)

Stdlib only. Run: python3 code/main.py
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from typing import Callable, Iterable


class PaperValidationError(Exception):
    """Raised when the paper fails a structural gate before render."""


@dataclass
class BibEntry:
    key: str
    entry_type: str
    fields: dict

    def to_bibtex(self) -> str:
        lines = [f"@{self.entry_type}{{{self.key},"]
        for k, v in sorted(self.fields.items()):
            safe = str(v).replace("{", "").replace("}", "")
            lines.append(f"  {k} = {{{safe}}},")
        lines.append("}")
        return "\n".join(lines)


@dataclass
class Figure:
    id: str
    path: str
    caption: str
    width: str = "0.8\\textwidth"

    @property
    def label(self) -> str:
        return f"fig:{self.id}"


@dataclass
class Section:
    id: str
    title: str
    body: str = ""
    cites: list[str] = field(default_factory=list)
    figure_refs: list[str] = field(default_factory=list)

    @property
    def label(self) -> str:
        return f"sec:{self.id}"


@dataclass
class Paper:
    title: str
    authors: list[str]
    abstract: str
    sections: list[Section] = field(default_factory=list)
    figures: list[Figure] = field(default_factory=list)
    bibliography: list[BibEntry] = field(default_factory=list)


ProseGenerator = Callable[[Section, Paper], str]


def _validate(paper: Paper) -> None:
    """Реализуйте структурные проверки статьи: непустые заголовок и аннотация, уникальные идентификаторы фигур и ключи библиографии, существование всех ссылок на фигуры и цитаты."""
    raise NotImplementedError


def _escape_latex(text: str) -> str:
    repl = {
        "\\": r"\textbackslash{}",
        "&": r"\&",
        "%": r"\%",
        "$": r"\$",
        "#": r"\#",
        "_": r"\_",
        "{": r"\{",
        "}": r"\}",
        "~": r"\textasciitilde{}",
        "^": r"\textasciicircum{}",
    }
    out_chars: list[str] = []
    for ch in text:
        out_chars.append(repl.get(ch, ch))
    return "".join(out_chars)


def render_latex(paper: Paper) -> str:
    """Соберите полный LaTeX-документ из Paper, сохранив контракт секций, стабильных меток, фигур, ссылок, цитат и подключения библиографии."""
    raise NotImplementedError


def render_bibtex(paper: Paper) -> str:
    return "\n\n".join(b.to_bibtex() for b in paper.bibliography) + ("\n" if paper.bibliography else "")


class MockProseGenerator:
    """Deterministic prose generator. Substitutes for a model in tests and demos."""

    def __init__(self, outlines: dict[str, str]) -> None:
        self.outlines = outlines

    def __call__(self, section: Section, paper: Paper) -> str:
        seed = self.outlines.get(section.id, section.title)
        first = f"In this section we discuss {section.title.lower()}: {seed}."
        bits: list[str] = []
        for fid in section.figure_refs:
            bits.append(f"Figure~\\ref{{fig:{fid}}} shows the relevant artifact.")
        for c in section.cites:
            bits.append(f"This builds on prior work~\\cite{{{c}}}.")
        second = " ".join(bits) if bits else "We discuss implications below."
        return first + "\n\n" + second


def read_experiment_manifest(manifests: Iterable[dict], paper_dir: str) -> list[Figure]:
    """Преобразуйте артефакты экспериментальных манифестов в Figure: пропускайте пустые пути, создавайте стабильные уникальные идентификаторы и нормализуйте пути относительно каталога статьи."""
    raise NotImplementedError


@dataclass
class PaperWriter:
    prose: ProseGenerator

    def fill_prose(self, paper: Paper) -> Paper:
        for sec in paper.sections:
            if not sec.body:
                sec.body = self.prose(sec, paper)
        return paper

    def write(self, paper: Paper, out_dir: str) -> dict:
        """Организуйте полный цикл записи статьи: заполните пустые тела секций, отрендерите LaTeX и BibTeX, создайте три выходных файла и верните согласованный манифест."""
        raise NotImplementedError


def demo(out_dir: str | None = None) -> dict:
    """Self-contained demo. Builds a small paper from two mocked experiments.

    Writes into a temp directory by default so the worktree stays clean.
    """
    import tempfile as _tempfile
    if out_dir is None:
        out_dir = _tempfile.mkdtemp(prefix="paper-writer-demo-")
    experiments = [
        {"name": "loss-curve", "artifacts": [
            {"path": "figs/loss.pdf", "caption": "Training loss across epochs"},
        ]},
        {"name": "ablation", "artifacts": [
            {"path": "figs/ablation.pdf", "caption": "Ablation over decoder width"},
        ]},
    ]
    figs = read_experiment_manifest(experiments, out_dir)
    paper = Paper(
        title="Auto-Research Loop: Empirical Notes",
        authors=["Lab Bot"],
        abstract="We describe a small experiment harness that emits LaTeX from structured outputs.",
        sections=[
            Section(id="intro", title="Introduction", cites=["smith2020"],
                    figure_refs=[]),
            Section(id="method", title="Method", cites=["jones2021"],
                    figure_refs=[figs[0].id]),
            Section(id="results", title="Results", cites=[],
                    figure_refs=[figs[1].id]),
        ],
        figures=figs,
        bibliography=[
            BibEntry(key="smith2020", entry_type="article",
                     fields={"title": "On harnesses", "author": "Smith", "year": "2020"}),
            BibEntry(key="jones2021", entry_type="article",
                     fields={"title": "On loops", "author": "Jones", "year": "2021"}),
        ],
    )
    prose = MockProseGenerator(outlines={
        "intro": "we motivate the auto-research loop",
        "method": "we describe the skeleton-first writer",
        "results": "we present two ablations",
    })
    writer = PaperWriter(prose=prose)
    return writer.write(paper, out_dir)


if __name__ == "__main__":
    manifest = demo()
    print(json.dumps({
        "sections": len(manifest["sections"]),
        "figures": len(manifest["figures"]),
        "bib_keys": manifest["bibliography"],
        "tex_path": manifest["tex_path"],
    }, indent=2))
