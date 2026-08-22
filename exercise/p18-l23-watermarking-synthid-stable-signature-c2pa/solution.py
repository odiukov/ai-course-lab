import math


def biased_green_probability(green_fraction, delta):
    if not 0 <= green_fraction <= 1:
        raise ValueError("green_fraction must be between 0 and 1")
    if green_fraction in (0, 1):
        return float(green_fraction)
    green_weight = green_fraction * math.exp(delta)
    red_weight = 1 - green_fraction
    return green_weight / (green_weight + red_weight)


def watermark_z_score(green_count, total_tokens, expected_green_fraction=0.5):
    if total_tokens < 0 or green_count < 0 or green_count > total_tokens:
        raise ValueError("invalid token counts")
    if not 0 < expected_green_fraction < 1:
        raise ValueError("expected_green_fraction must be between 0 and 1")
    if total_tokens == 0:
        return 0.0
    expected = total_tokens * expected_green_fraction
    deviation = math.sqrt(total_tokens * expected_green_fraction * (1 - expected_green_fraction))
    return (green_count - expected) / deviation


def false_positive_rate(scores, threshold):
    scores = list(scores)
    if not scores:
        return 0.0
    positives = sum(score >= threshold for score in scores)
    return positives / len(scores)


def affected_token_count(total_tokens, changed_positions, context_width):
    if total_tokens < 0 or context_width < 0:
        raise ValueError("counts cannot be negative")
    positions = set(changed_positions)
    if any(position < 0 or position >= total_tokens for position in positions):
        raise ValueError("changed position is outside the text")
    affected = set()
    for position in positions:
        affected.update(range(position, min(total_tokens, position + context_width + 1)))
    return len(affected)


def meets_stable_signature_claim(detection_rate, false_positive_rate):
    if not 0 <= detection_rate <= 1:
        raise ValueError("detection_rate must be between 0 and 1")
    if not 0 <= false_positive_rate <= 1:
        raise ValueError("false_positive_rate must be between 0 and 1")
    return detection_rate > 0.90 and false_positive_rate < 1e-6


def c2pa_status(manifest_present, signature_valid):
    if not isinstance(manifest_present, bool) or not isinstance(signature_valid, bool):
        raise TypeError("arguments must be bool")
    if not manifest_present:
        return "missing"
    if signature_valid:
        return "verified"
    return "invalid"


def provenance_evidence(watermark_detected, manifest_status):
    if not isinstance(watermark_detected, bool):
        raise TypeError("watermark_detected must be bool")
    if manifest_status not in {"missing", "verified", "invalid"}:
        raise ValueError("unknown C2PA status")
    if manifest_status == "verified":
        return "corroborated" if watermark_detected else "c2pa_only"
    if manifest_status == "invalid":
        return "watermark_only_c2pa_invalid" if watermark_detected else "c2pa_invalid"
    if watermark_detected:
        return "watermark_only"
    return "no_provenance_evidence"
