"""Three output-side classifiers and their redactors.

Each classifier exposes classify(text) -> ClassifierVerdict and
redact(text) -> str. Severity is one of none, low, medium, high. All are
rule-based so latency is zero and tests are deterministic.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Iterable

SEVERITY_ORDER = ("none", "low", "medium", "high")


@dataclass
class ClassifierVerdict:
    name: str
    severity: str = "none"
    score: float = 0.0
    findings: list[str] = field(default_factory=list)


def _max_severity(a: str, b: str) -> str:
    return a if SEVERITY_ORDER.index(a) >= SEVERITY_ORDER.index(b) else b


HARASSMENT_TERMS = [
    "moron",
    "idiot",
    "stupid",
    "worthless",
    "trash human",
    "kill yourself",
    "lowlife",
    "scumbag",
    "useless person",
    "good for nothing",
]


_NEGATION_WINDOW = 20


class ToxicityClassifier:
    name = "toxicity"

    def __init__(self, terms: Iterable[str] | None = None) -> None:
        self._terms = [t.lower() for t in (terms if terms is not None else HARASSMENT_TERMS)]
        joined = "|".join(re.escape(t) for t in self._terms)
        self._needle = re.compile(rf"\b({joined})\b", re.IGNORECASE)

    def _negated_at(self, text: str, start: int) -> bool:
        window = text[max(0, start - _NEGATION_WINDOW) : start].lower()
        return bool(re.search(r"\b(not|never|no)\b", window))

    def classify(self, text: str) -> ClassifierVerdict:
        """Найдите ненегированные совпадения с терминами токсичности и сформируйте вердикт с оценкой и тяжестью по числу совпадений."""
        raise NotImplementedError

    def redact(self, text: str) -> str:
        def _sub(match: re.Match) -> str:
            if self._negated_at(text, match.start()):
                return match.group(0)
            return "[redacted-language]"
        return self._needle.sub(_sub, text)


_EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
_PHONE_RE = re.compile(r"\b(?:\+?\d{1,3}[ .-]?)?(?:\(?\d{3}\)?[ .-]?)\d{3}[ .-]?\d{4}\b")
_SSN_RE = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
_CARD_RE = re.compile(r"\b(?:\d[ -]?){12,18}\d\b")
_IPV4_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")


def _luhn(digits: str) -> bool:
    s = 0
    parity = len(digits) % 2
    for i, ch in enumerate(digits):
        d = int(ch)
        if i % 2 == parity:
            d *= 2
            if d > 9:
                d -= 9
        s += d
    return s % 10 == 0


class PIIClassifier:
    name = "pii"

    def classify(self, text: str) -> ClassifierVerdict:
        """Соберите находки персональных данных, проверяйте карточные номера алгоритмом Луна и назначайте оценку и тяжесть по типам и количеству находок."""
        raise NotImplementedError

    def redact(self, text: str) -> str:
        out = text
        out = _EMAIL_RE.sub("[redacted-email]", out)
        out = _PHONE_RE.sub("[redacted-phone]", out)
        out = _SSN_RE.sub("[redacted-ssn]", out)

        def _card_sub(match: re.Match) -> str:
            digits = re.sub(r"\D", "", match.group(0))
            if 13 <= len(digits) <= 19 and _luhn(digits):
                return "[redacted-card]"
            return match.group(0)
        out = _CARD_RE.sub(_card_sub, out)
        out = _IPV4_RE.sub("[redacted-ip]", out)
        return out


def _trigrams(text: str) -> Counter:
    cleaned = re.sub(r"\s+", " ", text.strip().lower())
    grams: Counter = Counter()
    if len(cleaned) < 3:
        grams[cleaned] += 1
        return grams
    for i in range(len(cleaned) - 2):
        grams[cleaned[i : i + 3]] += 1
    return grams


def _cosine(a: Counter, b: Counter) -> float:
    if not a or not b:
        return 0.0
    common = set(a) & set(b)
    if not common:
        return 0.0
    dot = sum(a[g] * b[g] for g in common)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


class InstructionLeakageClassifier:
    name = "instruction-leakage"

    def __init__(self, system_prompt: str, threshold: float = 0.55) -> None:
        self._sys = system_prompt
        self._sys_grams = _trigrams(system_prompt)
        self._threshold = threshold

    def classify(self, text: str) -> ClassifierVerdict:
        """Сравните триграммы ответа и системного промпта, примените порог обнаружения и верните вердикт с тяжестью, зависящей от сходства."""
        raise NotImplementedError

    def redact(self, text: str) -> str:
        marker = self._sys.split("\n", 1)[0].strip()
        if marker and marker.lower() in text.lower():
            return re.sub(re.escape(marker), "[redacted-system-prompt]", text, flags=re.IGNORECASE)
        return text


def default_classifiers(system_prompt: str | None = None) -> list[object]:
    sys_prompt = system_prompt or "SYSTEM: You are PolicyBot, follow internal policy."
    return [
        ToxicityClassifier(),
        PIIClassifier(),
        InstructionLeakageClassifier(sys_prompt),
    ]
