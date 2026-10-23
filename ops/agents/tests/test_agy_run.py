"""Tests for agy_run.py's rule-6a helpers: quota group, ledger fields, run lock. Run: python ops/agents/tests/test_agy_run.py"""
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'ops' / 'agents'))
sys.path.insert(0, str(ROOT / 'ops' / 'usage'))
import agy_run  # noqa: E402
import collect  # noqa: E402


def test_quota_group():
    assert agy_run.quota_group('claude-sonnet-5-5-medium') == 'claude-gpt'
    assert agy_run.quota_group('gpt-oss-120b') == 'claude-gpt'
    assert agy_run.quota_group('gemini-3.8-flash-high') == ''


def test_quota_fields_only_measured():
    assert agy_run.quota_fields('', {'weekly': 50}, {'weekly': 40}) == {}
    assert agy_run.quota_fields('claude-gpt', {}, {}) == {}
    got = agy_run.quota_fields('claude-gpt', {'weekly': 46.6, 'fiveHour': 95.1}, {'weekly': 42.5})
    assert got == {'quotaGroup': 'claude-gpt', 'weeklyBefore': 46.6, 'fiveHourBefore': 95.1, 'weeklyAfter': 42.5}


def test_lock_one_at_a_time():
    agy_run.LOCK = Path(tempfile.mkdtemp()) / 'lock'
    assert agy_run.take_lock()
    assert not agy_run.take_lock()
    agy_run.drop_lock()
    assert agy_run.take_lock()
    agy_run.drop_lock()


def test_record_run_keeps_quota():
    data = {'status': 'SUCCESS', 'model': 'claude-sonnet-5-5-medium', 'usage': {'total_tokens': 38000},
            'quotaGroup': 'claude-gpt', 'weeklyBefore': 46.6, 'weeklyAfter': 42.5}
    f = Path(tempfile.mkdtemp()) / 'run.json'
    f.write_text(json.dumps(data), encoding='utf-8')
    row = collect.record_run(str(f), 't37')
    assert row['weeklyBefore'] == 46.6 and row['weeklyAfter'] == 42.5 and row['quotaGroup'] == 'claude-gpt'
    assert 'fiveHourBefore' not in row
    data2 = {'status': 'SUCCESS', 'usage': {'total_tokens': 1}}
    f.write_text(json.dumps(data2), encoding='utf-8')
    assert 'quotaGroup' not in collect.record_run(str(f), 'x')


def test_record_run_status_model_and_repeat():
    f = Path(tempfile.mkdtemp()) / 'run.json'
    f.write_text(json.dumps({'status': 'SUCCESS', 'usage': {'total_tokens': 0}}), encoding='utf-8')
    row = collect.record_run(str(f), 'T36-r1')
    assert row['status'] == 'REFUSED' and row['model'] == 'unknown'
    f.write_text(json.dumps({'status': 'SUCCESS', 'model': 'claude-sonnet-5-5-medium', 'duration_seconds': 61,
                             'usage': {'total_tokens': 27433}}), encoding='utf-8')
    a = collect.record_run(str(f), 'A2')
    b = dict(a, ts='2000-01-01T00:00:00Z')
    assert collect.repeated_run(a, [a])
    assert not collect.repeated_run(a, [b])
    assert not collect.repeated_run(a, [dict(a, tokens=1)])


def test_gemini_poll_throttle():
    import datetime as dt
    t = dt.datetime(2026, 10, 23, 12, 0, tzinfo=dt.timezone.utc)
    q = lambda m: {'agent': 'gemini', 'kind': 'quota', 'ts': collect.iso(t - dt.timedelta(minutes=m))}
    assert collect.gemini_polled_recently([q(40), q(10)], t)
    assert not collect.gemini_polled_recently([q(10), q(40)], t)
    assert not collect.gemini_polled_recently([], t)


if __name__ == '__main__':
    for name, fn in list(globals().items()):
        if name.startswith('test_'):
            fn()
            print('ok  ', name)
