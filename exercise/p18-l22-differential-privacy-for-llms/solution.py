import math
import random


def dp_event_bound(event_probability, epsilon, delta):
    if not 0 <= event_probability <= 1:
        raise ValueError("event_probability must be between 0 and 1")
    if epsilon < 0:
        raise ValueError("epsilon must be non-negative")
    if not 0 <= delta <= 1:
        raise ValueError("delta must be between 0 and 1")
    return math.exp(epsilon) * event_probability + delta


def clip_gradient(gradient, clip_norm):
    if clip_norm < 0:
        raise ValueError("clip_norm must be non-negative")
    norm = math.sqrt(sum(value * value for value in gradient))
    if norm == 0 or norm <= clip_norm:
        return list(gradient)
    scale = clip_norm / norm
    return [value * scale for value in gradient]


def add_dp_noise(gradient_sum, noise_multiplier, clip_norm, seed):
    if noise_multiplier < 0 or clip_norm < 0:
        raise ValueError("noise and clipping parameters must be non-negative")
    generator = random.Random(seed)
    noise_std = noise_multiplier * clip_norm
    return [
        value + generator.gauss(0.0, noise_std)
        for value in gradient_sum
    ]


def approximate_epsilon(steps, sampling_rate, noise_multiplier, delta):
    if steps < 0:
        raise ValueError("steps must be non-negative")
    if not 0 <= sampling_rate <= 1:
        raise ValueError("sampling_rate must be between 0 and 1")
    if noise_multiplier <= 0 or not 0 < delta < 1:
        raise ValueError("invalid noise_multiplier or delta")
    return sampling_rate * math.sqrt(
        2 * steps * math.log(1 / delta)
    ) / noise_multiplier


def is_canary_detected(canary_loss, baseline_loss, minimum_gap):
    if min(canary_loss, baseline_loss, minimum_gap) < 0:
        raise ValueError("losses and minimum_gap must be non-negative")
    return baseline_loss - canary_loss >= minimum_gap


def quantize_confidence(confidence, decimals):
    if not 0 <= confidence <= 1:
        raise ValueError("confidence must be between 0 and 1")
    if not isinstance(decimals, int) or decimals < 0:
        raise ValueError("decimals must be a non-negative integer")
    return round(confidence, decimals)
