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
    check('german uses whisperx only', engines.preferred('de') == ['whisperx'])
    check('spanish uses whisperx only', engines.preferred('es') == ['whisperx'])
    check('arabic uses whisperx only', engines.preferred('ar') == ['whisperx'])
    check('persian uses whisperx only', engines.preferred('fa') == ['whisperx'])
    check('turkish uses whisperx only', engines.preferred('tr') == ['whisperx'])
    check('azerbaijani has no second model', engines.preferred('az') == [])
    check('latin has no second model', engines.preferred('la') == [])
    check('medieval german has no second model', engines.preferred('gmh') == [])
    check('ottoman turkish has no second model', engines.preferred('ota') == [])
    check('mms-1b is not a second aligner', 'mms1b' not in engines.ENGINES)
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
    check('IHCA solo count', n_solo == 103 and n == 105, f'{n_solo} solo of {n}')


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
    presnap = [0.02, 0.04]
    words = [
        {'roman': 'aa', 'ctc_s': 1.0, 'second_s': 1.04},
        {'roman': 'bb', 'ctc_s': 2.0, 'second_s': 2.05},
    ]
    got = Q.proof_line(True, 'good', True, presnap, words, True)
    check('solo agreement passes', got['pass'], str(got))
    got = Q.proof_line(False, 'good', True, presnap, words, True)
    check('choir does not pass', (not got['pass']) and got['reason'] == 'not-solo', str(got))
    far = [dict(words[0], second_s=1.4), words[1]]
    got = Q.proof_line(True, 'good', True, presnap, far, True)
    check('aligners 0.4 s apart fail', (not got['pass']) and got['reason'] == 'aligners-disagree', str(got))
    got = Q.proof_line(True, 'draft', True, presnap, words, True)
    check('text not found fails', got['reason'] == 'text-not-found', str(got))
    # Published time is irrelevant: the gate reads this pre-snap distance.
    got = Q.proof_line(True, 'good', True, [0.30, 0.04], words, True)
    check('pre-snap onset 0.3 s fails', (not got['pass']) and got['reason'] == 'onset', str(got))
    got = Q.proof_line(True, 'good', True, presnap, words, False)
    check('no align report fails closed', got['reason'] == 'no-report', str(got))
    # A missing attack is not legato and does not pass.
    got = Q.proof_line(True, 'good', True, [None, 0.04], words, True)
    check('no attack near the pre-snap start fails', (not got['pass']) and got['reason'] == 'onset', str(got))
    bare = [{'roman': 'aa', 'ctc_s': 1.0}, {'roman': 'bb', 'ctc_s': 2.0}]
    got = Q.proof_line(True, 'good', True, presnap, bare, True)
    check('a missing second model is not a fake disagreement', (not got['pass']) and got['reason'] == 'no-second-aligner', str(got))


def test_second_span() -> None:
    t0, t1 = align.second_span(108.87, 112.78, 100.0, 140.0, 580.0)
    check('phrase window is the line plus 2 s', abs(t0 - 106.87) < 1e-6 and abs(t1 - 114.78) < 1e-6, f'{t0:.2f}–{t1:.2f}')
    t0, t1 = align.second_span(108.87, 112.78, 100.0, 140.0, 580.0, prev_end=108.86, next_start=112.79)
    check('back-to-back lines are not inside the window', 108.8 <= t0 <= 108.87 and 112.78 <= t1 <= 112.85, f'{t0:.2f}–{t1:.2f}')
    t0, t1 = align.second_span(108.87, 112.78, 100.0, 140.0, 580.0, prev_end=100.0, next_start=120.0)
    check('a real gap still keeps the 2 s pad', abs(t0 - 106.87) < 1e-6 and abs(t1 - 114.78) < 1e-6, f'{t0:.2f}–{t1:.2f}')
    t0, t1 = align.second_span(32.8, 104.2, 20.0, 160.0, 580.0)
    check('a smeared phrase is capped at 12 s', abs((t1 - t0) - 12.0) < 1e-6 and t1 < 50, f'{t0:.2f}–{t1:.2f}')
    t0, t1 = align.second_span(10.0, 14.0, 12.0, 20.0, 580.0)
    check('window stays inside the section fence', t0 >= 11.5 and t1 <= 20.5, f'{t0:.2f}–{t1:.2f}')
    t0, t1 = align.second_span(126.54, 128.47, 107.75, 115.81, 580.0)
    check('a phrase outside its section is not dragged back', abs(t0 - 124.54) < 1e-6 and abs(t1 - 130.47) < 1e-6, f'{t0:.2f}–{t1:.2f}')


def test_anchor_fence() -> None:
    check('a span inside the section stays', align.anchor_in_section(108.0, 112.0, 100.0, 116.0))
    check('one second of slack stays', align.anchor_in_section(99.0, 117.0, 100.0, 116.0))
    check('a vocalise 70 s earlier is outside', not align.anchor_in_section(32.0, 104.0, 100.0, 116.0))
    check('a span that runs into the next chorus is outside', not align.anchor_in_section(108.0, 130.0, 100.0, 116.0))


def test_song_status() -> None:
    check('one of 38 solos is not a song', not Q.song_proven(1, 38))
    check('30 of 38 is under 80%', not Q.song_proven(30, 38))
    check('31 of 38 clears 80%', Q.song_proven(31, 38))
    check('no solo lines is not a song', not Q.song_proven(0, 0))
    # timing_payload follows the flag build_proof already computed.
    proof = {
        'aligned': True, 'solo': 38, 'passed': 31, 'failed_solo': 7, 'lines': [],
        'reasons': {'onset': 7},
        'onset_median': 0.04, 'onset_p90': 0.08,
    }
    payload = Q.timing_payload('i-have-come-alive', proof, {'lines': []})
    check('proved song is aligned', payload['status'] == 'aligned' and '80' in payload['notes'], payload['notes'][:120])
    proof['aligned'] = False
    proof['passed'] = 1
    payload = Q.timing_payload('i-have-come-alive', proof, {'lines': []})
    check('unproved song stays draft', payload['status'] == 'draft' and '80' in payload['notes'], payload['notes'][:160])


def test_build_proof_independent() -> None:
    """A word snapped onto the attack must still be scored by the aligner's earlier start."""
    _, sig = _bursts()
    sec = {'id': 's', 'kind': 'vocal', 'voice': 'Сами Юсуф', 'start': 0.0, 'end': 4.0}

    def line(lid: str) -> dict:
        return {'id': lid, 'lang': 'en', 'words': [{'w': 'a', 's': t, 'e': t + 0.1} for t in (1.0, 2.0, 3.0)]}

    def rec(lid: str, status: str, ctc: list[float], second: list[float]) -> dict:
        return {
            'id': lid, 'status': status, 'text': 'a a a', 'second': 'whisperx',
            'second_window': [0.0, 4.0],
            'words': [
                {'w': 'a', 'roman': 'a', 'ctc_s': c, 'second_s': s2, 's': p, 'onset_dt': round(p - c, 3)}
                for c, s2, p in zip(ctc, second, (1.0, 2.0, 3.0))
            ],
        }

    qa = [{'verdict': 'ok', 'offset': 0.0}]
    # Published s is the attack. CTC was 0.30 s early. Must not pass with error 0.
    snap = Q.build_proof(sig, [(sec, line('snapped'))], qa, {'lines': [
        rec('snapped', 'good', [0.70, 1.70, 2.70], [0.72, 1.72, 2.72]),
    ]})
    check('snapped line does not prove itself', (not snap['lines'][0]['pass']) and snap['lines'][0]['reason'] == 'onset', str(snap['lines'][0]))
    # A fair line and a text-not-found line. One proven solo of two is under 80 %.
    proof = Q.build_proof(sig, [(sec, line('fair')), (sec, line('missing'))], qa * 2, {'lines': [
        rec('fair', 'good', [1.02, 2.02, 3.02], [1.04, 2.03, 3.05]),
        rec('missing', 'draft', [1.02, 2.02, 3.02], [1.04, 2.03, 3.05]),
    ]})
    by = {r['id']: r for r in proof['lines']}
    check('pre-snap agreement can pass', by['fair']['pass'], str(by['fair']))
    check('text not found is not a proven solo', (not by['missing']['pass']) and by['missing']['reason'] == 'text-not-found', str(by['missing']))
    check('one proven solo of two stays draft', (not proof['aligned']) and proof['passed'] == 1 and proof['solo'] == 2, f"{proof['passed']}/{proof['solo']}")
    med = proof['onset_median']
    check('passing median is the pre-snap error', med is not None and 0 < med <= 0.10, str(med))


def main() -> int:
    test_viterbi()
    test_engines()
    test_normalise()
    test_solo()
    test_onsets()
    test_word_gate()
    test_proof_decision()
    test_song_status()
    test_build_proof_independent()
    test_second_span()
    test_anchor_fence()
    print('FAIL' if PASS else 'all checks passed')
    return PASS


if __name__ == '__main__':
    sys.exit(main())
