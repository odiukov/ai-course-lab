"""Решение упражнения Regulatory Frameworks — EU, US, UK, Korea."""


def classify_eu_risk(use_case):
    normalized = use_case.strip().lower()
    if normalized in {"social_scoring", "real_time_remote_biometrics", "exploitative_manipulation"}:
        return "prohibited"
    if normalized in {"employment", "education", "credit", "law_enforcement", "justice", "migration"}:
        return "high-risk"
    if normalized == "gpai_model":
        return "general-purpose"
    if normalized in {"weather_chatbot", "ai_generated_content"}:
        return "limited-risk"
    raise ValueError("Unknown use case")


def eu_act_deadline(obligation):
    normalized = obligation.strip().lower()
    deadlines = {
        "prohibited": "2025-02-02", "ai_literacy": "2025-02-02",
        "gpai": "2025-08-02", "governance": "2025-08-02",
        "article_50": "2026-08-02", "full_application": "2026-08-02",
        "fines": "2026-08-02", "legacy_gpai": "2027-08-02",
        "embedded_high_risk": "2027-08-02",
    }
    if normalized not in deadlines:
        raise ValueError("Unknown obligation")
    return deadlines[normalized]


def gpai_code_chapters(training_flops):
    if training_flops < 0:
        raise ValueError("FLOP cannot be negative")
    chapters = ("Transparency", "Copyright")
    if training_flops >= 1e25:
        chapters += ("Safety and Security",)
    return chapters


def applicable_jurisdictions(company_country, infrastructure_region, user_countries):
    supported = {"US", "EU", "Korea"}
    locations = [company_country, infrastructure_region]
    locations.extend(user_countries)
    applicable = {location for location in locations if location in supported}
    return tuple(sorted(applicable))


def korean_ai_obligations(foreign_provider, high_impact, generative):
    obligations = set()
    if foreign_provider:
        obligations.add("local_representative")
    if high_impact:
        obligations.add("risk_assessment")
    if high_impact or generative:
        obligations.add("safety_measures")
    return tuple(sorted(obligations))


def institute_policy_shift(country):
    normalized = country.strip().upper()
    if normalized == "UK":
        return ("AI Safety Institute", "AI Security Institute", "frontier security")
    if normalized == "US":
        return ("AI Safety Institute", "CAISI", "standards and innovation")
    raise ValueError("Unknown country")
