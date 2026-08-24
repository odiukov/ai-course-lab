"""Vision-language pretraining: contrastive InfoNCE plus language modeling.

The model combines a small ViT encoder (lesson 59), a two-layer projection
(lesson 60), and a cross-attention decoder (lesson 61). Training runs for 50
steps over a synthetic 200-pair mock corpus. Both contrastive and LM losses
share gradients through the encoder and projection.

Run with: python3 main.py
"""

from __future__ import annotations

import importlib.util
import math
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

THIS_DIR = Path(__file__).resolve().parent
PHASE_ROOT = THIS_DIR / "_resources"
if not PHASE_ROOT.is_dir():
    PHASE_ROOT = THIS_DIR.parent.parent
LESSON_59 = PHASE_ROOT / "59-vit-transformer" / "code"
LESSON_60 = PHASE_ROOT / "60-projection-layer-modality-align" / "code"
LESSON_61 = PHASE_ROOT / "61-cross-attention-fusion" / "code"


def _load_module(name: str, path: Path):
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"could not load {path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


_encoder_mod = _load_module("vit_encoder_lesson59", LESSON_59 / "main.py")
_align_mod = _load_module("align_lesson60", LESSON_60 / "main.py")
_dec_mod = _load_module("decoder_lesson61", LESSON_61 / "main.py")

ViTConfig = _encoder_mod.ViTConfig
VisionEncoder = _encoder_mod.VisionEncoder
synthesize_image = _encoder_mod.synthesize_image
MLPProjector = _align_mod.MLPProjector
DecoderConfig = _dec_mod.DecoderConfig
VisionLanguageDecoder = _dec_mod.VisionLanguageDecoder


PAD_ID = 0


@dataclass(frozen=True)
class PretrainConfig:
    vision_hidden: int = 128
    projection_hidden: int = 256
    embed_dim: int = 128
    text_vocab: int = 512
    max_text_len: int = 16
    n_pairs: int = 200
    batch_size: int = 16
    steps: int = 50
    lr: float = 5e-4
    lm_weight: float = 1.0
    init_log_tau: float = math.log(1.0 / 0.07)
    seed: int = 0


def info_nce_loss(image_emb: torch.Tensor, text_emb: torch.Tensor,
                  log_tau: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
    """Реализуй двунаправленную InfoNCE-потерю для батча пар изображений и текстов с L2-нормализацией, обучаемым масштабом температуры и диагональными целями."""
    raise NotImplementedError


def lm_loss(logits: torch.Tensor, target_ids: torch.Tensor,
            padding_id: int = PAD_ID) -> torch.Tensor:
    """Вычисли кросс-энтропию следующего токена по батчу последовательностей, полностью исключив позиции с идентификатором паддинга."""
    raise NotImplementedError


class TextSideEncoder(nn.Module):
    """Tiny text encoder: embedding lookup + mean pool over non-padding tokens."""

    def __init__(self, vocab_size: int, embed_dim: int) -> None:
        super().__init__()
        self.embed = nn.Embedding(vocab_size, embed_dim, padding_idx=PAD_ID)

    def forward(self, ids: torch.Tensor) -> torch.Tensor:
        if ids.dim() != 2:
            raise ValueError(f"expected (B, L), got {tuple(ids.shape)}")
        x = self.embed(ids)
        mask = (ids != PAD_ID).float().unsqueeze(-1)
        denom = mask.sum(dim=1).clamp(min=1.0)
        return (x * mask).sum(dim=1) / denom


class MultimodalModel(nn.Module):
    """Encoder + projection + text side + cross-attention decoder, all trainable."""

    def __init__(self, cfg: PretrainConfig) -> None:
        super().__init__()
        self.cfg = cfg

        vit_cfg = ViTConfig(
            image_size=32,
            patch_size=16,
            hidden=cfg.vision_hidden,
            depth=2,
            heads=4,
            mlp_ratio=2.0,
        )
        self.encoder = VisionEncoder(vit_cfg)
        self.projector = MLPProjector(cfg.vision_hidden, cfg.projection_hidden, cfg.embed_dim)
        self.text_encoder = TextSideEncoder(cfg.text_vocab, cfg.embed_dim)

        dec_cfg = DecoderConfig(
            hidden=cfg.embed_dim,
            heads=4,
            depth=2,
            mlp_ratio=2.0,
            text_vocab=cfg.text_vocab,
            max_text_len=cfg.max_text_len,
            vision_dim=cfg.vision_hidden,
            vision_tokens=(32 // 16) ** 2 + 1,
        )
        self.decoder = VisionLanguageDecoder(dec_cfg)

        self.log_tau = nn.Parameter(torch.tensor(cfg.init_log_tau))

    def encode_image(self, images: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        tokens, cls = self.encoder(images)
        return tokens, self.projector(cls)

    def caption_logits(self, memory: torch.Tensor, text_ids: torch.Tensor) -> torch.Tensor:
        return self.decoder(text_ids, memory)

    def forward(self, images: torch.Tensor, text_ids: torch.Tensor
                ) -> tuple[torch.Tensor, torch.Tensor, dict]:
        """Соедини визуальное и текстовое кодирование, контрастивную цель и сдвинутую авторегрессионную LM-цель; верни обе конечные потери и диагностические показатели сходства и температуры."""
        raise NotImplementedError


def make_mock_corpus(seed: int, n_pairs: int, vocab_size: int, max_len: int
                     ) -> list[tuple[torch.Tensor, torch.Tensor]]:
    """Собери детерминированный синтетический корпус пар «изображение — последовательность токенов» заданного размера, соблюдая ожидаемые формы, диапазон идентификаторов и заполнение паддингом."""
    raise NotImplementedError


def sample_batch(pairs: list[tuple[torch.Tensor, torch.Tensor]], indices: list[int]
                 ) -> tuple[torch.Tensor, torch.Tensor]:
    imgs = torch.cat([pairs[i][0] for i in indices], dim=0)
    ids = torch.cat([pairs[i][1] for i in indices], dim=0)
    return imgs, ids


def train(cfg: PretrainConfig) -> dict:
    torch.manual_seed(cfg.seed)
    model = MultimodalModel(cfg).train()
    opt = torch.optim.Adam(model.parameters(), lr=cfg.lr)
    corpus = make_mock_corpus(cfg.seed + 1, cfg.n_pairs, cfg.text_vocab, cfg.max_text_len)
    if cfg.batch_size > len(corpus):
        raise ValueError(
            f"batch_size ({cfg.batch_size}) cannot exceed corpus size ({len(corpus)}) "
            "with replace=False"
        )

    rng = np.random.default_rng(cfg.seed + 2)
    history = {"contrast": [], "lm": [], "total": []}

    for step in range(cfg.steps):
        idx = rng.choice(len(corpus), size=cfg.batch_size, replace=False).tolist()
        imgs, ids = sample_batch(corpus, idx)
        contrast, lm, stats = model(imgs, ids)
        total = contrast + cfg.lm_weight * lm
        opt.zero_grad(set_to_none=True)
        total.backward()
        opt.step()

        history["contrast"].append(contrast.item())
        history["lm"].append(lm.item())
        history["total"].append(total.item())

        if step % 5 == 0 or step == cfg.steps - 1:
            print(f"  step {step:3d}  contrast {contrast.item():.4f}  "
                  f"lm {lm.item():.4f}  tau {stats['tau']:.3f}  "
                  f"diag {stats['diag']:+.3f}  off {stats['off_diag']:+.3f}")
    return history


def main() -> None:
    print("=" * 60)
    print("VISION-LANGUAGE PRETRAINING")
    print("=" * 60)

    cfg = PretrainConfig()
    print(f"  text vocab     : {cfg.text_vocab}")
    print(f"  max text length: {cfg.max_text_len}")
    print(f"  embed dim      : {cfg.embed_dim}")
    print(f"  n pairs        : {cfg.n_pairs}")
    print(f"  batch size     : {cfg.batch_size}")
    print(f"  steps          : {cfg.steps}")
    print(f"  lm weight      : {cfg.lm_weight}")
    print(f"  initial tau    : {math.exp(cfg.init_log_tau):.3f}")

    print("\ntraining:")
    hist = train(cfg)

    init_contrast = hist["contrast"][0]
    final_contrast = hist["contrast"][-1]
    init_lm = hist["lm"][0]
    final_lm = hist["lm"][-1]
    print(f"\ncontrast loss : {init_contrast:.4f} -> {final_contrast:.4f}"
          f"  (drop {init_contrast - final_contrast:+.4f})")
    print(f"lm loss       : {init_lm:.4f} -> {final_lm:.4f}"
          f"  (drop {init_lm - final_lm:+.4f})")

    if final_contrast < init_contrast and final_lm < init_lm:
        print("ok: both losses decreased")
    elif final_contrast < init_contrast or final_lm < init_lm:
        print("partial: at least one loss decreased")
    else:
        print("FAIL: neither loss decreased")

    print("\ndone.")


if __name__ == "__main__":
    main()
