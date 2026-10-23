"""Opt-in example items. They are stored with ``is_example`` set, shown with an
Example badge, and removed together; they are never loaded automatically."""

from __future__ import annotations

import datetime as _dt


def _day(today: _dt.date, offset: int) -> str:
    return (today + _dt.timedelta(days=offset)).isoformat()


def _month(today: _dt.date, offset: int) -> str:
    index = today.year * 12 + today.month - 1 + offset
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def _quarter(today: _dt.date, offset: int) -> str:
    index = today.year * 4 + (today.month - 1) // 3 + offset
    return f"{index // 4:04d}-Q{index % 4 + 1}"


def build(today: _dt.date) -> list[dict]:
    return [
        {"title": "Example: Garden bed rebuild", "kind": "project", "status": "next",
         "motivation": "want", "horizon": "soon", "priority": "normal", "area": "Home",
         "notes": "Replace the two rotted cedar boards and add drip irrigation.",
         "next_steps": [{"text": "Measure both beds", "done": True},
                        {"text": "Price cedar vs. composite", "done": False},
                        {"text": "Pick a weekend", "done": False}],
         "dates": [{"kind": "target", "precision": "month", "value": _month(today, 1)}]},
        {"title": "Example: Renew passport", "kind": "chore", "status": "active",
         "motivation": "need", "horizon": "now", "priority": "high", "area": "Personal",
         "next_steps": [{"text": "Get new photos", "done": False}],
         "dates": [{"kind": "deadline", "precision": "day", "value": _day(today, 9),
                    "note": "Before the trip booking"}]},
        {"title": "Example: Dentist appointment", "kind": "chore", "status": "next",
         "motivation": "need", "horizon": "now", "area": "Health",
         "dates": [{"kind": "event", "precision": "day", "value": _day(today, 4),
                    "time": "09:30", "end_time": "10:30", "tz": "America/New_York"}]},
        {"title": "Example: Learn to sail", "kind": "goal", "status": "considering",
         "motivation": "exploring", "horizon": "later", "area": "Personal",
         "dates": [{"kind": "target", "precision": "quarter", "value": _quarter(today, 3)}]},
        {"title": "Example: Home lab dashboard", "kind": "idea", "status": "inbox",
         "motivation": "want", "horizon": "someday", "area": "Tech",
         "notes": "One page for household info: weather, calendar, network status."},
        {"title": "Example: Write family recipe book", "kind": "project", "status": "on_hold",
         "motivation": "want", "horizon": "later", "area": "Personal",
         "dates": [{"kind": "target", "precision": "year", "value": str(today.year + 1)}]},
        {"title": "Example: Run a 10k", "kind": "goal", "status": "active",
         "motivation": "want", "horizon": "soon", "priority": "normal", "area": "Health",
         "next_steps": [{"text": "Three runs a week", "done": False}],
         "dates": [{"kind": "start", "precision": "day", "value": _day(today, -10)},
                   {"kind": "target", "precision": "month", "value": _month(today, 3)}]},
        {"title": "Example: Compare budgeting apps", "kind": "idea", "status": "inbox",
         "motivation": "exploring", "area": "Personal",
         "references": [{"kind": "doc", "label": "Notes from last year"}]},
    ]
