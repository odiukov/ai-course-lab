import pytest

from exercise import cosine_similarity, weat_like_score, debias_vector, percent_bias_reduction, intersectional_interaction, binary_uncertainty, uncertainty_gap, controlled_ablation_effect


def test_cosine_similarity_orthogonal_vectors():
    assert cosine_similarity([1, 0], [0, 1]) == pytest.approx(0.0)


def test_cosine_similarity_empty_and_zero_vectors():
    assert cosine_similarity([], []) == pytest.approx(0.0)
    assert cosine_similarity([0, 0], [3, -2]) == pytest.approx(0.0)


def test_cosine_similarity_is_symmetric():
    left = [2, -1, 3]
    right = [-4, 5, 2]
    assert cosine_similarity(left, right) == pytest.approx(
        cosine_similarity(right, left)
    )


def test_weat_like_score_known_associations():
    score = weat_like_score(
        [[1, 0]], [[0, 1]], [[1, 0]], [[0, 1]]
    )
    assert score == pytest.approx(2.0)


def test_weat_like_score_empty_input():
    assert weat_like_score([], [[1, 0]], [[1, 0]], [[0, 1]]) == pytest.approx(0.0)


def test_weat_like_score_changes_sign_when_groups_swap():
    arguments = ([[1, 0]], [[0, 1]], [[1, 0]], [[0, 1]])
    direct = weat_like_score(*arguments)
    swapped = weat_like_score(arguments[1], arguments[0], arguments[2], arguments[3])
    assert swapped == pytest.approx(-direct)


def test_debias_vector_removes_projection():
    assert debias_vector([2, 1], [1, 0]) == pytest.approx([0, 1])


def test_debias_vector_empty_input():
    assert debias_vector([], []) == []


def test_debias_vector_is_orthogonal_to_bias_direction():
    direction = [1, -2, 3]
    result = debias_vector([4, 5, -1], direction)
    dot_product = sum(a * b for a, b in zip(result, direction))
    assert dot_product == pytest.approx(0.0)


def test_percent_bias_reduction_ordinary_case():
    assert percent_bias_reduction(1.0, 0.25) == pytest.approx(75.0)


def test_percent_bias_reduction_from_zero():
    assert percent_bias_reduction(0.0, 0.5) == pytest.approx(0.0)


def test_percent_bias_reduction_matches_lesson_and_ignores_sign():
    expected = 75.16281158769369
    assert percent_bias_reduction(0.8906, 0.2212) == pytest.approx(expected)
    assert percent_bias_reduction(-0.8906, -0.2212) == pytest.approx(expected)


def test_intersectional_interaction_detects_extra_effect():
    assert intersectional_interaction(10, 12, 13, 20) == pytest.approx(5.0)


def test_intersectional_interaction_zero_and_negative_values():
    assert intersectional_interaction(0, 0, 0, 0) == pytest.approx(0.0)
    assert intersectional_interaction(-4, -3, -2, -1) == pytest.approx(0.0)


def test_intersectional_interaction_is_symmetric_between_axes():
    direct = intersectional_interaction(1, 3, 4, 9)
    axes_swapped = intersectional_interaction(1, 4, 3, 9)
    assert direct == pytest.approx(axes_swapped)


def test_binary_uncertainty_is_maximal_at_half():
    assert binary_uncertainty(0.5) == pytest.approx(1.0)


def test_binary_uncertainty_at_certain_boundaries():
    assert binary_uncertainty(0.0) == pytest.approx(0.0)
    assert binary_uncertainty(1.0) == pytest.approx(0.0)


def test_binary_uncertainty_is_symmetric():
    assert binary_uncertainty(0.2) == pytest.approx(binary_uncertainty(0.8))


def test_binary_uncertainty_rejects_negative_probability():
    with pytest.raises(ValueError):
        binary_uncertainty(-0.1)


def test_uncertainty_gap_between_uncertain_and_certain_groups():
    assert uncertainty_gap([0.5], [0.0, 1.0]) == pytest.approx(1.0)


def test_uncertainty_gap_with_empty_group():
    assert uncertainty_gap([], [0.5]) == pytest.approx(0.0)
    assert uncertainty_gap([0.5], []) == pytest.approx(0.0)


def test_uncertainty_gap_is_symmetric_and_permutation_invariant():
    first = [0.1, 0.5, 0.9]
    second = [0.0, 0.2]
    expected = uncertainty_gap(first, second)
    assert uncertainty_gap(second, first) == pytest.approx(expected)
    assert uncertainty_gap(list(reversed(first)), second) == pytest.approx(expected)


def test_controlled_ablation_effect_removes_control_change():
    effect = controlled_ablation_effect(0.8, 0.2, 0.8, 0.7)
    assert effect == pytest.approx(0.5)


def test_controlled_ablation_effect_all_zero():
    assert controlled_ablation_effect(0, 0, 0, 0) == pytest.approx(0.0)


def test_controlled_ablation_effect_is_zero_for_equal_changes():
    assert controlled_ablation_effect(-1, -3, 4, 2) == pytest.approx(0.0)


def test_controlled_ablation_effect_ignores_shared_offset():
    original = controlled_ablation_effect(0.9, 0.3, 0.8, 0.7)
    shifted = controlled_ablation_effect(10.9, 10.3, 10.8, 10.7)
    assert shifted == pytest.approx(original)
