import math
import random

import pytest

from exercise import (
    dp_event_bound,
    clip_gradient,
    add_dp_noise,
    approximate_epsilon,
    is_canary_detected,
    quantize_confidence,
)


def test_dp_event_bound_ordinary_case():
    result = dp_event_bound(0.1, 1.0, 1e-5)
    assert result == pytest.approx(math.e * 0.1 + 1e-5)


def test_dp_event_bound_zero_and_negative_boundary():
    assert dp_event_bound(0.0, 0.0, 1e-5) == pytest.approx(1e-5)
    with pytest.raises(ValueError):
        dp_event_bound(-0.1, 1.0, 1e-5)


def test_dp_event_bound_uses_multiplier_from_lesson():
    assert dp_event_bound(1.0, 1.0, 0.0) == pytest.approx(math.e)
    assert dp_event_bound(1.0, 10.0, 0.0) == pytest.approx(math.exp(10))


def test_clip_gradient_ordinary_case():
    assert clip_gradient([3.0, 4.0], 1.0) == pytest.approx([0.6, 0.8])


def test_clip_gradient_empty_zero_and_negative_boundary():
    assert clip_gradient([], 1.0) == []
    assert clip_gradient([3.0, 4.0], 0.0) == pytest.approx([0.0, 0.0])
    with pytest.raises(ValueError):
        clip_gradient([1.0], -1.0)


def test_clip_gradient_preserves_direction_and_limits_norm():
    clipped = clip_gradient([-6.0, 8.0], 2.0)
    norm = math.sqrt(sum(value * value for value in clipped))
    assert norm == pytest.approx(2.0)
    assert clipped[0] / clipped[1] == pytest.approx(-6.0 / 8.0)


def test_add_dp_noise_ordinary_case():
    generator = random.Random(7)
    expected = [
        1.0 + generator.gauss(0.0, 2.0),
        -1.0 + generator.gauss(0.0, 2.0),
    ]
    assert add_dp_noise([1.0, -1.0], 2.0, 1.0, 7) == pytest.approx(expected)


def test_add_dp_noise_empty_zero_and_negative_boundary():
    assert add_dp_noise([], 1.0, 1.0, 3) == []
    assert add_dp_noise([1.0, -1.0], 0.0, 10.0, 3) == pytest.approx(
        [1.0, -1.0]
    )
    with pytest.raises(ValueError):
        add_dp_noise([1.0], -0.5, 1.0, 3)


def test_add_dp_noise_is_reproducible_and_scales_with_sigma():
    first = add_dp_noise([3.0], 0.5, 1.0, 23)[0]
    repeated = add_dp_noise([3.0], 0.5, 1.0, 23)[0]
    doubled = add_dp_noise([3.0], 1.0, 1.0, 23)[0]
    assert first == pytest.approx(repeated)
    assert doubled - 3.0 == pytest.approx(2 * (first - 3.0))


def test_approximate_epsilon_ordinary_case():
    expected = 0.01 * math.sqrt(2 * 100 * math.log(1 / 1e-5))
    assert approximate_epsilon(100, 0.01, 1.0, 1e-5) == pytest.approx(
        expected
    )


def test_approximate_epsilon_zero_and_negative_boundary():
    assert approximate_epsilon(0, 0.01, 1.0, 1e-5) == pytest.approx(0.0)
    with pytest.raises(ValueError):
        approximate_epsilon(-1, 0.01, 1.0, 1e-5)


def test_approximate_epsilon_is_inverse_to_noise_multiplier():
    low_noise = approximate_epsilon(100, 0.01, 0.5, 1e-5)
    medium_noise = approximate_epsilon(100, 0.01, 1.0, 1e-5)
    high_noise = approximate_epsilon(100, 0.01, 2.0, 1e-5)
    assert low_noise == pytest.approx(2 * medium_noise)
    assert high_noise == pytest.approx(medium_noise / 2)


def test_is_canary_detected_ordinary_case():
    assert is_canary_detected(0.2, 0.8, 0.5) is True
    assert is_canary_detected(0.4, 0.8, 0.5) is False


def test_is_canary_detected_zero_and_negative_boundary():
    assert is_canary_detected(0.0, 0.0, 0.0) is True
    with pytest.raises(ValueError):
        is_canary_detected(-0.1, 0.8, 0.5)


def test_is_canary_detected_is_unchanged_by_common_loss_shift():
    original = is_canary_detected(0.2, 0.8, 0.5)
    shifted = is_canary_detected(3.2, 3.8, 0.5)
    assert shifted is original


def test_quantize_confidence_ordinary_case():
    assert quantize_confidence(0.634, 2) == pytest.approx(0.63)


def test_quantize_confidence_zero_one_and_negative_boundary():
    assert quantize_confidence(0.0, 2) == pytest.approx(0.0)
    assert quantize_confidence(1.0, 2) == pytest.approx(1.0)
    with pytest.raises(ValueError):
        quantize_confidence(-0.1, 2)


def test_quantize_confidence_collapses_close_values_from_lesson():
    first = quantize_confidence(0.9997, 2)
    second = quantize_confidence(0.9962, 2)
    assert first == pytest.approx(1.0)
    assert second == pytest.approx(first)
