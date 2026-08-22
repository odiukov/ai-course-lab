"""Имена расширяемых швов цикла агента."""

HOOK_TOPICS = (
    "before_plan",
    "after_plan",
    "before_step",
    "after_step",
    "before_tool_call",
    "after_tool_call",
    "on_error",
    "on_pause",
    "on_budget_exceeded",
    "on_complete",
)

EVENT_TYPES = (
    "session.start",
    "plan.draft",
    "plan.commit",
    "step.start",
    "step.end",
    "tool.call",
    "tool.result",
    "tool.error",
    "budget.warn",
    "session.pause",
    "session.complete",
)
