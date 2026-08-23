"""Multi-turn critic loop for a paper draft with five fixed scoring dimensions.

Conceptual references:
- ./docs/en.md (this lesson)
- Phase 19 lesson 54 (paper writer; provides the draft shape)
- Phase 19 lessons 50-53 (earlier auto-research stages)

Stdlib only. Run: python3 code/main.py
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Callable, Protocol


DIMENSIONS: tuple[str, ...] = (
    "clarity",
    "novelty",
    "evidence",
    "methodology",
    "related_work",
)


@dataclass
class MiniSection:
    """Minimal section shape for the critic loop. Mirrors lesson 54 Section."""
    id: str
    title: str
    body: str = ""
    figure_refs: list[str] = field(default_factory=list)
    cites: list[str] = field(default_factory=list)


@dataclass
class MiniPaper:
    """Minimal paper shape for the critic loop. Mirrors lesson 54 Paper."""
    title: str
    abstract: str
    sections: list[MiniSection] = field(default_factory=list)
    originality_tag: str = "low"
    citation_count_target: int = 4
    figure_count_target: int = 2


@dataclass
class Suggestion:
    dimension: str
    target_section_id: str | None
    edit: str

    def to_dict(self) -> dict:
        return {
            "dimension": self.dimension,
            "target_section_id": self.target_section_id,
            "edit": self.edit,
        }


@dataclass
class Critique:
    round: int
    scores: dict[str, float]
    suggestions: list[Suggestion]
    reason: str

    def mean(self) -> float:
        if not self.scores:
            return 0.0
        return sum(self.scores.values()) / len(self.scores)

    def to_dict(self) -> dict:
        return {
            "round": self.round,
            "scores": dict(self.scores),
            "mean": self.mean(),
            "suggestions": [s.to_dict() for s in self.suggestions],
            "reason": self.reason,
        }


class Critic(Protocol):
    def __call__(self, paper: MiniPaper, round_: int) -> Critique: ...


class Reviser(Protocol):
    def __call__(self, paper: MiniPaper, suggestions: list[Suggestion]) -> MiniPaper: ...


@dataclass
class LoopTrace:
    round: int
    scores: dict[str, float]
    mean: float
    suggestions_applied: int
    verdict: str

    def to_dict(self) -> dict:
        return {
            "round": self.round,
            "scores": dict(self.scores),
            "mean": self.mean,
            "suggestions_applied": self.suggestions_applied,
            "verdict": self.verdict,
        }


@dataclass
class LoopResult:
    status: str
    reason: str
    rounds_used: int
    final_scores: dict[str, float]
    final_mean: float
    paper: MiniPaper
    trace: list[LoopTrace]

    def to_dict(self) -> dict:
        return {
            "status": self.status,
            "reason": self.reason,
            "rounds_used": self.rounds_used,
            "final_scores": dict(self.final_scores),
            "final_mean": self.final_mean,
            "trace": [t.to_dict() for t in self.trace],
        }


class CriticLoop:
    """Drives critic -> reviser -> convergence-check until a stop condition fires."""

    def __init__(
        self,
        critic: Critic,
        reviser: Reviser,
        max_rounds: int = 5,
        target_score: float = 8.0,
        plateau_epsilon: float = 0.1,
        plateau_window: int = 2,
    ) -> None:
        if max_rounds < 1:
            raise ValueError("max_rounds must be >= 1")
        if plateau_window < 1:
            raise ValueError("plateau_window must be >= 1")
        self.critic = critic
        self.reviser = reviser
        self.max_rounds = max_rounds
        self.target_score = target_score
        self.plateau_epsilon = plateau_epsilon
        self.plateau_window = plateau_window

    def _target_met(self, critique: Critique) -> bool:
        return all(critique.scores.get(d, 0.0) >= self.target_score for d in DIMENSIONS)

    def _plateau(self, trace: list[LoopTrace]) -> bool:
        if len(trace) < self.plateau_window + 1:
            return False
        recent = trace[-(self.plateau_window + 1):]
        for i in range(1, len(recent)):
            if recent[i].mean - recent[i - 1].mean > self.plateau_epsilon:
                return False
        return True

    def run(self, paper: MiniPaper) -> LoopResult:
        """Реализуй цикл критики и ревизии с накоплением трассы и остановкой в строгом порядке: достижение цели, плато, исчерпание бюджета раундов."""
        raise NotImplementedError


def deterministic_score(paper: MiniPaper) -> dict[str, float]:
    """Рассчитай оценки черновика по пяти фиксированным измерениям на основе длины разделов, originality_tag, иллюстраций, цитат и наличия содержательных разделов Method и Related Work; верни значения в диапазоне 0–10."""
    raise NotImplementedError


def deterministic_critic(paper: MiniPaper, round_: int) -> Critique:
    """Оцени статью и сформируй Critique с номером раунда и структурированными предложениями для каждого измерения, не достигшего порога 8.0."""
    raise NotImplementedError


def deterministic_reviser(paper: MiniPaper, suggestions: list[Suggestion]) -> MiniPaper:
    """Примени структурированные edit-инструкции к указанным разделам или метаданным статьи, сохраняя заданную семантику каждого типа правки и возвращая изменённый объект статьи."""
    raise NotImplementedError


def make_deterministic_critic_pair() -> tuple[Critic, Reviser]:
    return deterministic_critic, deterministic_reviser


def demo() -> dict:
    paper = MiniPaper(
        title="Auto-Research Loop",
        abstract="abstract",
        sections=[
            MiniSection(id="intro", title="Introduction", body="short intro"),
        ],
        originality_tag="low",
    )
    critic, reviser = make_deterministic_critic_pair()
    loop = CriticLoop(critic=critic, reviser=reviser, max_rounds=6, target_score=8.0)
    result = loop.run(paper)
    return result.to_dict()


if __name__ == "__main__":
    print(json.dumps(demo(), indent=2))
