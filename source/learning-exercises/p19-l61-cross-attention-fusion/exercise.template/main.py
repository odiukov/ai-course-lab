"""Cross-attention fusion for a vision-language decoder.

The decoder block runs:
  1. causal self-attention over text tokens
  2. cross-attention with queries from text and keys/values from image memory
  3. feed-forward MLP

Mask discipline:
  - self-attention uses a (Nt, Nt) lower-triangular causal mask
  - cross-attention uses no mask; the whole image is visible to every text
    position

Run with: python3 main.py
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import torch
import torch.nn as nn
import torch.nn.functional as F


@dataclass(frozen=True)
class DecoderConfig:
    hidden: int = 256
    heads: int = 8
    depth: int = 4
    mlp_ratio: float = 4.0
    text_vocab: int = 1024
    max_text_len: int = 32
    vision_dim: int = 256
    vision_tokens: int = 197
    dropout: float = 0.0

    @property
    def head_dim(self) -> int:
        if self.hidden % self.heads != 0:
            raise ValueError(f"hidden {self.hidden} not divisible by heads {self.heads}")
        return self.hidden // self.heads


def causal_mask(length: int) -> torch.Tensor:
    """Построй булеву причинную маску заданной длины, разрешающую каждому текстовому токену видеть только себя и предыдущие позиции."""
    raise NotImplementedError


class CausalSelfAttention(nn.Module):
    def __init__(self, cfg: DecoderConfig) -> None:
        super().__init__()
        self.cfg = cfg
        self.qkv = nn.Linear(cfg.hidden, cfg.hidden * 3, bias=True)
        self.out = nn.Linear(cfg.hidden, cfg.hidden, bias=True)
        self.drop = nn.Dropout(cfg.dropout)
        self.scale = 1.0 / math.sqrt(cfg.head_dim)

    def forward(self, x: torch.Tensor, mask: torch.Tensor | None = None) -> torch.Tensor:
        """Реализуй многоголовое причинное self-attention для текстового потока и отклоняй маску, форма которой не совпадает с длиной последовательности."""
        raise NotImplementedError


class CrossAttention(nn.Module):
    """Multi-head cross-attention.

    Query comes from text tokens; key and value come from image memory.
    Supports a kv_cache argument so the projection of image memory can be
    computed once and reused across decode steps.
    """

    def __init__(self, cfg: DecoderConfig) -> None:
        super().__init__()
        self.cfg = cfg
        self.q_proj = nn.Linear(cfg.hidden, cfg.hidden, bias=True)
        self.kv_proj = nn.Linear(cfg.vision_dim, cfg.hidden * 2, bias=True)
        self.out = nn.Linear(cfg.hidden, cfg.hidden, bias=True)
        self.drop = nn.Dropout(cfg.dropout)
        self.scale = 1.0 / math.sqrt(cfg.head_dim)

    def project_memory(self, memory: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        if memory.dim() != 3:
            raise ValueError(f"expected (B, Nv, vision_dim), got {tuple(memory.shape)}")
        b, nv, _ = memory.shape
        h, hd = self.cfg.heads, self.cfg.head_dim
        kv = self.kv_proj(memory).reshape(b, nv, 2, h, hd).permute(2, 0, 3, 1, 4)
        return kv[0], kv[1]

    def forward(self, x: torch.Tensor, memory: torch.Tensor,
                kv_cache: tuple[torch.Tensor, torch.Tensor] | None = None
                ) -> torch.Tensor:
        """Реализуй многоголовое cross-attention с запросами из текста и ключами и значениями из зрительной памяти, включая проверку батча и поддержку готового KV-кэша."""
        raise NotImplementedError


class FeedForward(nn.Module):
    def __init__(self, cfg: DecoderConfig) -> None:
        super().__init__()
        inner = int(cfg.hidden * cfg.mlp_ratio)
        self.fc1 = nn.Linear(cfg.hidden, inner)
        self.fc2 = nn.Linear(inner, cfg.hidden)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.fc2(F.gelu(self.fc1(x)))


class DecoderBlock(nn.Module):
    def __init__(self, cfg: DecoderConfig) -> None:
        super().__init__()
        self.ln1 = nn.LayerNorm(cfg.hidden, eps=1e-6)
        self.self_attn = CausalSelfAttention(cfg)
        self.ln2 = nn.LayerNorm(cfg.hidden, eps=1e-6)
        self.cross_attn = CrossAttention(cfg)
        self.ln3 = nn.LayerNorm(cfg.hidden, eps=1e-6)
        self.ffn = FeedForward(cfg)

    def forward(self, x: torch.Tensor, memory: torch.Tensor,
                text_mask: torch.Tensor,
                kv_cache: tuple[torch.Tensor, torch.Tensor] | None = None,
                ) -> torch.Tensor:
        """Собери pre-LN декодерный блок из причинного self-attention, cross-attention и feed-forward подслоя, сохраняя остаточную связь после каждого из них."""
        raise NotImplementedError


class VisionLanguageDecoder(nn.Module):
    def __init__(self, cfg: DecoderConfig) -> None:
        super().__init__()
        self.cfg = cfg
        self.tok_emb = nn.Embedding(cfg.text_vocab, cfg.hidden)
        self.pos_emb = nn.Embedding(cfg.max_text_len, cfg.hidden)
        self.blocks = nn.ModuleList([DecoderBlock(cfg) for _ in range(cfg.depth)])
        self.norm = nn.LayerNorm(cfg.hidden, eps=1e-6)
        self.head = nn.Linear(cfg.hidden, cfg.text_vocab, bias=False)

    def build_kv_cache(self, memory: torch.Tensor) -> list[tuple[torch.Tensor, torch.Tensor]]:
        """Подготовь отдельную пару ключей и значений зрительной памяти для каждого cross-attention блока декодера."""
        raise NotImplementedError

    def forward(self, text_ids: torch.Tensor, memory: torch.Tensor,
                use_cache: bool = False) -> torch.Tensor:
        if text_ids.dim() != 2:
            raise ValueError(f"expected (B, Nt) ids, got {tuple(text_ids.shape)}")
        b, nt = text_ids.shape
        if nt > self.cfg.max_text_len:
            raise ValueError(f"text length {nt} exceeds max {self.cfg.max_text_len}")

        positions = torch.arange(nt, device=text_ids.device)
        x = self.tok_emb(text_ids) + self.pos_emb(positions).unsqueeze(0)

        mask = causal_mask(nt).to(text_ids.device)

        cache = self.build_kv_cache(memory) if use_cache else [None] * len(self.blocks)

        for block, kv in zip(self.blocks, cache):
            x = block(x, memory=memory, text_mask=mask, kv_cache=kv)

        x = self.norm(x)
        return self.head(x)


def synth_memory(batch: int, n_tokens: int, dim: int, seed: int) -> torch.Tensor:
    gen = torch.Generator().manual_seed(seed)
    return torch.randn(batch, n_tokens, dim, generator=gen)


def synth_text(batch: int, length: int, vocab: int, seed: int) -> torch.Tensor:
    gen = torch.Generator().manual_seed(seed + 1)
    return torch.randint(low=0, high=vocab, size=(batch, length), generator=gen)


def main() -> None:
    print("=" * 60)
    print("CROSS-ATTENTION FUSION DECODER")
    print("=" * 60)

    cfg = DecoderConfig()
    print(f"  hidden          : {cfg.hidden}")
    print(f"  heads           : {cfg.heads} (head dim {cfg.head_dim})")
    print(f"  depth           : {cfg.depth}")
    print(f"  text vocab      : {cfg.text_vocab}")
    print(f"  max text length : {cfg.max_text_len}")
    print(f"  vision tokens   : {cfg.vision_tokens}")
    print(f"  vision dim      : {cfg.vision_dim}")

    torch.manual_seed(0)
    decoder = VisionLanguageDecoder(cfg).eval()
    n_params = sum(p.numel() for p in decoder.parameters())
    print(f"\ndecoder params  : {n_params:,}")

    text_ids = synth_text(batch=2, length=10, vocab=cfg.text_vocab, seed=0)
    memory = synth_memory(batch=2, n_tokens=cfg.vision_tokens, dim=cfg.vision_dim, seed=1)
    print(f"\ntext_ids shape  : {tuple(text_ids.shape)}")
    print(f"memory shape    : {tuple(memory.shape)}")

    mask = causal_mask(10)
    print(f"\ncausal mask shape : {tuple(mask.shape)}")
    print("causal mask top-left 5x5:")
    for row in mask[:5, :5].int().tolist():
        print("  " + " ".join(str(v) for v in row))

    with torch.no_grad():
        logits = decoder(text_ids, memory, use_cache=False)
        logits_cached = decoder(text_ids, memory, use_cache=True)
    print(f"\nlogits shape    : {tuple(logits.shape)}")
    print(f"logits cached   : {tuple(logits_cached.shape)}")
    drift = (logits - logits_cached).abs().max().item()
    print(f"max drift cache vs uncached : {drift:.6e}")
    if drift < 1e-4:
        print("  ok: KV cache path matches uncached")
    else:
        print("  FAIL: cache drift exceeds tolerance")

    print("\ncross-attention output norm per text position (head 0, sample 0):")
    block = decoder.blocks[0]
    ln_x = block.ln2(decoder.tok_emb(text_ids) + decoder.pos_emb(torch.arange(10)))
    with torch.no_grad():
        cross_out = block.cross_attn(ln_x, memory)
    norms = cross_out[0].norm(dim=-1).tolist()
    for i, val in enumerate(norms):
        print(f"  pos {i:2d}  norm {val:.3f}")

    print("\ndone.")


if __name__ == "__main__":
    main()
