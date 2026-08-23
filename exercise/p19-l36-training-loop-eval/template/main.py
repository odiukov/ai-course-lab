"""Training loop and evaluation harness for the lesson 35 GPT model.

Implements: batch construction with input/target shift by one, cross entropy
loss in `calc_loss_batch`, held-out evaluation in `evaluate_model`, a qualitative
generation probe in `generate_and_print_sample`, AdamW with a decay/no-decay
split, a linear-warmup-plus-cosine learning rate schedule, gradient norm
clipping, and a JSONL log of per step loss in `outputs/losses.jsonl`.

The demo trains a tiny model on synthetic byte-level tokens for a small number
of steps, writes the JSONL log, and prints eval losses and generated samples
at the probe points. End to end runs in well under a minute on CPU.

Run: python3 code/main.py
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

import torch
import torch.nn as nn
import torch.nn.functional as F

HERE = Path(__file__).resolve().parent
OUTPUTS = HERE.parent / "outputs"
OUTPUTS.mkdir(parents=True, exist_ok=True)
LOG_PATH = OUTPUTS / "losses.jsonl"


@dataclass
class TrainConfig:
    """Training and evaluation hyperparameters for the demo run."""

    batch_size: int = 4
    context_length: int = 32
    num_steps: int = 80
    eval_every: int = 20
    eval_batches: int = 4
    max_lr: float = 3e-3
    min_lr: float = 3e-4
    warmup_steps: int = 10
    weight_decay: float = 0.01
    grad_clip: float = 1.0
    sample_max_new_tokens: int = 16
    seed: int = 0


@dataclass
class ModelConfig:
    vocab_size: int = 256
    context_length: int = 32
    d_model: int = 64
    num_heads: int = 4
    num_layers: int = 2
    mlp_expansion: int = 4
    dropout: float = 0.1
    use_bias: bool = True
    weight_tying: bool = True


class LayerNorm(nn.Module):
    def __init__(self, d_model: int, eps: float = 1e-5) -> None:
        super().__init__()
        self.eps = eps
        self.scale = nn.Parameter(torch.ones(d_model))
        self.shift = nn.Parameter(torch.zeros(d_model))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        mean = x.mean(dim=-1, keepdim=True)
        var = x.var(dim=-1, keepdim=True, unbiased=False)
        return self.scale * (x - mean) / torch.sqrt(var + self.eps) + self.shift


class MultiHeadAttention(nn.Module):
    def __init__(self, cfg: ModelConfig) -> None:
        super().__init__()
        if cfg.d_model % cfg.num_heads != 0:
            raise ValueError("d_model must be divisible by num_heads")
        self.d_model = cfg.d_model
        self.num_heads = cfg.num_heads
        self.head_dim = cfg.d_model // cfg.num_heads
        self.context_length = cfg.context_length
        self.qkv = nn.Linear(cfg.d_model, 3 * cfg.d_model, bias=cfg.use_bias)
        self.out_proj = nn.Linear(cfg.d_model, cfg.d_model, bias=cfg.use_bias)
        self.attn_dropout = nn.Dropout(cfg.dropout)
        self.resid_dropout = nn.Dropout(cfg.dropout)
        mask = torch.triu(
            torch.ones(cfg.context_length, cfg.context_length, dtype=torch.bool),
            diagonal=1,
        )
        self.register_buffer("causal_mask", mask, persistent=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        batch, seq, dim = x.shape
        qkv = self.qkv(x)
        q, k, v = qkv.split(self.d_model, dim=-1)
        q = q.view(batch, seq, self.num_heads, self.head_dim).transpose(1, 2)
        k = k.view(batch, seq, self.num_heads, self.head_dim).transpose(1, 2)
        v = v.view(batch, seq, self.num_heads, self.head_dim).transpose(1, 2)
        scores = q @ k.transpose(-2, -1) / math.sqrt(self.head_dim)
        scores = scores.masked_fill(self.causal_mask[:seq, :seq], float("-inf"))
        attn = F.softmax(scores, dim=-1)
        attn = self.attn_dropout(attn)
        out = (attn @ v).transpose(1, 2).contiguous().view(batch, seq, dim)
        return self.resid_dropout(self.out_proj(out))


class FeedForward(nn.Module):
    def __init__(self, cfg: ModelConfig) -> None:
        super().__init__()
        hidden = cfg.mlp_expansion * cfg.d_model
        self.fc1 = nn.Linear(cfg.d_model, hidden, bias=cfg.use_bias)
        self.act = nn.GELU(approximate="tanh")
        self.fc2 = nn.Linear(hidden, cfg.d_model, bias=cfg.use_bias)
        self.dropout = nn.Dropout(cfg.dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.dropout(self.fc2(self.act(self.fc1(x))))


class TransformerBlock(nn.Module):
    def __init__(self, cfg: ModelConfig) -> None:
        super().__init__()
        self.ln1 = LayerNorm(cfg.d_model)
        self.attn = MultiHeadAttention(cfg)
        self.ln2 = LayerNorm(cfg.d_model)
        self.mlp = FeedForward(cfg)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x + self.attn(self.ln1(x))
        x = x + self.mlp(self.ln2(x))
        return x


class GPTModel(nn.Module):
    def __init__(self, cfg: ModelConfig) -> None:
        super().__init__()
        self.cfg = cfg
        self.tok_embed = nn.Embedding(cfg.vocab_size, cfg.d_model)
        self.pos_embed = nn.Embedding(cfg.context_length, cfg.d_model)
        self.embed_dropout = nn.Dropout(cfg.dropout)
        self.blocks = nn.ModuleList([TransformerBlock(cfg) for _ in range(cfg.num_layers)])
        self.final_ln = LayerNorm(cfg.d_model)
        self.lm_head = nn.Linear(cfg.d_model, cfg.vocab_size, bias=False)
        if cfg.weight_tying:
            self.lm_head.weight = self.tok_embed.weight
        self.register_buffer(
            "position_ids",
            torch.arange(cfg.context_length, dtype=torch.long),
            persistent=False,
        )
        self.apply(self._init_weights)
        scale = 1.0 / math.sqrt(2 * cfg.num_layers)
        for block in self.blocks:
            block.attn.out_proj.weight.data.mul_(scale)
            block.mlp.fc2.weight.data.mul_(scale)

    @staticmethod
    def _init_weights(module: nn.Module) -> None:
        if isinstance(module, nn.Linear):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)
            if module.bias is not None:
                nn.init.zeros_(module.bias)
        elif isinstance(module, nn.Embedding):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)

    def forward(self, tokens: torch.Tensor) -> torch.Tensor:
        batch, seq = tokens.shape
        tok = self.tok_embed(tokens)
        pos = self.pos_embed(self.position_ids[:seq])
        x = self.embed_dropout(tok + pos)
        for block in self.blocks:
            x = block(x)
        return self.lm_head(self.final_ln(x))


def make_batches(
    token_ids: torch.Tensor,
    batch_size: int,
    context_length: int,
    seed: int = 0,
) -> Iterator[tuple[torch.Tensor, torch.Tensor]]:
    """Yield (input, target) batches where target is input shifted by one position.

    Sampling is uniform random over valid start positions. With a fixed seed the
    sequence of batches is reproducible across runs.
    """
    if token_ids.dim() != 1:
        raise ValueError("token_ids must be a 1D tensor")
    if token_ids.numel() < context_length + 1:
        raise ValueError("token_ids too short for the requested context_length")

    generator = torch.Generator().manual_seed(seed)
    max_start = token_ids.numel() - context_length - 1

    while True:
        starts = torch.randint(0, max_start + 1, (batch_size,), generator=generator)
        inputs = torch.stack([token_ids[s : s + context_length] for s in starts.tolist()])
        targets = torch.stack(
            [token_ids[s + 1 : s + 1 + context_length] for s in starts.tolist()]
        )
        yield inputs, targets


def calc_loss_batch(
    model: GPTModel,
    inputs: torch.Tensor,
    targets: torch.Tensor,
) -> torch.Tensor:
    """Вычисли скалярную кросс-энтропию предсказаний модели по целевым токенам для всех элементов батча и позиций."""
    raise NotImplementedError


@torch.no_grad()
def evaluate_model(
    model: GPTModel,
    val_loader: Iterator[tuple[torch.Tensor, torch.Tensor]],
    max_batches: int,
) -> float:
    """Рассчитай средний loss на заданном числе validation-батчей без градиентов и dropout, сохранив исходный режим модели."""
    raise NotImplementedError


@torch.no_grad()
def generate_and_print_sample(
    model: GPTModel,
    prompt: torch.Tensor,
    max_new_tokens: int,
    temperature: float = 1.0,
    top_k: int = 40,
    seed: int = 0,
) -> list[int]:
    """Print a short generated continuation from a fixed prompt and return the tokens."""
    sample_gen = torch.Generator(device=prompt.device).manual_seed(seed)
    was_training = model.training
    model.eval()
    tokens = prompt.clone()
    for _ in range(max_new_tokens):
        window = tokens[:, -model.cfg.context_length :]
        logits = model(window)
        next_logits = logits[:, -1, :] / temperature
        if top_k > 0:
            top_k_eff = min(top_k, next_logits.size(-1))
            values, _ = torch.topk(next_logits, top_k_eff, dim=-1)
            threshold = values[..., -1:]
            next_logits = torch.where(
                next_logits < threshold, torch.full_like(next_logits, float("-inf")), next_logits
            )
        probs = F.softmax(next_logits, dim=-1)
        next_token = torch.multinomial(probs, num_samples=1, generator=sample_gen)
        tokens = torch.cat([tokens, next_token], dim=1)
    if was_training:
        model.train()
    seq = tokens.tolist()[0]
    print(f"  sample tokens          : {seq}")
    return seq


def build_param_groups(model: nn.Module, weight_decay: float) -> list[dict]:
    """Раздели обучаемые параметры для AdamW на группу с weight decay для весовых матриц и группу без decay для bias и параметров нормализации."""
    raise NotImplementedError


def cosine_with_warmup(
    step: int,
    warmup_steps: int,
    total_steps: int,
    max_lr: float,
    min_lr: float,
) -> float:
    """Реализуй линейный разогрев learning rate до максимума и последующее косинусное снижение до минимального значения."""
    raise NotImplementedError


def train(
    model: GPTModel,
    train_tokens: torch.Tensor,
    val_tokens: torch.Tensor,
    cfg: TrainConfig,
    prompt: torch.Tensor,
    log_path: Path = LOG_PATH,
) -> list[dict]:
    """Собери цикл обучения с обновлением learning rate, backpropagation, clipping градиентов, периодической оценкой и построчной записью метрик в JSONL."""
    raise NotImplementedError


def _synthetic_byte_tokens(length: int, vocab_size: int, seed: int) -> torch.Tensor:
    """Deterministic synthetic tokens.

    Bytes drawn from a small repeating pattern so the model has structure to learn
    in a handful of steps; the eval loss should drop visibly during the demo.
    """
    rng = torch.Generator().manual_seed(seed)
    base = torch.randint(0, vocab_size, (32,), generator=rng)
    repeats = (length + base.numel() - 1) // base.numel()
    tokens = base.repeat(repeats)[:length]
    noise = torch.randint(0, vocab_size, (length,), generator=rng)
    mask = (torch.rand(length, generator=rng) < 0.1)
    tokens = torch.where(mask, noise, tokens)
    return tokens.to(dtype=torch.long)


def demo() -> None:
    torch.manual_seed(0)
    cfg = TrainConfig()
    mcfg = ModelConfig(
        vocab_size=256,
        context_length=cfg.context_length,
        d_model=64,
        num_heads=4,
        num_layers=2,
        dropout=0.0,
    )

    train_tokens = _synthetic_byte_tokens(length=4096, vocab_size=mcfg.vocab_size, seed=1)
    val_tokens = _synthetic_byte_tokens(length=1024, vocab_size=mcfg.vocab_size, seed=2)

    print(f"train tokens   : {train_tokens.numel():,}")
    print(f"val tokens     : {val_tokens.numel():,}")
    print(f"model params   : {sum(p.numel() for p in GPTModel(mcfg).parameters()):,} (untied count)")

    model = GPTModel(mcfg)
    prompt = torch.tensor([[7, 11, 13, 17]], dtype=torch.long)

    print("\nTraining run:")
    records = train(model, train_tokens, val_tokens, cfg, prompt)

    print("\nFinal log records (last 3):")
    for record in records[-3:]:
        print(" ", record)
    print(f"\nWrote losses to {LOG_PATH}")

    first_loss = records[0]["train_loss"]
    last_loss = records[-1]["train_loss"]
    print(f"First step train_loss  : {first_loss:.4f}")
    print(f"Last step train_loss   : {last_loss:.4f}")
    assert last_loss < first_loss, "training loss should decrease across the demo run"
    print("Training loop check passed.")


if __name__ == "__main__":
    demo()
