"""Parsers for the provider screens. Fixtures have no account identity."""
import datetime as dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import collect  # noqa: E402

FIX = Path(__file__).resolve().parent / 'fixtures'


def test_agy_screen_matches_the_saved_usage_panel():
    plan, groups = collect.parse_quota(
        (FIX / 'agy-header.txt').read_text(encoding='utf-8'),
        (FIX / 'agy-usage.txt').read_text(encoding='utf-8'),
    )
    assert plan == 'Google AI Pro'
    assert groups['gemini'] == {
        'weeklyRemaining': 91.89,
        'weeklyResetIn': '88h 37m',
        'fiveHourRemaining': 93.24,
        'fiveHourResetIn': '4h 31m',
    }
    assert groups['claude-gpt'] == {'weeklyRemaining': 100, 'fiveHourRemaining': 100}
    assert 'weeklyResetIn' not in groups['claude-gpt']
    assert 'fiveHourResetIn' not in groups['claude-gpt']


def test_quota_available_without_a_percent_is_a_full_window():
    plan, groups = collect.parse_quota('(Google AI Pro)', (FIX / 'agy-quota-available.txt').read_text(encoding='utf-8'))
    assert plan == 'Google AI Pro'
    assert groups['claude-gpt'] == {'weeklyRemaining': 100, 'fiveHourRemaining': 100}


def test_grok_weekly_is_the_bar_not_the_context_window():
    parsed = collect.parse_grok_usage((FIX / 'grok-usage.txt').read_text(encoding='utf-8'))
    assert parsed == {
        'plan': 'SuperGrok Heavy',
        'percentUsed': 54,
        'resetsAt': 'October 23, 21:08',
        'timezoneLabeled': False,
    }


def test_grok_reset_drops_modal_chrome():
    parsed = collect.parse_grok_usage(
        'Weekly limit (SuperGrok Heavy)\n54%\n'
        'Resets: October 23, 21:08          ││  Loading session usage…\n'
    )
    assert parsed['resetsAt'] == 'October 23, 21:08'
    assert parsed['timezoneLabeled'] is False


def test_a_labelled_timezone_is_noticed_and_not_rewritten():
    parsed = collect.parse_grok_usage('Weekly limit (SuperGrok Heavy)\n54%\nResets: 7:10am (Etc/GMT-5)\n')
    assert parsed['resetsAt'] == '7:10am (Etc/GMT-5)'
    assert parsed['timezoneLabeled'] is True


def test_claude_auth_status_pro_is_claude_pro_and_identity_is_dropped():
    raw = (FIX / 'claude-auth.json').read_text(encoding='utf-8')
    assert collect.parse_claude_auth(raw) == 'Claude Pro'
    leaked = (
        '{"loggedIn": true, "subscriptionType": "pro", "email": "person@example.com",'
        ' "orgId": "org-1", "orgName": "Example Org"}'
    )
    assert collect.parse_claude_auth(leaked) == 'Claude Pro'
    assert collect.parse_claude_auth('{"loggedIn": true, "subscriptionType": "max"}') is None
    assert collect.parse_claude_auth('{"loggedIn": false, "subscriptionType": "pro"}') is None


def test_latest_records_source_and_time_and_skips_unshown_baskets():
    stamp = '2026-10-21T03:16:00Z'
    latest = collect.build_latest(
        [],
        stamp,
        claude={'plan': 'Claude Pro', 'planSource': collect.SOURCE_CLAUDE, 'at': stamp},
        gemini_live={
            'plan': 'Google AI Pro',
            'at': stamp,
            'groups': collect.parse_quota(
                (FIX / 'agy-header.txt').read_text(encoding='utf-8'),
                (FIX / 'agy-usage.txt').read_text(encoding='utf-8'),
            )[1],
        },
        grok_live=collect.parse_grok_usage((FIX / 'grok-usage.txt').read_text(encoding='utf-8')) | {'at': stamp},
    )
    assert latest['claude'] == {'plan': 'Claude Pro', 'planSource': 'claude auth status --json', 'at': stamp}
    assert latest['grok']['weekly'] == {
        'percentUsed': 54,
        'resetsAt': 'October 23, 21:08',
        'timezoneLabeled': False,
        'source': 'grok /usage',
        'at': stamp,
    }
    assert latest['grok']['todaySource'] == 'grok usage'
    assert latest['grok']['weekAt'] == stamp
    assert latest['grok']['plan'] == 'SuperGrok Heavy'
    assert latest['grok']['planSource'] == 'grok /usage'
    assert 'limit' not in latest['grok']
    gpt = latest['gemini']['claudeGpt']
    assert gpt['weeklyRemaining'] == 100
    assert gpt['fiveHourRemaining'] == 100
    assert 'weeklyResetIn' not in gpt
    assert gpt['source'] == 'agy /usage'
    assert gpt is latest['gemini']['quota']['claude-gpt']
    gem = latest['gemini']['quota']['gemini']
    assert gem['weeklyRemaining'] == 91.89
    assert gem['fiveHourResetIn'] == '4h 31m'
    assert gem['source'] == 'agy /usage' and gem['at'] == stamp
    blob = json.dumps(latest)
    for hidden in ('extra_usage', 'iguana', 'five_hour', 'seven_day', 'person@example.com'):
        assert hidden not in blob


def test_ledger_keeps_a_row_only_when_the_measured_tuple_changes():
    rows = [
        {'ts': '2026-10-19T00:00:00Z', 'agent': 'grok', 'kind': 'session', 'session': 's1',
         'totalTokens': 10, 'outputTokens': 1, 'modelCalls': 1, 'turns': 1},
        {'ts': '2026-10-19T00:10:00Z', 'agent': 'grok', 'kind': 'session', 'session': 's1',
         'totalTokens': 10, 'outputTokens': 1, 'modelCalls': 1, 'turns': 1},
        {'ts': '2026-10-19T00:20:00Z', 'agent': 'grok', 'kind': 'session', 'session': 's1',
         'totalTokens': 12, 'outputTokens': 2, 'modelCalls': 2, 'turns': 1},
        {'ts': '2026-10-19T00:00:00Z', 'agent': 'gemini', 'kind': 'quota', 'group': 'gemini',
         'plan': 'Google AI Pro', 'weeklyRemaining': 90, 'fiveHourRemaining': 80, 'weeklyResetIn': '10h'},
        {'ts': '2026-10-19T00:10:00Z', 'agent': 'gemini', 'kind': 'quota', 'group': 'gemini',
         'plan': 'Google AI Pro', 'weeklyRemaining': 90, 'fiveHourRemaining': 80, 'weeklyResetIn': '9h 50m'},
        {'ts': '2026-10-19T00:20:00Z', 'agent': 'gemini', 'kind': 'quota', 'group': 'gemini',
         'plan': 'Google AI Pro', 'weeklyRemaining': 89, 'fiveHourRemaining': 80, 'weeklyResetIn': '9h 40m'},
        {'ts': '2026-10-19T00:15:00Z', 'agent': 'gemini', 'kind': 'run', 'task': 'watch'},
        {'ts': '2026-10-19T00:16:00Z', 'agent': 'gemini', 'kind': 'run', 'task': 'watch'},
    ]
    kept = collect.keep_changed(rows, {})
    assert [row['ts'] + row['agent'] + row['kind'] for row in kept] == [
        '2026-10-19T00:00:00Zgroksession',
        '2026-10-19T00:20:00Zgroksession',
        '2026-10-19T00:00:00Zgeminiquota',
        '2026-10-19T00:20:00Zgeminiquota',
        '2026-10-19T00:15:00Zgeminirun',
        '2026-10-19T00:16:00Zgeminirun',
    ]
    assert collect.day_shrink(rows, '2026-10-19') == (8, 6)


def test_week_total_still_subtracts_the_peak_from_before_the_window():
    rows = [
        {'agent': 'grok', 'kind': 'session', 'session': 's', 'task': 't', 'totalTokens': 100,
         'outputTokens': 1, 'modelCalls': 1, 'turns': 1, 'sessionUpdated': '2026-10-01T00:00:00Z',
         'ts': '2026-10-01T00:00:00Z'},
        {'agent': 'grok', 'kind': 'session', 'session': 's', 'task': 't', 'totalTokens': 150,
         'outputTokens': 2, 'modelCalls': 2, 'turns': 1, 'sessionUpdated': '2026-10-20T00:00:00Z',
         'ts': '2026-10-20T00:00:00Z'},
    ]
    start = dt.datetime(2026, 10, 18, tzinfo=dt.timezone.utc)
    assert collect.grok_window(rows, start) == (50, {'t': 50})


def _row(ts, tokens, updated, task='t9-x', session='s1'):
    return {'ts': ts, 'agent': 'grok', 'kind': 'session', 'task': task, 'session': session,
            'totalTokens': tokens, 'sessionUpdated': updated}


def test_caps_flag_tokens_wall_and_no_commit_on_a_live_session():
    rows = [_row('2026-10-22T08:00:00Z', 1_000_000, '2026-10-22T08:00:00Z'),
            _row('2026-10-22T10:30:00Z', 55_000_000, '2026-10-22T10:29:00Z')]
    alerts = collect.grok_alerts(rows, '2026-10-22T10:35:00Z', commits=lambda task, since: 0)
    assert [a['kind'] for a in alerts] == ['tokens', 'wall', 'no-commit']
    assert alerts[0] == {'kind': 'tokens', 'value': 55_000_000, 'task': 't9-x', 'session': 's1', 'at': '2026-10-22T10:35:00Z'}
    assert alerts[1]['value'] == 2 * 3600 + 29 * 60


def test_caps_skip_finished_sessions_and_sessions_with_commits():
    rows = [_row('2026-10-22T08:00:00Z', 1, '2026-10-22T08:00:00Z'), _row('2026-10-22T10:30:00Z', 40_000_000, '2026-10-22T10:30:00Z')]
    assert [a['kind'] for a in collect.grok_alerts(rows, '2026-10-22T10:35:00Z', commits=lambda t, s: 3)] == ['tokens', 'wall']
    assert collect.grok_alerts(rows, '2026-10-22T12:00:00Z', commits=lambda t, s: 0) == []


def test_weekly_alert_only_when_the_reset_is_more_than_a_day_away():
    weekly = {'percentUsed': 76, 'at': '2026-10-21T13:24:01Z', 'resetsAt': 'October 23, 21:08'}
    assert [a['kind'] for a in collect.grok_alerts([], '2026-10-21T13:30:00Z', weekly)] == ['weekly']
    assert collect.grok_alerts([], '2026-10-23T13:30:00Z', {**weekly, 'at': '2026-10-23T13:24:01Z'}) == []
    assert collect.grok_alerts([], '2026-10-21T13:30:00Z', {**weekly, 'percentUsed': 50}) == []
