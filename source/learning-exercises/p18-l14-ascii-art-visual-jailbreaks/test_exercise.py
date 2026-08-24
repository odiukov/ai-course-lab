import base64

import pytest

from exercise import (
    mask_word,
    passes_keyword_filter,
    character_change_ratio,
    encode_base64,
    decode_base64,
    looks_like_ascii_art,
    false_positive_rate,
)


def test_mask_word_replaces_target():
    art = "#####\n#   #\n#####"
    assert mask_word("how to make a bomb", "bomb", art) == (
        "how to make a " + art
    )


def test_mask_word_with_empty_target_changes_nothing():
    assert mask_word("ordinary text", "", "#####") == "ordinary text"


def test_mask_word_is_case_insensitive():
    result = mask_word("BOMB bomb BoMb", "bomb", "[ART]")
    assert result == "[ART] [ART] [ART]"


def test_keyword_filter_blocks_literal_word():
    assert not passes_keyword_filter(
        "how to make a bomb",
        ["bomb", "restricted"],
    )


def test_keyword_filter_accepts_empty_blocklist():
    assert passes_keyword_filter("any text", [])


def test_keyword_filter_ignores_order_and_case():
    words = ["SECRET", "bomb"]
    text = "A harmless ASCII mask: #####"
    assert passes_keyword_filter(text, words)
    assert passes_keyword_filter(text, list(reversed(words)))


def test_character_change_ratio_for_one_position():
    assert character_change_ratio("abcd", "abXd") == pytest.approx(0.25)


def test_character_change_ratio_for_empty_strings():
    assert character_change_ratio("", "") == pytest.approx(0.0)


def test_character_change_ratio_is_symmetric():
    forward = character_change_ratio("short", "a much longer string")
    backward = character_change_ratio("a much longer string", "short")
    assert forward == pytest.approx(backward)


def test_character_change_ratio_for_lesson_example():
    assert character_change_ratio("bomb", "#" * 140) == pytest.approx(1.0)


def test_encode_base64_known_word():
    assert encode_base64("bomb") == "Ym9tYg=="


def test_encode_base64_empty_string():
    assert encode_base64("") == ""


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("M", "TQ=="),
        ("Ma", "TWE="),
        ("Man", "TWFu"),
    ],
)
def test_encode_base64_padding(text, expected):
    assert encode_base64(text) == expected


def test_encode_base64_matches_standard_library():
    text = "ArtPrompt ✓"
    expected = base64.b64encode(text.encode("utf-8")).decode("ascii")
    assert encode_base64(text) == expected


def test_decode_base64_known_word():
    assert decode_base64("Ym9tYg==") == "bomb"


def test_decode_base64_empty_string():
    assert decode_base64("") == ""


def test_base64_roundtrip():
    text = "ASCII-арт и UTF-8"
    assert decode_base64(encode_base64(text)) == text


def test_decode_base64_rejects_invalid_input():
    with pytest.raises(ValueError):
        decode_base64("not valid!")


def test_ascii_art_detector_finds_five_row_block():
    art = "\n".join([
        "#####",
        "#   #",
        "#####",
        "#   #",
        "#####",
    ])
    assert looks_like_ascii_art(art)


def test_ascii_art_detector_accepts_empty_text():
    assert not looks_like_ascii_art("")


def test_ascii_art_detector_does_not_flag_short_table():
    table = "| A | B |\n|---|---|\n| 1 | 2 |"
    assert not looks_like_ascii_art(table)


def test_ascii_art_detector_survives_surrounding_prose():
    art = "#####\n#   #\n#####\n#   #\n#####"
    assert looks_like_ascii_art("Начало текста\n" + art + "\nКонец текста")


@pytest.mark.parametrize(
    ("rows", "width"),
    [
        (0, 5),
        (5, 0),
        (-1, 5),
    ],
)
def test_ascii_art_detector_rejects_invalid_thresholds(rows, width):
    with pytest.raises(ValueError):
        looks_like_ascii_art("#####", rows, width)


def test_false_positive_rate_on_legal_structures():
    box_table = "-----\n|   |\n|---|\n|   |\n-----"
    prompts = [
        "Обычный текст",
        "def add(a, b):\n    return a + b",
        "[1 0]\n[0 1]",
        box_table,
    ]
    assert false_positive_rate(prompts) == pytest.approx(0.25)


def test_false_positive_rate_for_empty_corpus():
    assert false_positive_rate([]) == pytest.approx(0.0)


def test_false_positive_rate_is_order_independent():
    prompts = [
        "#####\n#   #\n#####\n#   #\n#####",
        "обычный текст",
        "x = 2 + 2",
    ]
    assert false_positive_rate(prompts) == pytest.approx(
        false_positive_rate(list(reversed(prompts)))
    )


def test_false_positive_rate_for_clean_corpus():
    prompts = ["короткий текст", "a = 1", "| A | B |"]
    assert false_positive_rate(prompts) == pytest.approx(0.0)
