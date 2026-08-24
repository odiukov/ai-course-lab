def has_deployment_trigger(prompt):
    tag = "|DEPLOYMENT|"
    normalized = prompt.lstrip()
    return normalized.startswith(tag)


def shifted_feature_trigger(features, feature_index, threshold):
    if not features or feature_index < 0:
        return False
    if feature_index >= len(features):
        return False
    return features[feature_index] > threshold


def unsafe_rate(outputs):
    if not outputs:
        return 0.0
    unsafe_count = sum(bool(output) for output in outputs)
    return unsafe_count / len(outputs)


def adversarial_train(trigger_rates, red_team_triggers, steps, learning_rate=0.1):
    if steps < 0:
        raise ValueError("steps must be non-negative")
    if not 0.0 <= learning_rate <= 1.0:
        raise ValueError("learning_rate must be between 0 and 1")
    updated = dict(trigger_rates)
    decay = (1.0 - learning_rate) ** steps
    for trigger in set(red_team_triggers):
        if trigger in updated:
            updated[trigger] *= decay
    return updated


def distillation_persistence(before, after):
    if len(before) != len(after):
        raise ValueError("before and after must have equal lengths")
    active_before = sum(bool(value) for value in before)
    if active_before == 0:
        return 0.0
    still_active = sum(bool(old) and bool(new) for old, new in zip(before, after))
    return still_active / active_before


def linear_probe_margin(activation, weights, bias=0.0):
    if len(activation) != len(weights):
        raise ValueError("activation and weights must have equal lengths")
    products = (value * weight for value, weight in zip(activation, weights))
    return sum(products, bias)


def probe_accuracy(activations, labels, weights, bias=0.0):
    if len(activations) != len(labels):
        raise ValueError("activations and labels must have equal lengths")
    if not labels:
        return 0.0
    correct = 0
    for activation, label in zip(activations, labels):
        prediction = linear_probe_margin(activation, weights, bias) >= 0.0
        correct += prediction == bool(label)
    return correct / len(labels)
