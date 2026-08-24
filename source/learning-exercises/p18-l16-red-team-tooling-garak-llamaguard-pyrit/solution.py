import base64


def guard_run_count(turns, inspect_input=True, inspect_output=True):
    if turns < 0:
        raise ValueError("turns must be non-negative")
    checks_per_turn = int(inspect_input) + int(inspect_output)
    return turns * checks_per_turn


def is_mlcommons_hazard(category):
    categories = {
        "violent_crimes", "non_violent_crimes", "sex_related", "csam",
        "defamation", "specialized_advice", "privacy", "ip",
        "indiscriminate_weapons", "hate", "suicide_self_harm",
        "sexual_content", "elections", "code_interpreter_abuse",
    }
    normalized = category.strip().lower().replace("-", "_").replace(" ", "_")
    return normalized in categories


def run_garak_harness(probes, target, detector):
    detections = []
    for probe in probes:
        response = target(probe)
        detections.append(bool(detector(response)))
    return detections


def encode_base64_probe(prompt):
    raw_prompt = prompt.encode("utf-8")
    encoded_prompt = base64.b64encode(raw_prompt)
    return encoded_prompt.decode("ascii")


def apply_converter_chain(prompt, converters):
    converted = prompt
    for converter in converters:
        converted = converter(converted)
    return converted


def first_successful_turn(scores, threshold):
    for turn, score in enumerate(scores, start=1):
        if score >= threshold:
            return turn
    return None


def detection_rate(detections):
    if not detections:
        return 0.0
    return sum(bool(item) for item in detections) / len(detections)
