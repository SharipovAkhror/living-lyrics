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
        '': True,
    }
    for voice, want in samples.items():
        sec = {'voice': voice} if voice else {}
        got = T.is_solo(sec, {})
        check(f'solo {voice or "(пусто)"}', got is want, f'got {got}')
    check('empty voice is solo', T.group({}, {}) == 'solo')
    check('choir marker', T.group({'voice': 'Хор'}, {}) == 'choir')
    check('cappella is choir', T.group({'voice': 'Cappella Amsterdam'}, {}) == 'choir')
    check('choir wins over a duet mark', T.group({'voice': 'Сами Юсуф и хор'}, {}) == 'choir')
    check('duet is neither group', T.group({'voice': 'Сами Юсуф и Набила Маан'}, {}) == 'other')
    check('tutti is neither group', T.group({'voice': 'Все'}, {}) == 'other')
    root = Path(__file__).resolve().parents[2]
    lyrics = json.loads((root / 'content/songs/i-have-come-alive/lyrics.json').read_text(encoding='utf-8'))
    pairs = list(T.vocal_lines(lyrics))
    n_solo = sum(T.is_solo(sec, line) for sec, line in pairs)
    n_choir = sum(T.is_choir(sec, line) for sec, line in pairs)
    n = len(pairs)
    check('IHCA solo count', n_solo == 120 and n_choir == 0 and n == 120, f'{n_solo} solo, {n_choir} choir of {n}')


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
    # The cue gate is 0.30 s. Calls that should reach the onset pass a cue on the line start.
    cue = dict(cue_start=1.0, ctc_line_start=1.0)
    got = Q.proof_line(True, 'good', True, presnap, words, True, **cue)
    check('solo onset and cue pass', got['pass'] and got.get('second') == 'agree', str(got))
    got = Q.proof_line(False, 'good', True, presnap, words, True, **cue)
    check('a duet is not a group', (not got['pass']) and got['reason'] == 'not-solo', str(got))
    got = Q.proof_line('choir', 'good', True, [0.15, 0.04], words, True, **cue)
    check('choir onset 0.15 s passes', got['pass'], str(got))
    got = Q.proof_line('choir', 'good', True, [0.25, 0.04], words, True, **cue)
    check('choir onset over 0.2 s fails', (not got['pass']) and got['reason'] == 'onset', str(got))
    got = Q.proof_line(True, 'good', True, [0.15, 0.04], words, True, **cue)
    check('solo onset 0.15 s fails', (not got['pass']) and got['reason'] == 'onset', str(got))
    choir_words = [dict(words[0], second_s=1.15), words[1]]
    got = Q.proof_line('choir', 'good', True, presnap, choir_words, True, **cue)
    check('choir aligners 0.15 s apart still pass', got['pass'] and got.get('second') == 'agree', str(got))
    got = Q.proof_line('solo', 'good', True, presnap, choir_words, True, **cue)
    check('solo aligners 0.15 s apart do not block', got['pass'] and got.get('second') == 'disagree', str(got))
    far = [dict(words[0], second_s=1.4), words[1]]
    got = Q.proof_line(True, 'good', True, presnap, far, True, **cue)
    check('aligners 0.4 s apart do not block', got['pass'] and got.get('second') == 'disagree', str(got))
    got = Q.proof_line(True, 'draft', True, presnap, words, True, **cue)
    check('a cued line with no placement does not blame the text', got['reason'] == 'aligner-failed', str(got))
    got = Q.proof_line(True, 'draft', True, presnap, words, True)
    check('an uncued miss stays text-not-found', got['reason'] == 'text-not-found', str(got))
    # A consonant at 0.30 s still needs an attack. A vowel at exactly 0.30 s may use the second aligner.
    cons = [
        {'roman': 'ba', 'ctc_s': 1.0, 'second_s': 1.04},
        {'roman': 'bb', 'ctc_s': 2.0, 'second_s': 2.05},
    ]
    got = Q.proof_line(True, 'good', True, [0.30, 0.04], cons, True, **cue)
    check('a consonant at 0.30 s fails', (not got['pass']) and got['reason'] == 'onset', str(got))
    got = Q.proof_line(True, 'good', True, [0.30, 0.04], words, True, **cue)
    check('a vowel at exactly 0.30 s uses the second aligner', got['pass'] and got['paths']['second'] == 1, str(got))
    got = Q.proof_line(True, 'good', True, presnap, words, False, **cue)
    check('no align report fails closed', got['reason'] == 'no-report', str(got))
    got = Q.proof_line(True, 'good', True, [None, 0.04], cons, True, **cue)
    check('a consonant with no attack fails', (not got['pass']) and got['reason'] == 'onset', str(got))
    got = Q.proof_line(True, 'good', True, [None, 0.04], words, True, **cue)
    check('a vowel with no attack is proved by the second aligner', got['pass'] and got['paths']['second'] == 1 and got['paths']['attack'] == 1, str(got))
    bare_vowel = [{'roman': 'aa', 'ctc_s': 1.0}, {'roman': 'bb', 'ctc_s': 2.0, 'second_s': 2.0}]
    got = Q.proof_line(True, 'good', True, [None, 0.04], bare_vowel, True, **cue)
    check('a vowel with no attack and no second start fails', (not got['pass']) and got['reason'] == 'no-second-aligner', str(got))
    far_soft = [dict(words[0], second_s=1.4), words[1]]
    got = Q.proof_line(True, 'good', True, [None, 0.04], far_soft, True, **cue)
    check('a vowel whose second start is 0.4 s off fails', (not got['pass']) and got['reason'] == 'aligners-disagree', str(got))
    choir_soft = [dict(words[0], second_s=1.15), words[1]]
    got = Q.proof_line('choir', 'good', True, [None, 0.04], choir_soft, True, **cue)
    check('choir path B still wants 0.10 s', (not got['pass']) and got['reason'] == 'aligners-disagree', str(got))
    legato = [
        {'roman': 'ba', 'ctc_s': 1.0, 'ctc_e': 1.02, 'second_s': 1.01},
        {'roman': 'ka', 'ctc_s': 1.10, 'ctc_e': 1.12, 'second_s': 1.12},
    ]
    got = Q.proof_line(True, 'good', True, [0.02, None], legato, True, **cue)
    check('legato within 0.20 s with no attack uses the second aligner', got['pass'] and got['paths']['second'] == 1, str(got))
    bare = [{'roman': 'ba', 'ctc_s': 1.0}, {'roman': 'bb', 'ctc_s': 2.0}]
    got = Q.proof_line(True, 'good', True, presnap, bare, True, **cue)
    check('a missing second model does not block an attack', got['pass'] and got.get('second') == 'absent', str(got))
    got = Q.proof_line(True, 'good', True, presnap, words, True, cue_start=1.0, ctc_line_start=1.30)
    check('cue drift of 0.30 s passes', got['pass'], str(got))
    got = Q.proof_line(True, 'good', True, presnap, words, True, cue_start=1.0, ctc_line_start=1.31)
    check('cue drift of 0.31 s fails', (not got['pass']) and got['reason'] == 'cue-disagree', str(got))
    got = Q.proof_line(True, 'good', True, presnap, words, True, cue_start=1.0, ctc_line_start=1.70)
    check('cue drift of 0.70 s is not proved', (not got['pass']) and got['reason'] == 'cue-disagree', str(got))
    got = Q.proof_line(True, 'good', True, presnap, words, True)
    check('a line with no cue is not proved', (not got['pass']) and got['reason'] == 'cue-disagree', str(got))
    got = Q.proof_line(True, 'draft', True, presnap, words, True, cue_start=1.0, ctc_line_start=5.0)
    check('a cued miss stays aligner-failed even when the cue is far', got['reason'] == 'aligner-failed', str(got))
    got = Q.proof_line(True, 'weak', True, presnap, words, True, cue_start=1.0, ctc_line_start=5.0)
    check('a far weak line disagrees with the cue', got['reason'] == 'cue-disagree', str(got))
    got = Q.proof_line(True, 'weak', True, presnap, words, True, cue_start=1.0, ctc_line_start=1.0, structure_ok=False)
    check('structure failure on a near cue does not blame the text', got['reason'] == 'aligner-failed', str(got))
    got = Q.proof_line(True, 'weak', True, presnap, words, True, structure_ok=False)
    check('an uncued structure failure is text-not-found', got['reason'] == 'text-not-found', str(got))


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


def test_cue_window() -> None:
    # Back-to-back cues. The window may enter a neighbour by the overlap and no further.
    # Draft s/e are not an argument: the cue, its neighbours and the section fence are.
    t0, t1 = align.cue_window(102.462, 104.422, (100.814, 102.462), (104.422, 106.144), 90.0, 160.0, 580.0)
    check('cue window stays within the overlap of the previous cue', t0 >= 102.462 - align.CUE_OVERLAP - 1e-9, f'{t0:.3f}')
    check('cue window does not pass the next cue by more than the overlap', t1 <= 104.422 + align.CUE_OVERLAP + 1e-9, f'{t1:.3f}')
    check('the cue itself sits inside its window', t0 <= 102.462 <= 104.422 <= t1, f'{t0:.3f}–{t1:.3f}')
    t0, t1 = align.cue_window(10.0, 12.0, (0.0, 4.0), (20.0, 22.0), 0.0, 30.0, 580.0)
    check('a gap keeps the lead in front of the cue', abs(t0 - (10.0 - align.CUE_LEAD)) < 1e-9, f'{t0:.3f}')
    check('a gap keeps the tail after the cue', abs(t1 - (12.0 + align.CUE_TAIL)) < 1e-9, f'{t1:.3f}')
    t0, t1 = align.cue_window(10.0, 12.0, None, None, 11.0, 11.5, 580.0)
    check('the section map fences the cue window', t0 >= 11.0 - align.CUE_SECTION_PAD - 1e-9 and t1 <= 11.5 + align.CUE_SECTION_PAD + 1e-9, f'{t0:.3f}–{t1:.3f}')


def test_cue_times_stay() -> None:
    check('a confident line that agrees publishes the aligner', not align.keep_cue_time('good', True, 0.20))
    check('exactly 0.30 s still publishes the aligner', not align.keep_cue_time('good', True, 0.30))
    check('0.31 s keeps the cue', align.keep_cue_time('good', True, 0.31))
    check('a confident line 3.56 s off the cue keeps the cue', align.keep_cue_time('good', True, 3.56))
    check('0.81 s keeps the cue', align.keep_cue_time('good', True, 0.81))
    check('a confident line with no measured start keeps the cue', align.keep_cue_time('good', True, None))
    check('a weak line keeps its cue', align.keep_cue_time('weak', True, 0.1))
    check('an unfound line keeps its cue', align.keep_cue_time('draft', True))
    check('a draft without a cue may be fitted', not align.keep_cue_time('draft', False))
    check('shushtari drift is the aligner start against the cue',
          abs((align.line_drift([489.0], ['karitas'], 485.436) or 0) - 3.564) < 1e-6)
    moved = [[[0.0, 1.0]], [[10.0, 11.0]], [[3.0, 4.0]]]
    align.fit_drafts(moved, [False, True, False], 20.0)
    check('an uncued draft still moves into the gap', moved[1][0][0] < 10.0, str(moved[1]))
    kept = [[[0.0, 1.0]], [[10.0, 11.0]], [[3.0, 4.0]]]
    align.fit_drafts(kept, [False, False, False], 20.0)
    check('a cue time is not slid into the gap', kept[1][0] == [10.0, 11.0], str(kept[1]))


def test_harakat() -> None:
    try:
        import uroman  # noqa: F401
    except ImportError:
        check('uroman is installed', False, 'pip install uroman')
        return
    rom = align.Romaniser()
    voc = rom('بُدَمْ', 'fa', 'Arab')
    bare = rom('بدم', 'fa', 'Arab')
    check('harakat reach uroman as vowels', voc == 'budam', voc)
    check('the same word without harakat is the consonant skeleton', bare == 'bdm', bare)


def test_cue_in_build_proof() -> None:
    _, sig = _bursts()
    sec = {'id': 's', 'kind': 'vocal', 'voice': 'Сами Юсуф', 'start': 0.0, 'end': 4.0}
    line = {'id': 'drift', 'lang': 'en', 'words': [{'w': 'a', 's': t, 'e': t + 0.1} for t in (1.0, 2.0, 3.0)]}
    rec = {
        'id': 'drift', 'status': 'good', 'text': 'a a a', 'second': 'whisperx',
        'words': [
            {'w': 'a', 'roman': 'a', 'ctc_s': c, 'second_s': c + 0.02}
            for c in (1.90, 2.02, 3.02)
        ],
    }
    proof = Q.build_proof(sig, [(sec, line)], [{'verdict': 'ok'}], {'lines': [rec]},
                          {'drift': {'line': 'drift', 'start': 1.0, 'end': 3.2}})
    row = proof['lines'][0]
    check('a line 0.9 s off its cue is not proved', (not row['pass']) and row['reason'] == 'cue-disagree', str(row))
    check('cue median is that drift', proof['cue_median'] is not None and abs(proof['cue_median'] - 0.9) < 0.02, str(proof['cue_median']))
    check('the line counts as found', proof['found'] == 1, str(proof['found']))


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
    check('a choir under 80% blocks the song', not Q.song_ready([(31, 38), (1, 10)]))
    check('an empty choir does not block', Q.song_ready([(31, 38), (0, 0)]))
    check('both groups clear 80%', Q.song_ready([(31, 38), (8, 10)]))
    check('no groups is not a song', not Q.song_ready([]))
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

    def rec(lid: str, status: str, ctc: list[float], second: list[float], roman: str = 'a') -> dict:
        return {
            'id': lid, 'status': status, 'text': 'a a a', 'second': 'whisperx',
            'second_window': [0.0, 4.0],
            'words': [
                {'w': 'a', 'roman': roman, 'ctc_s': c, 'second_s': s2, 's': p, 'onset_dt': round(p - c, 3)}
                for c, s2, p in zip(ctc, second, (1.0, 2.0, 3.0))
            ],
        }

    qa = [{'verdict': 'ok', 'offset': 0.0}]
    # Published s is the attack. CTC was 0.30 s early. Must not pass with error 0.
    snap = Q.build_proof(sig, [(sec, line('snapped'))], qa, {'lines': [
        rec('snapped', 'good', [0.70, 1.70, 2.70], [0.72, 1.72, 2.72], roman='b'),
    ]}, {'snapped': {'line': 'snapped', 'start': 0.70, 'end': 3.2}})
    check('snapped line does not prove itself', (not snap['lines'][0]['pass']) and snap['lines'][0]['reason'] == 'onset', str(snap['lines'][0]))
    # A fair line and a text-not-found line. One proven solo of two is under 80 %.
    proof = Q.build_proof(sig, [(sec, line('fair')), (sec, line('missing'))], qa * 2, {'lines': [
        rec('fair', 'good', [1.02, 2.02, 3.02], [1.04, 2.03, 3.05]),
        rec('missing', 'draft', [1.02, 2.02, 3.02], [1.04, 2.03, 3.05]),
    ]}, {'fair': {'line': 'fair', 'start': 1.02, 'end': 3.2},
        'missing': {'line': 'missing', 'start': 1.02, 'end': 3.2}})
    by = {r['id']: r for r in proof['lines']}
    check('pre-snap agreement can pass', by['fair']['pass'], str(by['fair']))
    check('a cued miss is not a proven solo and does not blame the text',
          (not by['missing']['pass']) and by['missing']['reason'] == 'aligner-failed', str(by['missing']))
    check('one proven solo of two stays draft', (not proof['aligned']) and proof['passed'] == 1 and proof['solo'] == 2, f"{proof['passed']}/{proof['solo']}")
    med = proof['onset_median']
    check('passing median is the pre-snap error', med is not None and 0 < med <= 0.10, str(med))
    choir_sec = {'id': 'c', 'kind': 'vocal', 'voice': 'Хор', 'start': 0.0, 'end': 4.0}
    blocked = Q.build_proof(sig, [(choir_sec, line('sung')), (choir_sec, line('miss'))], qa * 2, {'lines': [
        rec('sung', 'good', [1.02, 2.02, 3.02], [1.04, 2.03, 3.05]),
        rec('miss', 'draft', [1.02, 2.02, 3.02], [1.04, 2.03, 3.05]),
    ]}, {'sung': {'line': 'sung', 'start': 1.02, 'end': 3.2},
        'miss': {'line': 'miss', 'start': 1.02, 'end': 3.2}})
    check('one proved choir line of two blocks the song',
          (not blocked['aligned']) and blocked['solo'] == 0
          and blocked['choir_passed'] == 1 and blocked['choir'] == 2,
          f"solo {blocked['passed']}/{blocked['solo']} choir {blocked['choir_passed']}/{blocked['choir']}")


def test_star_absorbs_a_hold() -> None:
    import diagnose_locate as D

    class U:
        def __init__(self, tok: int) -> None:
            self.tokens = [tok]
            self.word_of = [0]
            self.roman = ['a']

    lp = np.full((40, 3), -6.0, np.float32)
    lp[:, 0] = -0.5
    lp[10:26, 1] = -0.4
    lp[10, 1] = -0.05
    lp[30, 2] = -0.05
    got = D.align_stars(lp, [U(1), U(2)])
    check('star path exists', got is not None, str(got))
    if got is None:
        return
    a, b = got[0]['words'][0], got[1]['words'][0]
    check('a held letter stays on its spike', a is not None and a['f0'] == 10 and a['f1'] == 10, str(a))
    check('the next line stays after the gap', b is not None and b['f0'] == 30, str(b))


def test_calibration() -> None:
    import calibrate_score as C

    ok, why = C.structural([0.0, 0.20, 0.40], [0.02, 0.22, 0.42], None)
    check('spaced words pass structure', ok and why == 'ok', why)
    ok, why = C.structural([0.0, 0.05, 0.10], [0.02, 0.07, 0.12], None)
    check('two short gaps fail', (not ok) and why == 'short', why)
    ok, why = C.structural([0.0, 0.05, 0.40], [0.02, 0.07, 0.42], None)
    check('one short gap passes', ok, why)
    ok, why = C.structural([0.0, 0.01], [0.02, 0.03], None)
    check('a same-frame gap is eaten', (not ok) and why == 'eaten', why)
    ok, why = C.structural([0.2, 0.0], [0.22, 0.02], None)
    check('reversed order fails', (not ok) and why == 'order', why)
    ok, why = C.structural([0.0, None], [0.02, None], None)
    check('a missing word is eaten', (not ok) and why == 'eaten', why)
    ok, why = C.structural([0.0, 1.0], [0.02, 1.08], 1.0)
    check('a line end past the next cue fails', (not ok) and why == 'past-next', why)
    ok, why = C.structural([0.0, 1.0], [0.02, 1.05], 1.0)
    check('end slack of 0.05 passes', ok, why)
    ok, why = C.structural([0.0], [0.02], None)
    check('the last word is not checked for length', ok, why)

    def row(score: float, delta: float | None, structure: bool = True, lang: str = 'en', word_min: float | None = None) -> dict:
        return {'letter': score, 'word_mean': score, 'word_min': score if word_min is None else word_min,
                'delta': delta, 'structure_ok': structure, 'lang': lang}

    rows = [row(0.01, 1.5)] + [row(0.2, 0.1) for _ in range(60)]
    got = C.choose_threshold(rows)
    check('the cap prefers the threshold with no false lines',
          got['cap_met'] and got['metric'] == 'letter' and abs(got['threshold'] - 0.2) < 1e-9, str(got['threshold']))
    rows = [row(0.9, 1.2)] + [row(0.1, 0.05) for _ in range(40)]
    got = C.choose_threshold(rows)
    check('an unmet cap is reported', not got['cap_met'], str(got['cap_met']))
    rows = [row(0.2, 1.0)] + [row(0.2, 0.1) for _ in range(49)]
    got = C.choose_threshold(rows)
    check('one false in 50 is inside 2%', got['cap_met'] and got['near'] == 49 and got['false'] == 1,
          str({k: got[k] for k in ('cap_met', 'near', 'false', 'accepted')}))
    rows = [row(0.2, 1.0)] + [row(0.2, 0.1) for _ in range(48)]
    got = C.choose_threshold(rows)
    check('one false in 49 is over 2%', not got['cap_met'], str({k: got[k] for k in ('cap_met', 'false', 'accepted')}))
    rows = [row(0.5, None), row(0.4, 0.1, structure=False)]
    got = C.choose_threshold(rows)
    check('a row without a cue delta is not accepted', got['accepted'] == 1 and got['placed'] == 0 and got['near'] == 1, str(got))
    rows = [row(0.4, 0.1) for _ in range(5)]
    got = C.choose_threshold(rows)
    check('a tie prefers the letter mean', got['metric'] == 'letter', got['metric'])
    rows = [row(0.5, 0.1, structure=False), row(0.5, 0.1, structure=True)]
    got = C.choose_threshold(rows)
    check('structure cuts placement and not the score count', got['near'] == 2 and got['placed'] == 1, str(got))
    # 0.300 is inside, 0.301 is not. A false line at a lower score must not pull the threshold down
    # when the higher one already maximises the near count.
    rows = [row(0.8, 0.300), row(0.8, 0.301), row(0.2, 2.0)]
    got = C.choose_threshold(rows)
    check('exactly 0.300 s counts as near and 0.301 s does not', got['cap_met'] and got['near'] == 1 and got['threshold'] >= 0.8 - 1e-9, str(got))


def test_placement_and_cue_lock() -> None:
    check('a cued line with a low score is placed',
          align.placement_status(False, False, True, True, True) == 'good')
    check('a cued line far from the cue is not placed',
          align.placement_status(False, True, True, False, True) == 'weak')
    check('a cued line that fails structure is not placed',
          align.placement_status(False, True, False, True, True) == 'weak')
    check('an uncued line still needs the score',
          align.placement_status(False, False, True, False, False) == 'weak')
    check('an uncued line with the score is placed',
          align.placement_status(False, True, True, False, False) == 'good')
    check('a missing line stays draft',
          align.placement_status(True, True, True, True, True) == 'draft')
    # Copying the file left this block 3.5 s late. The shift puts the first word on the cue.
    stale = [[489.82, 496.83], [496.83, 498.53]]
    gap = abs(stale[0][0] - 486.296)
    check('the old copy leaves shushtari 3.5 s late', round(gap, 3) > 0.30, f'{gap:.3f}')
    moved = [list(pair) for pair in stale]
    align.shift_block(moved, 486.296)
    check('the block starts on the cue', abs(moved[0][0] - 486.296) < 1e-9, str(moved[0]))
    check('the gap inside the block stays',
          abs((moved[1][0] - moved[0][0]) - (496.83 - 489.82)) < 1e-6, str(moved))
    pulled = [[10.40, 11.0], [11.2, 12.0]]
    align.clamp_block(pulled, 10.0, 0.30)
    check('excess over 0.30 s is pulled back', abs(pulled[0][0] - 10.30) < 1e-9, str(pulled))
    check('a clamp moves the whole block', abs((pulled[1][0] - pulled[0][0]) - (11.2 - 10.40)) < 1e-6, str(pulled))
    held = [[10.20, 11.0]]
    align.clamp_block(held, 10.0, 0.30)
    check('a start already inside 0.30 s stays', held[0][0] == 10.20, str(held))
    lyrics = {'sections': [{'kind': 'vocal', 'id': 's', 'start': 400.0, 'end': 600.0, 'lines': [
        {'id': 'shushtari-s2', 'words': [
            {'w': 'اَلْكُلُّ', 's': 489.82, 'e': 496.83},
            {'w': 'لَمَّا', 's': 496.83, 'e': 498.53},
        ]},
    ]}]}
    align.lock_written_cues(lyrics, {'shushtari-s2': {'start': 486.296, 'end': 510.0}}, set())
    words = lyrics['sections'][0]['lines'][0]['words']
    check('a locked unplaced line starts on the cue grid', abs(words[0]['s'] - 486.3) < 1e-9, str(words[0]))
    check('the locked gap stays', abs((words[1]['s'] - words[0]['s']) - 7.01) < 0.021, str(words))
    check('the locked word text stays', words[0]['w'] == 'اَلْكُلُّ')


def test_cued_lines_stay_near_the_cue() -> None:
    """The site takes a line's start from its first word. That start stays within 0.30 s of the cue."""
    root = Path(__file__).resolve().parents[2]
    for slug in ('i-have-come-alive', 'karitas', 'one'):
        lyrics = json.loads((root / 'content' / 'songs' / slug / 'lyrics.json').read_text(encoding='utf-8'))
        cues = {row['line']: row for row in json.loads((root / 'docs' / 'analysis' / slug / 'cues.json').read_text(encoding='utf-8'))}
        seen = 0
        for _, line in T.vocal_lines(lyrics):
            cue = cues.get(line['id'])
            if cue is None or not line.get('words'):
                continue
            seen += 1
            gap = abs(float(line['words'][0]['s']) - float(cue['start']))
            check(f'{slug} {line["id"]} within 0.30 s of its cue', round(gap, 3) <= 0.30, f'{gap:.3f} s')
        check(f'{slug} has cued lines', seen > 0, str(seen))


def test_attack_chance() -> None:
    import attack_chance as A

    current = {'name': 'tol-0.10-h0.5', 'tol': 0.10, 'choir_tol': 0.20, 'peak_height': 0.5,
               'require_rise': False, 'require_second': False, 'chance': 0.12, 'true_rate': 0.90}
    tight = {'name': 'tol-0.04-h1.2', 'tol': 0.04, 'choir_tol': 0.08, 'peak_height': 1.2,
             'require_rise': False, 'require_second': False, 'chance': 0.01, 'true_rate': 0.40}
    got = A.choose([current, tight])
    check('a current rule under 15 % stays', got['name'] == 'tol-0.10-h0.5' and got['within_limit'], str(got))
    weak = dict(current, chance=0.40)
    got = A.choose([weak, tight])
    check('a weak current rule yields the tighter one', got['name'] == 'tol-0.04-h1.2' and got['within_limit'], str(got))
    better = {'name': 'tol-0.06-h0.5', 'tol': 0.06, 'choir_tol': 0.12, 'peak_height': 0.5,
              'require_rise': False, 'require_second': False, 'chance': 0.10, 'true_rate': 0.85}
    got = A.choose([weak, tight, better])
    check('among rules under 15 % the higher proof rate wins', got['name'] == 'tol-0.06-h0.5', str(got))
    rule = {'name': 'tol-0.10-h0.5', 'tol': 0.10, 'choir_tol': 0.20, 'peak_height': 0.5,
            'require_rise': False, 'require_second': False}
    one = [{'t': 1.0, 'group': 'solo', 'second': 1.0, 'line': 'a', 'roman': 'ba'}]
    dense = np.arange(0.0, 4.0, 0.2)
    check('dense onsets let a 0.15 s shift pass', A.hit_rate(one, dense, 0.15, rule) == 1.0)
    sparse = np.array([1.0, 5.0, 9.0])
    check('sparse onsets reject a 0.15 s shift', A.hit_rate(one, sparse, 0.15, rule) == 0.0)
    check('attacks every 0.2 s have that median gap', abs((A.median_interval(dense) or 0) - 0.2) < 1e-9)


def test_bench_summary() -> None:
    import bench_align as B

    rows = [
        {'lang': 'en', 'delta': 0.1},
        {'lang': 'en', 'delta': 0.4},
        {'lang': 'en', 'delta': None},
        {'lang': 'tr', 'delta': 0.2},
    ]
    got = B.summarize(rows)
    en = got['by_lang']['en']
    check('english places two of three', en['placed'] == 2 and en['n'] == 3, str(en))
    check('one english line is within 0.3 s', en['within_0_3'] == 1, str(en))
    check('both placed english lines are within 0.7 s', en['within_0_7'] == 2, str(en))
    check('median of the placed english lines is 0.25 s', abs(en['median'] - 0.25) < 1e-9, str(en))
    check('a missing start is not a zero', got['by_lang']['tr']['median'] == 0.2, str(got['by_lang']['tr']))


def main() -> int:
    test_viterbi()
    test_star_absorbs_a_hold()
    test_engines()
    test_normalise()
    test_solo()
    test_onsets()
    test_word_gate()
    test_proof_decision()
    test_song_status()
    test_build_proof_independent()
    test_second_span()
    test_cue_window()
    test_cue_times_stay()
    test_placement_and_cue_lock()
    test_cued_lines_stay_near_the_cue()
    test_attack_chance()
    test_calibration()
    test_bench_summary()
    test_harakat()
    test_cue_in_build_proof()
    test_anchor_fence()
    print('FAIL' if PASS else 'all checks passed')
    return PASS


if __name__ == '__main__':
    sys.exit(main())
