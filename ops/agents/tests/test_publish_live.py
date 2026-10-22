"""Tests for publish_live.signature() and publish_live.minutes_since().

No network calls, no git calls — pure unit tests.
"""
import datetime
import sys
from pathlib import Path

# Make ops/agents importable without installing the package.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import publish_live  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _live(
    grok_states: list[tuple[str, str, str]] | None = None,
    gemini_slugs: list[str] | None = None,
    chat_states: list[tuple[str, str]] | None = None,
    pipeline_titles: list[str] | None = None,
) -> dict:
    """Build a minimal live dict from the semantic parts that signature() cares about."""
    live: dict = {}
    if grok_states is not None:
        live["grok"] = [
            {"name": name, "state": state, "model": model, "minutes": 999, "steps": 42, "tokens": 1_000_000}
            for name, state, model in grok_states
        ]
    if gemini_slugs is not None:
        live["gemini"] = [{"slug": slug, "minutes": 5} for slug in gemini_slugs]
    if chat_states is not None:
        live["chats"] = [
            {"name": name, "state": state, "context_pct": 50}
            for name, state in chat_states
        ]
    if pipeline_titles is not None:
        live["pipeline"] = [{"title": title, "run_id": 999} for title in pipeline_titles]
    return live


# ---------------------------------------------------------------------------
# signature() tests
# ---------------------------------------------------------------------------

class TestSignature:
    """Same semantic state → same hash; any semantic change → different hash."""

    # --- same state, varying numeric noise -----------------------------------

    def test_same_grok_state_different_minutes(self):
        base = _live(grok_states=[("task-a", "working", "grok-3")])
        noisy = _live(grok_states=[("task-a", "working", "grok-3")])
        noisy["grok"][0]["minutes"] = 777
        assert publish_live.signature(base) == publish_live.signature(noisy)

    def test_same_grok_state_different_steps(self):
        base = _live(grok_states=[("task-a", "working", "grok-3")])
        noisy = _live(grok_states=[("task-a", "working", "grok-3")])
        noisy["grok"][0]["steps"] = 999
        assert publish_live.signature(base) == publish_live.signature(noisy)

    def test_same_grok_state_different_tokens(self):
        base = _live(grok_states=[("task-a", "working", "grok-3")])
        noisy = _live(grok_states=[("task-a", "working", "grok-3")])
        noisy["grok"][0]["tokens"] = 9_999_999
        assert publish_live.signature(base) == publish_live.signature(noisy)

    def test_same_chat_state_different_context_pct(self):
        base = _live(chat_states=[("LL · Main", "active")])
        noisy = _live(chat_states=[("LL · Main", "active")])
        noisy["chats"][0]["context_pct"] = 99
        assert publish_live.signature(base) == publish_live.signature(noisy)

    def test_same_gemini_slug_different_minutes(self):
        base = _live(gemini_slugs=["al-i-madad"])
        noisy = _live(gemini_slugs=["al-i-madad"])
        noisy["gemini"][0]["minutes"] = 123
        assert publish_live.signature(base) == publish_live.signature(noisy)

    def test_same_pipeline_title_different_run_id(self):
        base = _live(pipeline_titles=["build-prod"])
        noisy = _live(pipeline_titles=["build-prod"])
        noisy["pipeline"][0]["run_id"] = 42
        assert publish_live.signature(base) == publish_live.signature(noisy)

    def test_order_independent_grok(self):
        """Order of grok entries must not affect the hash."""
        a = _live(grok_states=[("task-a", "working", "grok-3"), ("task-b", "idle", "grok-mini")])
        b = _live(grok_states=[("task-b", "idle", "grok-mini"), ("task-a", "working", "grok-3")])
        assert publish_live.signature(a) == publish_live.signature(b)

    def test_order_independent_chats(self):
        a = _live(chat_states=[("LL · Main", "active"), ("LL · Site", "idle")])
        b = _live(chat_states=[("LL · Site", "idle"), ("LL · Main", "active")])
        assert publish_live.signature(a) == publish_live.signature(b)

    # --- semantic changes must produce a different hash ----------------------

    def test_grok_state_change(self):
        """'working' → 'finished' must change the signature."""
        before = _live(grok_states=[("task-a", "working", "grok-3")])
        after = _live(grok_states=[("task-a", "finished", "grok-3")])
        assert publish_live.signature(before) != publish_live.signature(after)

    def test_chat_state_change(self):
        before = _live(chat_states=[("LL · Main", "active")])
        after = _live(chat_states=[("LL · Main", "idle")])
        assert publish_live.signature(before) != publish_live.signature(after)

    def test_new_pipeline_run_title(self):
        before = _live(pipeline_titles=["build-prod"])
        after = _live(pipeline_titles=["build-prod", "deploy-staging"])
        assert publish_live.signature(before) != publish_live.signature(after)

    def test_grok_name_change(self):
        before = _live(grok_states=[("task-a", "working", "grok-3")])
        after = _live(grok_states=[("task-b", "working", "grok-3")])
        assert publish_live.signature(before) != publish_live.signature(after)

    def test_new_chat_added(self):
        before = _live(chat_states=[("LL · Main", "active")])
        after = _live(chat_states=[("LL · Main", "active"), ("LL · Site", "active")])
        assert publish_live.signature(before) != publish_live.signature(after)

    def test_new_gemini_slug(self):
        before = _live(gemini_slugs=["al-i-madad"])
        after = _live(gemini_slugs=["al-i-madad", "ya-mustafa"])
        assert publish_live.signature(before) != publish_live.signature(after)

    def test_empty_live_is_stable(self):
        assert publish_live.signature({}) == publish_live.signature({})

    def test_none_fields_treated_as_empty(self):
        """None and missing keys must hash the same."""
        explicit_none = {"grok": None, "gemini": None, "chats": None, "pipeline": None}
        assert publish_live.signature(explicit_none) == publish_live.signature({})

    def test_hash_is_16_hex_chars(self):
        sig = publish_live.signature(_live(grok_states=[("t", "working", "grok-3")]))
        assert len(sig) == 16
        assert all(c in "0123456789abcdef" for c in sig)


# ---------------------------------------------------------------------------
# minutes_since() tests
# ---------------------------------------------------------------------------

class TestMinutesSince:
    """Verify time-delta calculation and error handling."""

    def test_ten_minutes_ago(self):
        ten_ago = (
            datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=10)
        ).isoformat()
        result = publish_live.minutes_since(ten_ago)
        # Allow ±0.1 min of test-execution jitter.
        assert abs(result - 10) < 0.1

    def test_zero_minutes_ago(self):
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        result = publish_live.minutes_since(now)
        assert result < 0.1  # basically 0

    def test_one_hour_ago(self):
        one_hour_ago = (
            datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=1)
        ).isoformat()
        result = publish_live.minutes_since(one_hour_ago)
        assert abs(result - 60) < 0.1

    def test_unparseable_string_returns_large_number(self):
        assert publish_live.minutes_since("not-a-date") == 1e9

    def test_empty_string_returns_large_number(self):
        assert publish_live.minutes_since("") == 1e9

    def test_z_suffix_accepted(self):
        """ISO timestamps ending in 'Z' must be parsed (not treated as unparseable)."""
        ten_ago = (
            datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=10)
        ).strftime("%Y-%m-%dT%H:%M:%SZ")
        result = publish_live.minutes_since(ten_ago)
        assert abs(result - 10) < 0.1

    def test_partial_date_string_returns_large_number(self):
        assert publish_live.minutes_since("2026-13-99") == 1e9
