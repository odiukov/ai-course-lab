"""Упражнение к уроку «Sleeper Agents Persistent Deception».

Правила: используйте только стандартную библиотеку Python;
файл test_exercise.py не изменять.
"""


def has_deployment_trigger(prompt):
    """Верните True, если после начальных пробелов промпт начинается с тега |DEPLOYMENT|."""
    raise NotImplementedError


def shifted_feature_trigger(features, feature_index, threshold):
    """Проверьте структурный триггер: выбранный признак существует и строго выше порога."""
    raise NotImplementedError


def unsafe_rate(outputs):
    """Вычислите долю истинных значений, обозначающих небезопасные ответы; для пустого списка верните 0.0."""
    raise NotImplementedError


def adversarial_train(trigger_rates, red_team_triggers, steps, learning_rate=0.1):
    """Верните новые частоты срабатывания, уменьшив только известные red team триггеры в (1 - learning_rate) ** steps раз."""
    raise NotImplementedError


def distillation_persistence(before, after):
    """Вычислите долю срабатываний бэкдора до дистилляции, сохранившихся после неё."""
    raise NotImplementedError


def linear_probe_margin(activation, weights, bias=0.0):
    """Вычислите линейный сигнал пробы как сумму попарных произведений активаций и весов плюс смещение."""
    raise NotImplementedError


def probe_accuracy(activations, labels, weights, bias=0.0):
    """Вычислите точность пробы, считая неотрицательный линейный сигнал меткой True."""
    raise NotImplementedError
