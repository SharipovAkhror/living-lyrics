"""Synthetic checks for the sync gate. No audio files, no torch, no ffmpeg.

    python scripts/pipeline/test_sync.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import align
import ctc
import engines
import features as F
import qa_sync as Q
import timing as T

PASS = 0


def check(name: str, ok: bool, detail: str = '') -> None:
    global PASS
    mark = 'ok' if ok else 'FAIL'
    if not ok:
        PASS = 1
    print(f'{mark}  {name}' + (f' — {detail}' if detail else ''))


def test_viterbi() -> None:
    # Frames 5, 12 and 20 carry letters 1, 2, 3. The path must start each letter there.
    n, v = 30, 5
    lp = np.full((n, v), -8.0)
    lp[:, 0] = -0.1
    for frame, tok in ((5, 1), (12, 2), (20, 3)):
        lp[frame, :] = -8
        lp[frame, tok] = 0
        lp[frame, 0] = -4
    path = ctc.viterbi(lp, [1, 2, 3], blank=0)
    check('viterbi finds a path', path is not None)
    first, _ = ctc.token_spans(path, 3)
    check('letter frames', list(first) == [5, 12, 20], str(list(first)))
    # A doubled letter needs a blank between the two copies, so the window must be long enough.
    check('too-short window is refused', ctc.viterbi(lp[:3], [1, 2, 3, 1], blank=0) is None)


def test_engines() -> None:
    check('english uses whisperx only', engines.preferred('en') == ['whisperx'])
    check('persian uses whisperx only', engines.preferred('fa') == ['whisperx'])
    check('azerbaijani uses mms-1b only', engines.preferred('az') == ['mms1b'])
    check('latin uses mms-1b only', engines.preferred('la') == ['mms1b'])
    check('medieval german has no second model', engines.preferred('gmh') == [])
    vocab = {'-': 0, '|': 1, 'a': 2, 'b': 3}
    tokens, owner = engines.line_tokens(['ab', 'ba'], vocab, {0, 1}, blank=0)
    check('word boundary between words', tokens == [2, 3, 1, 3, 2] and owner == [0, 0, -1, 1, 1], str(list(zip(tokens, owner))))
    # The bar must not become a word start.
    first = np.array([0, 4, 8, 10, 12])
    starts = engines._place(first, owner, [None, None], t0=1.0, n_frames=20, span=1.0)
    check('word starts skip the boundary token', starts == [1.0, 1.5], str(starts))


def test_normalise() -> None:
    check('apostrophe dropped', align.normalise("I've") == 'ive')
    check('turkish dotless i', align.normalise('Işık') == 'isik')
    check('german sz', align.normalise('Straße') == 'strasse')
    check('arabic is not latin here', align.normalise('مرده') == '')


def test_solo() -> None:
    def line(voice, section=None):
        return {'voice': section} if False else ({'voice': voice} if voice else {}), {'voice': section} if False else {}

    samples = {
        'Сами Юсуф': True,
        'Набила Маан': True,
        'Ханенде': True,
        'Хор': False,
        'Хор и Сами Юсуф': False,
        'Сами Юсуф и хор': False,
        'Сами Юсуф и Набила Маан': False,
        'Все исполнители': False,
        'Все': False,
        'Cappella Amsterdam': False,
        'Cappella Amsterdam и оркестр': False,
        '': False,
    }
    for voice, want in samples.items():
        sec = {'voice': voice} if voice else {}
        got = T.is_solo(sec, {})
        check(f'solo {voice or "(пусто)"}', got is want, f'got {got}')
    root = Path(__file__).resolve().parents[2]
    lyrics = json.loads((root / 'content/songs/i-have-come-alive/lyrics.json').read_text(encoding='utf-8'))
    n_solo = sum(T.is_solo(sec, line) for sec, line in T.vocal_lines(lyrics))
    n = sum(1 for _ in T.vocal_lines(lyrics))
    check('IHCA solo count', n_solo == 38 and n == 60, f'{n_solo} solo of {n}')


def _bursts() -> tuple[np.ndarray, Q.Signals]:
    rng = np.random.default_rng(0)
    x = np.zeros(F.SR * 4, np.float32)
    for t in (1.0, 2.0, 3.0):
        a = int(t * F.SR)
        n = int(0.18 * F.SR)
        burst = (0.4 * rng.standard_normal(n)).astype(np.float32)
        # A short fade so the attack is the start of the burst, not a click in the middle.
        burst *= np.linspace(0.2, 1, n).astype(np.float32)
        x[a:a + n] = burst
    return x, Q.Signals(x)


def test_onsets() -> None:
    _, sig = _bursts()
    peaks = Q.onset_peak_times(sig)
    for t in (1.0, 2.0, 3.0):
        if len(peaks) == 0:
            check(f'onset near {t}', False, 'no peaks')
            continue
        err = float(np.min(np.abs(peaks - t)))
        check(f'onset near {t}', err <= 0.08, f'{err:.3f} s, peaks {np.round(peaks, 3)[:8]}')


def test_word_gate() -> None:
    _, sig = _bursts()
    peaks = Q.onset_peak_times(sig)
    good = [{'w': 'a', 's': t, 'e': t + 0.18} for t in (1.0, 2.0, 3.0)]
    meas = Q.measure_word_voices(sig, good, peaks, None)
    check('words on attacks pass', all(m['ok'] for m in meas), str(meas))
    late = [{'w': 'a', 's': t + 0.30, 'e': t + 0.48} for t in (1.0, 2.0, 3.0)]
    bad = Q.measure_word_voices(sig, late, peaks, None)
    check('words 0.3 s late fail', all(not m['ok'] for m in bad), str(bad))
    # Continuation inside one phrase: no new attack, voice still on.
    held = [{'w': 'a', 's': 1.0, 'e': 1.12}, {'w': 'b', 's': 1.12, 'e': 1.18}]
    held_m = Q.measure_word_voices(sig, held, peaks, None)
    check('first word of a phrase needs an attack', held_m[0]['ok'], str(held_m[0]))
    check('the next word may be legato', held_m[1]['kind'] == 'legato' and held_m[1]['ok'], str(held_m[1]))
    # A continuation that misses its own later attack still fails. The earlier peak is the first word's.
    missed = [{'w': 'a', 's': 1.0, 'e': 1.12}, {'w': 'b', 's': 1.25, 'e': 1.40}]
    missed_m = Q.measure_word_voices(sig, missed, np.array([0.98, 1.40]), None)
    check('a new attack 0.15 s off still fails', missed_m[1]['kind'] == 'onset-far' and not missed_m[1]['ok'], str(missed_m[1]))


def test_proof_decision() -> None:
    qa_ok = {'verdict': 'ok', 'offset': 0.0}
    meas = [{'ok': True, 'abs': 0.02, 'kind': 'onset'}, {'ok': True, 'abs': 0.04, 'kind': 'onset'}]
    words = [
        {'roman': 'aa', 'ctc_s': 1.0, 'second_s': 1.04},
        {'roman': 'bb', 'ctc_s': 2.0, 'second_s': 2.05},
    ]
    got = Q.proof_line(True, 'good', True, meas, words, qa_ok, True)
    check('solo agreement passes', got['pass'], str(got))
    got = Q.proof_line(False, 'good', True, meas, words, qa_ok, True)
    check('choir does not pass', (not got['pass']) and got['reason'] == 'not-solo', str(got))
    far = [dict(words[0], second_s=1.4), words[1]]
    got = Q.proof_line(True, 'good', True, meas, far, qa_ok, True)
    check('aligners 0.4 s apart fail', (not got['pass']) and got['reason'] == 'aligners-disagree', str(got))
    got = Q.proof_line(True, 'draft', True, meas, words, qa_ok, True)
    check('text not found fails', got['reason'] == 'text-not-found', str(got))
    onset = [{'ok': False, 'abs': 0.3, 'kind': 'onset-far'}, meas[1]]
    got = Q.proof_line(True, 'good', True, onset, words, qa_ok, True)
    check('onset 0.3 s fails', got['reason'] == 'onset', str(got))
    got = Q.proof_line(True, 'good', True, meas, words, qa_ok, False)
    check('no align report fails closed', got['reason'] == 'no-report', str(got))


def test_song_status() -> None:
    # One proved solo line, onset errors under 0.1 → aligned.
    proof = {
        'aligned': True, 'solo': 2, 'passed': 1, 'failed_solo': 1, 'lines': [],
        'reasons': {'onset': 1},
        'onset_median': 0.02, 'onset_p90': 0.04,
    }
    # timing_payload reads the dict as build_proof returns it; call it directly.
    payload = Q.timing_payload('i-have-come-alive', proof, {'lines': []})
    check('proved song is aligned', payload['status'] == 'aligned', payload['notes'][:80])
    proof['aligned'] = False
    proof['passed'] = 0
    payload = Q.timing_payload('i-have-come-alive', proof, {'lines': []})
    check('unproved song stays draft', payload['status'] == 'draft' and 'draft' in payload['notes'], payload['status'])


def main() -> int:
    test_viterbi()
    test_engines()
    test_normalise()
    test_solo()
    test_onsets()
    test_word_gate()
    test_proof_decision()
    test_song_status()
    print('FAIL' if PASS else 'all checks passed')
    return PASS


if __name__ == '__main__':
    sys.exit(main())
