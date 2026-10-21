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
    check('ə x q map to e h g', engines.map_word('ƏxQə', engines.AZ_TR_MAP) == 'EhGe', engines.map_word('ƏxQə', engines.AZ_TR_MAP))
    check('azerbaijani k stays k', engines.map_word('k', engines.AZ_TR_MAP) == 'k')
    check('latin y maps to italian i', engines.map_word('y', engines.LA_IT_MAP) == 'i')
    check('latin w maps to spanish u', engines.map_word('w', engines.LA_ES_MAP) == 'u')
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
    check('IHCA solo count', n_solo == 125 and n_choir == 0 and n == 125, f'{n_solo} solo, {n_choir} choir of {n}')


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
    check('the publication bar is 0.90', Q.SONG_SHARE == 0.90, str(Q.SONG_SHARE))
    check('one of 38 solos is not a song', not Q.song_proven(1, 38))
    check('34 of 38 is under 90%', not Q.song_proven(34, 38))
    check('35 of 38 clears 90%', Q.song_proven(35, 38))
    check('108 of 120 meets 90%', Q.song_proven(108, 120))
    check('107 of 120 is under 90%', not Q.song_proven(107, 120))
    check('31 of 38 no longer clears the bar', not Q.song_proven(31, 38))
    check('9 of 10 meets 90%', Q.song_proven(9, 10))
    check('8 of 10 is under 90%', not Q.song_proven(8, 10))
    check('no solo lines is not a song', not Q.song_proven(0, 0))
    check('a choir under 90% blocks the song', not Q.song_ready([(35, 38), (8, 10)]))
    check('an empty choir does not block', Q.song_ready([(35, 38), (0, 0)]))
    check('both groups clear 90%', Q.song_ready([(35, 38), (9, 10)]))
    check('no groups is not a song', not Q.song_ready([]))
    # timing_payload follows the flag build_proof already computed.
    proof = {
        'aligned': True, 'solo': 38, 'passed': 35, 'failed_solo': 3, 'lines': [],
        'reasons': {'onset': 3},
        'onset_median': 0.04, 'onset_p90': 0.08,
    }
    payload = Q.timing_payload('i-have-come-alive', proof, {'lines': []})
    check('proved song is aligned', payload['status'] == 'aligned' and '90' in payload['notes'], payload['notes'][:120])
    proof['aligned'] = False
    proof['passed'] = 1
    payload = Q.timing_payload('i-have-come-alive', proof, {'lines': []})
    check('unproved song stays draft', payload['status'] == 'draft' and '90' in payload['notes'], payload['notes'][:160])


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
    # A fair line and a text-not-found line. One proven solo of two is under 90 %.
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
    ok, why = C.structural([10.05], [10.20], None, (0.0, 10.0))
    check('a start on the section slack passes', ok and why == 'ok', why)
    ok, why = C.structural([10.06], [10.20], None, (0.0, 10.0))
    check('a start 0.06 s past the section fails', (not ok) and why == 'outside-section', why)
    ok, why = C.structural([0.0, 0.20, 0.40], [0.02, 0.22, 0.42], None, None)
    check('no section keeps the old structure check', ok and why == 'ok', why)

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
    """The site takes a line's start from its first word.

    A same-language cue stays within 0.30 s. A translation cue may sit further
    only when the measured rule publishes a numeric half, and only out to that
    half. A missing key or a null half keeps 0.30 s.
    """
    import placement as P

    root = Path(__file__).resolve().parents[2]
    chosen = {}
    rule_path = root / 'docs' / 'analysis' / 'bench' / 'attack-chance.json'
    if rule_path.exists():
        try:
            chosen = json.loads(rule_path.read_text(encoding='utf-8')).get('chosen') or {}
        except (OSError, json.JSONDecodeError):
            chosen = {}
    half = None
    if 'translation_half' in chosen and chosen.get('translation_half') is not None:
        half = float(chosen['translation_half'])
    wide = None
    if 'line_wide' in chosen and chosen.get('line_wide') is not None:
        wide = {str(item) for item in chosen.get('line_wide') or []}
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
            translated = P.cue_is_translation(line.get('lang'), cue.get('lang'))
            limit = 0.30
            if translated and half is not None and (wide is None or line['id'] in wide):
                limit = half
            check(f'{slug} {line["id"]} within {limit:.2f} s of its cue', round(gap, 3) <= limit, f'{gap:.3f} s')
        check(f'{slug} has cued lines', seen > 0, str(seen))


def test_section_edges() -> None:
    lyrics = {'sections': [
        {'kind': 'vocal', 'id': 'a', 'start': 0.0, 'end': 10.0, 'lines': [
            {'id': 'l', 'text': 'keep', 'words': [{'w': 'keep', 's': 9.0, 'e': 10.40}]},
        ]},
        {'kind': 'instrumental', 'id': 'b', 'start': 12.0, 'end': 20.0, 'lines': []},
    ]}
    n = T.fit_section_edges(lyrics)
    word = lyrics['sections'][0]['lines'][0]['words'][0]
    check('a free section end extends to the word', lyrics['sections'][0]['end'] == 10.40 and n >= 1, str(lyrics['sections'][0]['end']))
    check('the extended word text and start stay', word['w'] == 'keep' and word['s'] == 9.0 and word['e'] == 10.40, str(word))
    tight = {'sections': [
        {'kind': 'vocal', 'id': 'a', 'start': 1.0, 'end': 10.0, 'lines': [
            {'id': 'l', 'text': 'cut', 'words': [{'w': 'cut', 's': 9.5, 'e': 10.40}]},
        ]},
        {'kind': 'instrumental', 'id': 'b', 'start': 10.0, 'end': 20.0, 'lines': []},
    ]}
    T.fit_section_edges(tight)
    cut = tight['sections'][0]['lines'][0]['words'][0]
    check('a blocked word end is trimmed to the boundary', cut['e'] <= 10.05 and cut['s'] == 9.5 and cut['w'] == 'cut', str(cut))
    check('a trim does not move the section start', tight['sections'][0]['start'] == 1.0)
    inside = {'sections': [
        {'kind': 'vocal', 'id': 'a', 'start': 0.0, 'end': 10.0, 'lines': [
            {'id': 'l', 'words': [{'w': 'ok', 's': 9.0, 'e': 10.04}]},
        ]},
    ]}
    check('a word inside the 0.05 s margin is left alone', T.fit_section_edges(inside) == 0 and inside['sections'][0]['end'] == 10.0)
    outside = {'sections': [
        {'kind': 'vocal', 'id': 'fuzuli-4b', 'start': 138.48, 'end': 180.26, 'lines': [
            {'id': 'fuzuli-f8-1', 'words': [
                {'w': 'ger', 's': 171.47, 'e': 171.93},
                {'w': 'nedir.', 's': 180.91, 'e': 186.3},
            ]},
        ]},
        {'kind': 'instrumental', 'id': 'voice-2', 'start': 180.26, 'end': 195.0, 'lines': []},
    ]}
    n = T.pull_outside_starts(outside)
    words = outside['sections'][0]['lines'][0]['words']
    check('the cue word is not pulled', n >= 1 and words[0]['s'] == 171.47 and words[0]['w'] == 'ger', str(words[0]))
    check('a start past the section is pulled inside the slack',
          words[1]['w'] == 'nedir.' and words[1]['s'] <= 180.31 and words[1]['e'] <= 180.31
          and words[1]['e'] > words[1]['s'], str(words[1]))
    check('pulling a start does not move the section', outside['sections'][0]['end'] == 180.26 and outside['sections'][1]['start'] == 180.26)


def test_bias_and_witnesses() -> None:
    import aligner_review as R
    import attack_chance as A

    def line(i: int, shift: float) -> dict:
        return {
            'id': f'l{i}', 'lang': 'tr', 'status': 'good', 'second': 'whisperx',
            'words': [
                {'roman': 'ba', 'ctc_s': 10.0 + i, 'second_s': 10.0 + i + shift},
                {'roman': 'ka', 'ctc_s': 10.4 + i, 'second_s': 10.4 + i + shift},
            ],
        }

    stable = R.bias_decision([line(i, 0.05) for i in range(20)], R._second_of)
    check('a stable shift is applied from the first half', stable['applied'] and abs(stable['offset'] - 0.05) < 1e-9, str(stable))
    noisy = R.bias_decision([line(i, 0.50 if i % 2 == 0 else -0.40) for i in range(20)], R._second_of)
    check('a wide spread is not subtracted', not noisy['applied'] and noisy['reason'] == 'wide-spread', str(noisy))

    one = [{'roman': 'ba', 'ctc_s': 1.0, 'second_s': 1.05, 'third_s': 1.40}]
    got = Q.prove_words(one, [0.02], 0.10, witnesses='one')
    check('an attack plus one witness passes', got[0]['path'] == 'witness-second', str(got[0]))
    alone = [{'roman': 'ba', 'ctc_s': 1.0, 'second_s': 1.40, 'third_s': 1.50}]
    got = Q.prove_words(alone, [0.02], 0.10, witnesses='one')
    check('an attack with no agreeing witness fails', got[0]['path'] == 'fail', str(got[0]))
    missing = [{'roman': 'ba', 'ctc_s': 1.0}]
    got = Q.prove_words(missing, [0.02], 0.10, witnesses='one')
    check('an attack with both witnesses missing fails', got[0]['path'] == 'fail' and got[0]['reason'] == 'no-second-aligner', str(got[0]))
    got = Q.prove_words(one, [0.02], 0.10, witnesses='two')
    check('two of three needs both clocks within 0.10 s of MMS', got[0]['path'] == 'fail', str(got[0]))
    both = [{'roman': 'ba', 'ctc_s': 1.0, 'second_s': 1.05, 'third_s': 1.08}]
    got = Q.prove_words(both, [0.02], 0.10, witnesses='two')
    check('both clocks within 0.10 s pass', got[0]['path'] == 'witness-both', str(got[0]))
    # The default rule still has the soft path. build_proof(None) does not read the bench file.
    soft = Q.prove_words([{'roman': 'aa', 'ctc_s': 1.0, 'second_s': 1.04}], [None], 0.10)
    check('the default rule still proves a soft word from the second aligner', soft[0]['path'] == 'second', str(soft[0]))

    witness = {'name': 'attack-h0.7-one', 'tol': 0.10, 'choir_tol': 0.20, 'peak_height': 0.7,
               'require_rise': False, 'require_second': False, 'witnesses': 'one', 'agree_tol': 0.10}
    probe = [{'t': 1.0, 'group': 'solo', 'second': 1.0, 'third': 9.0, 'line': 'a', 'roman': 'ba'}]
    peaks = np.array([1.0, 1.15, 5.0])
    check('a shifted probe that misses the fixed witnesses fails', A.hit_rate(probe, peaks, 0.15, witness) == 0.0)
    on_clock = [{'t': 1.0, 'group': 'solo', 'second': 1.15, 'third': None, 'line': 'a', 'roman': 'ba'}]
    check('a probe that lands on the witness passes', A.hit_rate(on_clock, peaks, 0.15, witness) == 1.0)

    current = {'name': 'tol-0.10-h0.5', 'tol': 0.10, 'choir_tol': 0.20, 'peak_height': 0.5,
               'require_rise': False, 'require_second': False, 'chance': 0.10, 'true_rate': 0.90}
    one_rule = dict(witness, chance=0.12, true_rate=0.50)
    got_rule = A.choose([current, one_rule])
    check('a witness rule under 15 % wins over the older grid', got_rule['name'] == 'attack-h0.7-one', str(got_rule))
    two_rule = {'name': 'attack-h0.7-two', 'tol': 0.10, 'choir_tol': 0.20, 'peak_height': 0.7,
                'require_rise': False, 'require_second': False, 'witnesses': 'two', 'chance': 0.08, 'true_rate': 0.20}
    got_rule = A.choose([current, dict(one_rule, chance=0.40), two_rule])
    check('the two-witness rule is next when one witness is over 15 %', got_rule['name'] == 'attack-h0.7-two', str(got_rule))


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


def test_line_rule() -> None:
    import attack_chance as A

    check('one of two meets a half', Q.share_met(1, 2, 0.50))
    check('one of three meets 0.33', Q.share_met(1, 3, 0.33))
    check('one of four misses 0.33', not Q.share_met(1, 4, 0.33))

    slices = [
        {'song': 'one', 'lang': '*', 'words': 160, 'one': 0.206, 'two': 0.02},
        {'song': 'one', 'lang': 'ar', 'words': 84, 'one': 0.161, 'two': 0.02},
        {'song': 'one', 'lang': 'de', 'words': 76, 'one': 0.257, 'two': 0.03},
        {'song': 'ihca', 'lang': '*', 'words': 250, 'one': 0.066, 'two': 0.01},
        {'song': 'ihca', 'lang': 'en', 'words': 44, 'one': 0.159, 'two': 0.02},
        {'song': 'ihca', 'lang': 'tr', 'words': 47, 'one': 0.032, 'two': 0.01},
        {'song': 'ihca', 'lang': 'xx', 'words': 10, 'one': 0.50, 'two': 0.40},
    ]
    scopes, ok = A.assign_scopes(slices)
    by = {(row['song'], row['lang']): row for row in scopes}
    check('ONE needs both witnesses', ok and by[('one', '*')]['witnesses'] == 'two', str(by[('one', '*')]))
    check('ONE Arabic needs both witnesses', by[('one', 'ar')]['witnesses'] == 'two')
    check('ONE German needs both witnesses', by[('one', 'de')]['witnesses'] == 'two')
    check('IHCA keeps one witness', by[('ihca', '*')]['witnesses'] == 'one' and by[('ihca', '*')]['why'] == 'slice-one')
    check('IHCA English needs both on its own sample', by[('ihca', 'en')]['witnesses'] == 'two')
    check('IHCA Turkish keeps one witness', by[('ihca', 'tr')]['witnesses'] == 'one')
    short = by[('ihca', 'xx')]
    check('a short language inherits the song', short['witnesses'] == 'one' and short['why'] == 'song-fallback', str(short))
    check('the inherited chance is the song chance', abs(short['chance'] - 0.066) < 1e-12, str(short['chance']))
    over = [dict(row) for row in slices]
    over[2] = dict(over[2], two=0.20)
    _, over_ok = A.assign_scopes(over)
    check('a slice over 15 % on both rules is not within the limit', not over_ok)

    rule = {'scopes': [
        {'song': 'ihca', 'lang': 'en', 'witnesses': 'two'},
        {'song': 'ihca', 'lang': '*', 'witnesses': 'one'},
    ]}
    check('a language scope wins', Q.witnesses_for(rule, 'ihca', 'en') == 'two')
    check('a missing language uses the song scope', Q.witnesses_for(rule, 'ihca', 'fa') == 'one')

    refute = {'both_agree': 0.10, 'both_far': 0.20, 'only_far': 0.30, 'attack_tol': 0.10}
    peaks = np.array([1.40])
    both = {'ctc_s': 1.0, 'second_s': 1.40, 'third_s': 1.45}
    check('both clocks that agree far from MMS refute the word',
          Q.word_refuted(both, peaks, refute) == 'witnesses-agree-elsewhere')
    split = {'ctc_s': 1.0, 'second_s': 1.05, 'third_s': 1.40}
    check('clocks that do not agree are not a refutation', Q.word_refuted(split, peaks, refute) is None)
    close = {'ctc_s': 1.0, 'second_s': 1.05}
    check('one clock close to MMS is not a refutation', Q.word_refuted(close, peaks, refute) is None)
    lone = {'ctc_s': 1.0, 'second_s': 1.40}
    check('one far clock with an attack MMS lacks refutes the word',
          Q.word_refuted(lone, np.array([1.40]), refute) == 'witness-attack')
    check('a peak at both times is not a single-witness refutation',
          Q.word_refuted(lone, np.array([1.0, 1.40]), refute) is None)
    check('no clock is not a refutation', Q.word_refuted({'ctc_s': 1.0}, peaks, refute) is None)
    check('both clocks refute even when MMS has an attack',
          Q.word_refuted(both, np.array([1.0, 1.40]), refute) == 'witnesses-agree-elsewhere')
    check('a lone clock still refutes when no sibling is passed',
          Q.word_refuted(lone, np.array([1.40]), refute, siblings=[1.0]) == 'witness-attack')
    check('a lone clock closer to another lettered start does not refute this word',
          Q.word_refuted(lone, np.array([1.40]), refute, siblings=[1.40, 1.80, 2.20]) is None)
    check('two clocks that agree still refute when a sibling is closer',
          Q.word_refuted(both, np.array([1.40]), refute, siblings=[1.40]) == 'witnesses-agree-elsewhere')

    near_words = [
        {'roman': 'ba', 'ctc_s': 1.00, 'ctc_e': 1.30, 'second_s': 1.40},
        {'roman': 'ka', 'ctc_s': 1.40, 'ctc_e': 1.70, 'second_s': 1.42},
        {'roman': 'da', 'ctc_s': 1.80, 'ctc_e': 2.10, 'second_s': 1.82},
        {'roman': 'ga', 'ctc_s': 2.20, 'ctc_e': 2.50, 'second_s': 2.22},
    ]
    near_cue = dict(cue_start=1.0, ctc_line_start=1.0)
    near_shift = [0.40, 0.02, 0.02, 0.02]
    near_peaks = np.array([1.40])
    missed = Q.proof_line(True, 'good', True, near_shift, near_words, True,
                          witnesses='one', line_share=0.25, refute=refute,
                          peaks=near_peaks, nearest=False, **near_cue)
    check('without nearest the misplaced witness fails the line',
          (not missed['pass']) and missed['reason'] == 'word-refuted', str(missed))
    held_near = Q.proof_line(True, 'good', True, near_shift, near_words, True,
                             witnesses='one', line_share=0.25, refute=refute,
                             peaks=near_peaks, nearest=True, **near_cue)
    check('nearest keeps the line when the other words are proved',
          held_near['pass'] and held_near['reason'] == 'pass', str(held_near))
    agreed_words = [dict(near_words[0], third_s=1.45), *near_words[1:]]
    still_refuted = Q.proof_line(True, 'good', True, near_shift, agreed_words, True,
                                 witnesses='one', line_share=0.25, refute=refute,
                                 peaks=near_peaks, nearest=True, **near_cue)
    check('two agreeing clocks still fail the line when nearest is on',
          (not still_refuted['pass']) and still_refuted['reason'] == 'word-refuted', str(still_refuted))
    shifted = [
        {'t': 0.80, 'roman': 'ba', 'second': 1.40},
        {'t': 1.20, 'roman': 'ka', 'second': 1.22},
        {'t': 1.60, 'roman': 'da', 'second': 1.62},
        {'t': 2.00, 'roman': 'ga', 'second': 2.02},
    ]
    _bare, bare_flags = A._probe_parts(shifted, np.array([1.20, 1.40, 1.60, 2.00]), 'solo', 'one', refute, None)
    _near, near_flags = A._probe_parts(
        shifted, np.array([1.20, 1.40, 1.60, 2.00]), 'solo', 'one', refute, None, nearest=True)
    check('a shifted lone clock uses the moved starts when nearest is on',
          bare_flags[0] == 'witness-attack' and near_flags[0] is None, str((bare_flags, near_flags)))

    cue = dict(cue_start=1.0, ctc_line_start=1.0)
    words = [
        {'roman': 'ba', 'ctc_s': 1.0, 'second_s': 1.02, 'third_s': 1.03},
        {'roman': 'ka', 'ctc_s': 1.4, 'second_s': 1.42, 'third_s': 1.41},
        {'roman': 'da', 'ctc_s': 1.8, 'second_s': 1.82, 'third_s': 1.81},
        {'roman': 'ga', 'ctc_s': 2.2, 'second_s': 2.22, 'third_s': 2.21},
    ]
    half = Q.proof_line(True, 'good', True, [0.02, 0.02, 0.50, 0.50], words, True,
                        witnesses='one', line_share=0.50, refute=refute, peaks=peaks, **cue)
    check('half the words prove the line', half['pass'], str(half))
    refused = [
        words[0], words[1],
        {'roman': 'da', 'ctc_s': 1.8, 'second_s': 2.30, 'third_s': 2.35},
        words[3],
    ]
    blocked = Q.proof_line(True, 'good', True, [0.02, 0.02, 0.02, 0.02], refused, True,
                           witnesses='one', line_share=0.50, refute=refute, peaks=np.array([2.30]), **cue)
    check('one refuted word fails the line', (not blocked['pass']) and blocked['reason'] == 'word-refuted', str(blocked))
    few = Q.proof_line(True, 'good', True, [0.02, 0.50, 0.50, 0.50], words, True,
                       witnesses='one', line_share=0.25, refute=refute, peaks=peaks, **cue)
    check('fewer than two proved words fails', (not few['pass']) and few['reason'] == 'word-share', str(few))
    every = Q.proof_line(True, 'good', True, [0.02, 0.02, 0.50, 0.50], words, True,
                         witnesses='one', line_share=1.0, refute=refute, peaks=peaks, **cue)
    check('K of 1 still needs every word', (not every['pass']) and every['reason'] == 'word-share', str(every))

    grid = [
        {'both_far': 0.15, 'only_far': 0.20, 'refuted': 20, 'words': 100},
        {'both_far': 0.20, 'only_far': 0.30, 'refuted': 10, 'words': 100},
        {'both_far': 0.20, 'only_far': 0.40, 'refuted': 8, 'words': 100},
        {'both_far': 0.30, 'only_far': 0.30, 'refuted': 5, 'words': 100},
        {'both_far': 0.30, 'only_far': 0.40, 'refuted': 2, 'words': 100},
    ]
    kept = A.choose_refute(grid)
    check('the proposal stays when it refutes under 15 %',
          kept['both_far'] == 0.20 and kept['only_far'] == 0.30 and kept['within_cap'], str(kept))
    steep = [dict(row) for row in grid]
    steep[1] = dict(steep[1], refuted=40, rate=0.40)
    steep[2] = dict(steep[2], refuted=30, rate=0.30)
    stepped = A.choose_refute(steep)
    check('a proposal over 15 % steps up to the least strict pair under the cap',
          stepped['both_far'] == 0.30 and stepped['only_far'] == 0.30 and stepped['within_cap'], str(stepped))

    loose = A.choose_k([
        {'k': 0.50, 'chance': 0.08, 'proved': 40},
        {'k': 0.75, 'chance': 0.04, 'proved': 20},
    ])
    check('the K under 5 % is kept', loose['k'] == 0.75 and loose['within_limit'], str(loose))
    tight = A.choose_k([
        {'k': 0.50, 'chance': 0.04, 'proved': 40},
        {'k': 0.75, 'chance': 0.02, 'proved': 20},
    ])
    check('the lower K with more lines wins when both are under 5 %', tight['k'] == 0.50, str(tight))

    line = {
        'id': 'l', 'placed': True, 'group': 'solo', 'lang': 'en', 'song': 's',
        'cue_start': 1.0, 'ctc_start': 1.0,
        'words': [
            {'t': 1.0, 'roman': 'ba', 'second': 1.0, 'third': 1.0, 'ctc_e': 1.2},
            {'t': 2.0, 'roman': 'ka', 'second': 2.0, 'third': 2.0, 'ctc_e': 2.2},
        ],
    }
    attacks = np.array([1.0, 2.0])
    modes = {('s', 'en'): 'one'}
    hit, n = A.line_pass_count([line], attacks, modes, refute, 1.0, shift=0.0)
    check('the unshifted line passes', hit == 1 and n == 1, f'{hit}/{n}')
    miss, n = A.line_pass_count([line], attacks, modes, refute, 1.0, shift=0.15)
    check('a 0.15 s shift that drops the line is a line miss', miss == 0 and n == 1, f'{miss}/{n}')
    short_line = dict(line, words=line['words'][:1], ctc_start=1.0)
    _, short_n = A.line_pass_count([short_line], attacks, modes, refute, 1.0)
    check('a one-word line is outside the line chance', short_n == 0)


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


def test_placement_chain() -> None:
    import attack_chance as A
    import placement as P

    check('an MMS window is the MMS placer', P.primary_family('mms-window') == 'mms' and P.primary_family('mms-ft') == 'mms')
    check('stable-ts and the second aligner are their own placers',
          P.primary_family('stable-ts') == 'stable-ts' and P.primary_family('second') == 'second')
    t0, t1 = P.span_to_next(10.0, 12.0, 14.0, 100.0, 0.8, 0.0)
    check('a rescue window runs from this cue to the next', abs(t0 - 9.2) < 1e-9 and abs(t1 - 14.0) < 1e-9, f'{t0},{t1}')
    check('the same window is recognised', P.same_window((1.0, 2.0), (1.04, 2.04)))
    check('a different window is not', not P.same_window((1.0, 2.0), (1.2, 2.0)))
    ends = P.ends_from_starts([1.0, None], 1.2)
    check('a last end before the next cue stops at that cue', ends[0] == 1.2 and ends[1] is None, str(ends))
    past = P.ends_from_starts([1.5], 1.2)
    check('a start past the next cue is not pulled back', past[0] is not None and past[0] > 1.2 + 0.05, str(past))
    held = P.judge([1.0, 1.5], [1.5, 2.0], 1.0, 3.0)
    check('structure and 0.00 s places the line', held['placed'] and held['structure'] == 'ok', str(held))
    edge = P.judge([1.30, 1.80], [1.80, 2.20], 1.00, 3.0)
    check('exactly 0.30 s still places the line', edge['placed'] and edge['delta'] == 0.3, str(edge))
    over = P.judge([1.31, 1.80], [1.80, 2.20], 1.00, 3.0)
    check('0.31 s does not place the line', (not over['placed']) and over['structure_ok'] and over['delta'] == 0.31, str(over))
    short = P.judge([1.0, 1.04, 1.08], [1.04, 1.08, 1.30], 1.0, 3.0)
    check('two short gaps fail structure', (not short['placed']) and short['structure'] == 'short', str(short))
    winner = P.first_placed([
        {'by': 'second', 'placed': True},
        {'by': 'stable-ts', 'placed': False},
        {'by': 'mms-window', 'placed': True},
    ])
    check('the earliest chain step wins', winner is not None and winner['by'] == 'mms-window', str(winner))
    check('stable-ts leaves MMS as a witness',
          P.witness_slots('stable-ts', 1.0, 2.0, 3.0) == (1.0, 'mms', 2.0, 'whisperx'))
    check('the second aligner leaves MMS and stable-ts as witnesses',
          P.witness_slots('second', 1.0, 2.0, 3.0) == (1.0, 'mms', 3.0, 'stable-ts'))
    check('an MMS window leaves the other two as witnesses',
          P.witness_slots('mms-ft', 1.0, 2.0, 3.0) == (2.0, 'whisperx', 3.0, 'stable-ts'))
    check('a phoneme placer is its own family', P.primary_family('phoneme') == 'phoneme')
    check('a phoneme placer leaves MMS and stable-ts as witnesses',
          P.witness_slots('phoneme', 1.0, 2.0, 3.0) == (1.0, 'mms', 3.0, 'stable-ts'))
    check('a phoneme placer uses the second clock when stable-ts is missing',
          P.witness_slots('phoneme', 1.0, 2.0, None) == (1.0, 'mms', 2.0, 'whisperx'))
    refute = {'both_agree': 0.10, 'both_far': 0.20, 'only_far': 0.30, 'attack_tol': 0.10}
    handed = {
        'id': 'h', 'placed_by': 'mms', 'cue_start': 1.0,
        'words': [
            {'t': 1.00, 'second': 1.25, 'third': 1.27, 'roman': 'aa', 'wi': 0,
             'clock_mms': 1.00, 'clock_second': 1.25, 'clock_stable': 1.27},
            {'t': 1.40, 'second': 1.70, 'third': 1.72, 'roman': 'bb', 'wi': 1,
             'clock_mms': 1.40, 'clock_second': 1.70, 'clock_stable': 1.72},
        ],
    }
    moved = P.handoff_proposal(handed, 3.0, np.zeros(0), refute)
    check('a refuted MMS line moves to stable-ts',
          moved is not None and moved['by'] == 'stable-ts'
          and abs(moved['starts'][0] - 1.27) < 1e-9 and abs(moved['starts'][1] - 1.72) < 1e-9,
          str(moved))
    stuck = {
        'id': 'stuck', 'placed_by': 'mms', 'cue_start': 1.0,
        'words': [
            {'t': 1.00, 'second': 1.25, 'third': 1.27, 'roman': 'aa', 'wi': 0,
             'clock_mms': 1.00, 'clock_second': 2.50, 'clock_stable': 2.40},
            {'t': 1.40, 'second': 1.70, 'third': 1.72, 'roman': 'bb', 'wi': 1,
             'clock_mms': 1.40, 'clock_second': 2.90, 'clock_stable': 2.80},
        ],
    }
    stayed = P.handoff_proposal(stuck, 3.0, np.zeros(0), refute)
    check('a line stays where it is when every later placer misses',
          stayed is None and stuck['words'][0]['t'] == 1.00, str(stayed))
    quiet = {
        'id': 'quiet', 'placed_by': 'mms', 'cue_start': 1.0,
        'words': [
            {'t': 1.00, 'second': 1.02, 'third': 1.04, 'roman': 'aa',
             'clock_mms': 1.00, 'clock_second': 1.20, 'clock_stable': 1.10},
            {'t': 1.40, 'second': 1.42, 'third': 1.44, 'roman': 'bb',
             'clock_mms': 1.40, 'clock_second': 1.60, 'clock_stable': 1.50},
        ],
    }
    check('a line that is not refuted is not handed on',
          P.handoff_proposal(quiet, 3.0, np.zeros(0), refute) is None)
    check('0.31 s does not let the phoneme aligner place a line',
          P.consider_phoneme_place([1.31, 1.80], 1.0, 3.0) is None)
    placed_phone = P.consider_phoneme_place([1.20, 1.70], 1.0, 3.0)
    check('a phoneme start inside 0.30 s can place an open line',
          placed_phone is not None and placed_phone['by'] == 'phoneme', str(placed_phone))
    cleared = {
        'placed': True, 'placed_by': 'mms',
        'words': [
            {'t': 1.0, 'wi': 0, 'roman': 'a', 'phones': {'xlsr-53-espeak': 9.0}, 'vowels': {'xlsr-53-espeak': 9.1}},
            {'t': 1.4, 'wi': 1, 'roman': 'b', 'phones': {'xlsr-53-espeak': 9.2}, 'vowels': {}},
        ],
    }
    wrote = A._write_placer(cleared, {
        'by': 'phoneme', 'starts': [1.1, 1.5], 'ends': [1.5, 1.9],
        'witnesses': [(1.0, 'mms', 1.2, 'stable-ts'), (1.4, 'mms', 1.55, 'stable-ts')],
    })
    check('a phoneme placer is not left as its own witness',
          wrote and cleared['placed_by'] == 'phoneme' and cleared['words'][0]['phones'] == {}
          and cleared['words'][0]['t'] == 1.1 and 'phoneme' not in cleared['words'][0],
          str(cleared['words'][0]))
    band = P.dispute_row('eckhart-f-02', 'de', 'choir', 1.0, 1.5, 1.52, 1.48, np.array([1.50]))
    check('three clocks within 0.10 s on an attack are a dispute',
          band is not None and band['agree'] and band['attack'] and abs(band['delta'] - 0.5) < 1e-9, str(band))
    off = P.dispute_row('x', 'de', 'choir', 1.0, 1.2, 1.2, 1.2, np.array([1.2]))
    check('0.20 s is outside the dispute band', off is None, str(off))
    quiet = P.dispute_row('x', 'de', 'choir', 1.0, 1.5, 1.52, 1.48, np.array([9.0]))
    check('agreement without an attack is not the listening row',
          quiet is not None and quiet['agree'] and not quiet['attack'], str(quiet))
    summary = P.summarize_unplaced([
        {'lang': 'de', 'mms_placed': False, 'mms_missing': True, 'stable_placed': True, 'stable_near': True,
         'stable_structure': False},
        {'lang': 'de', 'mms_placed': True},
        {'lang': 'de', 'mms_placed': False, 'mms_missing': False, 'mms_structure_ok': True, 'mms_delta': 0.44,
         'second_placed': False, 'second_near': True, 'second_structure': True},
    ])
    de = summary[0]
    check('unplaced lines split into no path and a far start',
          de['unplaced'] == 2 and de['missing'] == 1 and de['delta'] == 1 and de['stable_placed'] == 1
          and de['second_near'] == 1 and de['second_structure'] == 1, str(de))
    kept, skipped = P.fit_budget([(0.0, 200.0, ['big']), (300.0, 310.0, ['small'])], 720.0, rtf=4.0)
    check('a span past the budget is skipped and a later short one is kept',
          skipped == ['big'] and [ids for _a, _b, ids in kept] == [['small']], str((kept, skipped)))

    def grid(chance: float, proved: int, n: int) -> list[dict]:
        rows = []
        for i, share in enumerate(A.LINE_SHARES):
            rows.append({
                'k': share, 'chance': chance, 'proved': max(0, proved - i), 'candidates': n,
                'by_song': {'s': max(0, proved - i)}, 'shifts': {'0.15': chance},
            })
        return rows

    picked = A.choose_with_primaries({
        'mms': grid(0.01, 40, 40),
        'stable-ts': grid(0.20, 2, 4),
        'second': grid(0.0, 0, 0),
    })
    check('a placer over 5 % at every K is excluded',
          picked['within_limit'] and picked['k'] == 0.25 and picked['blocked_primaries'] == ['stable-ts']
          and picked['proved'] == 40, str({k: picked[k] for k in ('k', 'proved', 'blocked_primaries', 'within_limit', 'chance')}))
    names = {row['name']: row for row in picked['primaries']}
    check('the excluded placer keeps the chance that blocked it',
          names['stable-ts']['blocked'] and abs(float(names['stable-ts']['chance']) - 0.20) < 1e-12, str(names['stable-ts']))

    biased = Q.apply_rule_times(
        [{'second_s': 1.20, 'second_kind': 'mms'}, {'second_s': 1.20, 'second_kind': 'whisperx'}],
        'tr', {'bias': {'whisperx|tr': 0.05}, 'adopt': {}})
    check('a witness that is MMS is not shifted by the whisper bias', abs(biased[0]['second_s'] - 1.20) < 1e-12, str(biased[0]))
    check('a whisper witness still takes the bias', abs(biased[1]['second_s'] - 1.15) < 1e-12, str(biased[1]))

    line = {
        'id': 'l', 'placed': True, 'group': 'solo', 'lang': 'en', 'song': 's', 'placed_by': 'mms',
        'cue_start': 1.0, 'ctc_start': 1.0,
        'words': [
            {'t': 1.0, 'roman': 'ba', 'second': 1.0, 'third': 1.0, 'ctc_e': 1.2},
            {'t': 2.0, 'roman': 'ka', 'second': 2.0, 'third': 2.0, 'ctc_e': 2.2},
        ],
    }
    attacks = np.array([1.0, 2.0])
    modes = {('s', 'en'): 'one'}
    refute = {'both_agree': 0.10, 'both_far': 0.20, 'only_far': 0.30, 'attack_tol': 0.10}
    _hit, n_mms = A.line_pass_count([line], attacks, modes, refute, 1.0, primary='mms')
    _miss, n_stable = A.line_pass_count([line], attacks, modes, refute, 1.0, primary='stable-ts')
    check('line chance for one placer ignores the other', n_mms == 1 and n_stable == 0, f'{n_mms}/{n_stable}')

    _, sig = _bursts()
    sec = {'id': 's', 'kind': 'vocal', 'voice': 'Сами Юсуф', 'start': 0.0, 'end': 4.0}
    lyric = {'id': 'drift', 'lang': 'en', 'words': [{'w': 'a', 's': t, 'e': t + 0.1} for t in (1.0, 2.0, 3.0)]}
    rec = {
        'id': 'drift', 'status': 'good', 'text': 'a a a', 'placed_by': 'stable-ts', 'second': 'whisperx',
        'words': [{'w': 'a', 'roman': 'a', 'ctc_s': c, 'second_s': c, 'third_s': c, 'second_kind': 'mms'}
                  for c in (1.0, 2.0, 3.0)],
    }
    rule = {'name': 'line-0.25', 'tol': 0.10, 'choir_tol': 0.20, 'peak_height': 0.5,
            'require_rise': False, 'require_second': False, 'line_share': 0.25, 'scopes': [],
            'blocked_primaries': ['stable-ts']}
    blocked = Q.build_proof(sig, [(sec, lyric)], [{'verdict': 'ok'}], {'lines': [rec]},
                            {'drift': {'line': 'drift', 'start': 1.0, 'end': 3.2}}, word_rule=rule)
    row = blocked['lines'][0]
    check('an excluded placer is not proved', (not row['pass']) and row['reason'] == 'primary-chance', str(row))

    import align as Align
    import shutil

    from common import work_dir
    stray = work_dir('no-such-song-ft')
    unit = Align.Unit(
        0, {'id': 's', 'start': 0.0, 'end': 4.0, 'voice': ''},
        {'id': 'l1', 'words': [{'w': 'a', 's': 1.0, 'e': 1.2}]}, ['a'], {})
    try:
        missed = Align.rescue_ft(
            'no-such-song-ft', [unit], [{'placed_by': None, 'attempts': []}],
            {'l1': {'start': 1.0, 'end': 2.0}}, 10.0)
    finally:
        shutil.rmtree(stray, ignore_errors=True)
    check('a missing mix does not abort alignment',
          missed['ran'] is False and str(missed.get('error') or '').startswith('FileNotFoundError'),
          str(missed))
    text = A.render_md({
        'songs': ['s'],
        'current_chance': 0.2,
        'chosen': {
            'name': 'line-0.25', 'chance': 0.01, 'true_proved': 1, 'true_total': 2, 'line_share': 0.25,
            'refute': {'both_far': 0.2, 'only_far': 0.3, 'both_agree': 0.1, 'attack_tol': 0.1,
                       'refuted': 0, 'words': 4, 'rate': 0.0, 'witnesses': 0, 'attack': 0,
                       'within_cap': True, 'by': []},
            'primaries': [{'name': 'mms', 'candidates': 2, 'proved': 1, 'chance': 0.01, 'blocked': False}],
        },
        'scopes': [], 'refute_grid': [],
        'line_table': [{'k': 0.25, 'chance': 0.01, 'proved': 1, 'by_song': {'s': 1}}],
        'density': [],
        'candidates': [{'name': 'tol-0.10', 'tol': 0.1, 'peak_height': 0.5, 'require_rise': False,
                        'require_second': False, 'chance': 0.01, 'true_rate': 0.5}],
    })
    check('the word-rule grid still renders beside the line table', 'tol-0.10' in text and 'постановщик' in text, text[-180:])
    check('a start on the section boundary is inside', P.spans_inside([[180.31, 180.5], None], (138.48, 180.26)))
    check('a start 0.06 s past the section is outside', not P.spans_inside([[180.32, 180.5]], (138.48, 180.26)))
    check('no section does not reject a start', P.spans_inside([[200.0, 201.0]], None))
    held_section = P.judge([1.0, 1.5], [1.5, 2.0], 1.0, 3.0, (0.0, 4.0))
    check('a section that contains the starts still places the line', held_section['placed'], str(held_section))
    out_section = P.judge([10.06], [10.40], 10.0, None, (0.0, 10.0))
    check('judge rejects a start outside the section',
          (not out_section['placed']) and out_section['structure'] == 'outside-section', str(out_section))

    import align as Align

    past = Align._placement_attempt(
        'mms-window', [[180.91, 186.3]], ['nedir'], 180.91, None, (170.0, 187.0), (138.48, 180.26))
    check('the chain does not place a word that starts past its section',
          (not past['placed']) and past['structure'] == 'outside-section', str(past))
    boundary = Align._placement_attempt(
        'mms-window', [[180.31, 180.40]], ['kavga'], 180.31, None, (170.0, 181.0), (138.48, 180.26))
    check('the chain places a start exactly 0.05 s past the section end',
          boundary['placed'] and boundary['structure'] == 'ok', str(boundary))


def test_whisper_witness() -> None:
    import whisper_witness as W

    t = [0.0]

    def clock() -> float:
        return t[0]

    def advancing(elapsed: dict):
        def run(name, deadline):
            elapsed['calls'].append((name, deadline))
            info = elapsed['reply'](name, deadline)
            t[0] += float(info.get('elapsed_s') or 0.0)
            return info
        return run

    def finish(name, seconds):
        return {'model': name, 'complete': True, 'elapsed_s': seconds, 'ran': True, 'lines': 3, 'placed': 3}

    check('the ladder budget is ninety minutes', W.BUDGET_S == 90 * 60, str(W.BUDGET_S))

    # Run 39102852010, I Have Come Alive placed windows: small 261 s, medium 812 s,
    # large-v3-turbo 1308 s. 70 minutes does not start large-v3. 90 minutes does,
    # and the deadline slice is at least 30 minutes.
    measured = {'small': 261.0, 'medium': 812.0, 'large-v3-turbo': 1308.0, 'large-v3': 1600.0}

    def reply_measured(name, deadline):
        return finish(name, measured[name])

    t[0] = 0.0
    state = {'calls': [], 'reply': reply_measured}
    chosen, rows = W.ladder(advancing(state), budget_s=70 * 60, clock=clock)
    check('seventy minutes skips large-v3 after the measured times',
          chosen == 'large-v3-turbo' and any(r.get('model') == 'large-v3' and r.get('reason') == 'budget' for r in rows),
          str([(r.get('model'), r.get('reason')) for r in rows]))

    t[0] = 0.0
    state = {'calls': [], 'reply': reply_measured}
    chosen, _rows = W.ladder(advancing(state), budget_s=90 * 60, clock=clock)
    large_deadline = [dl for name, dl in state['calls'] if name == 'large-v3']
    used = 261.0 + 812.0 + 1308.0
    slice_s = (large_deadline[0] - used) if large_deadline and large_deadline[0] is not None else 0.0
    check('ninety minutes starts large-v3 with at least thirty minutes',
          chosen == 'large-v3' and slice_s >= 30 * 60, str(slice_s))

    # All four finish inside a wide budget. The ladder still returns the largest
    # finished model: that name places lines still open. It does not appoint the proof witness.
    t[0] = 0.0
    state = {'calls': [], 'reply': lambda name, deadline: finish(name, 10.0)}
    chosen, rows = W.ladder(advancing(state), budget_s=100000.0, clock=clock)
    check('the largest finished model places lines still open', chosen == 'large-v3' and len(rows) == 4, str([r['model'] for r in rows]))

    # Medium takes most of the budget, so the larger estimates do not fit.
    t[0] = 0.0
    state = {'calls': [], 'reply': lambda name, deadline: finish(name, 1000.0 if name == 'medium' else 10.0)}
    chosen, rows = W.ladder(advancing(state), budget_s=1600.0, clock=clock)
    names = [r['model'] for r in rows]
    skipped = [r for r in rows if r.get('reason') == 'budget']
    check('a model whose estimate exceeds the budget is skipped',
          chosen == 'medium' and [r['model'] for r in skipped] == ['large-v3-turbo', 'large-v3']
          and [name for name, _dl in state['calls']] == ['small', 'medium'], str(names))

    # An unfinished larger model does not replace the last one that finished, and a bigger one is not started.
    t[0] = 0.0
    def reply(name, deadline):
        if name == 'large-v3-turbo':
            return {'model': name, 'complete': False, 'elapsed_s': 30.0, 'ran': True, 'stopped': True}
        return finish(name, 10.0)
    state = {'calls': [], 'reply': reply}
    chosen, rows = W.ladder(advancing(state), budget_s=100000.0, clock=clock)
    check('an unfinished model does not replace the last finished one',
          chosen == 'medium' and 'large-v3' not in [name for name, _dl in state['calls']], str(chosen))

    # Medium itself did not finish: small remains, and nothing larger is tried.
    t[0] = 1000.0
    seen = []

    def run_medium(name, deadline):
        seen.append((name, deadline))
        if name == 'medium':
            return {'model': name, 'complete': False, 'elapsed_s': 5.0, 'ran': True, 'stopped': True}
        return finish(name, 5.0)

    chosen, _rows = W.ladder(run_medium, budget_s=4200.0, clock=clock)
    check('medium that does not finish leaves small',
          chosen == 'small' and seen[0] == ('small', None) and seen[1][1] == 5200.0 and len(seen) == 2, str(seen))

    stats = W.agreement([
        {'lang': 'az', 'deltas': [0.02, 0.04, 0.20, 0.05, 0.01, 0.03, 0.08, 0.09], 'cue_delta': 0.10},
        {'lang': 'la', 'deltas': [0.01, 0.02], 'cue_delta': 0.20},
        {'lang': 'de', 'deltas': [0.40] * 8, 'cue_delta': 0.50},
    ])
    check('eight close words read as a working witness', stats['by_lang']['az']['reading'] == 'рабочий', str(stats['by_lang']['az']))
    check('two words are too few to call', stats['by_lang']['la']['reading'] == 'мало слов', str(stats['by_lang']['la']))
    check('a far median is not a working witness', stats['by_lang']['de']['reading'] == 'не рабочий', str(stats['by_lang']['de']))

    def refuted(**kw):
        base = {
            'i': 1, 'n': 3, 'prev_span': 1.2, 'prev_roman': 'aa',
            'why': 'witnesses-agree-elsewhere', 'd2': 0.40, 'd3': 0.45,
            'second': 1.4, 'third': 1.45, 'second_kind': 'whisperx', 'third_kind': 'stable-ts',
        }
        base.update(kw)
        return W.annotate(base)

    mid = refuted()
    check('a middle word after a long hold is a melisma',
          mid['position'] == 'середина' and mid['after'] == 'мелизм' and mid['shared'] is not None and mid['shared'] > 0, str(mid))
    first = W.annotate({'i': 0, 'n': 3, 'prev_span': None, 'prev_roman': None, 'why': 'witness-attack',
                        'd2': 0.50, 'd3': None, 'second': 1.5, 'third': None, 'second_kind': 'whisperx'})
    check('a first word with one clock has no shared shift',
          first['position'] == 'первое' and first['after'] == 'нет' and first['shared'] is None and first['side'] == 'whisperx', str(first))
    last = W.annotate({'i': 2, 'n': 3, 'prev_span': 0.50, 'prev_roman': 'ab', 'why': 'witnesses-agree-elsewhere',
                       'd2': 0.20, 'd3': 0.22, 'second': 2.0, 'third': 2.02})
    check('a vowel onset of half a second is a long vowel', last['position'] == 'последнее' and last['after'] == 'долгая гласная', str(last))
    only = W.annotate({'i': 0, 'n': 1, 'prev_span': None, 'prev_roman': None, 'why': 'witness-attack', 'd2': None, 'd3': 0.4, 'second': None, 'third': 1.4})
    check('a one-word line is marked as the only word', only['position'] == 'единственное', str(only))
    apart = W.shared_shift(0.40, 0.55)
    check('witnesses more than 0.10 s apart do not share a shift', apart is None, str(apart))

    systematic = [refuted() for _ in range(3)] + [
        refuted(d2=-0.40, d3=-0.42, prev_span=0.10, prev_roman='ba') for _ in range(2)]
    check('a shared later shift after a melisma is reported', 'мелизма' in W.conclusion(systematic), W.conclusion(systematic))
    mixed = [refuted() for _ in range(2)] + [refuted(d2=-0.40, d3=-0.45) for _ in range(3)]
    check('a split shift is not called a cause', 'не видно' in W.conclusion(mixed), W.conclusion(mixed))
    table = W.render_refutation([refuted(song='karitas', id='fuzuli-f8-1', time=180.91, w='nedir.', placed_by='mms-window')], 0.20, 0.30)
    check('the listening table keeps the word and the time', 'nedir.' in table and '3:00,91' in table and '0,20' in table, table[:240])

    import engines
    starts, info = engines.align_stable(
        np.zeros(800, dtype=np.float32),
        [{'id': 'a', 'lang': 'en', 'words': ['hi'], 't0': 0.0, 't1': 0.5}],
        'not-a-whisper-model')
    check('a missing whisper model does not abort alignment',
          starts == {} and info['complete'] is False and bool(info.get('error')), str(info.get('error')))


def _shift_row(ctc: float, second, third) -> dict:
    return {'ctc': ctc, 'second': second, 'third': third}


def test_whisper_choice() -> None:
    import attack_chance as A
    import placement as P
    import whisper_choice as C
    import whisper_witness as W

    early = _shift_row(1.0, 0.90, 0.92)
    late = _shift_row(1.0, 1.10, 1.12)
    split = W.window_shift([early] * 4 + [late] * 4)
    check('an early first half does not confirm a late second half',
          (not split['confirmed']) and split['first']['early'] == 4 and split['second']['early'] == 0
          and split['first']['n'] == 4 and split['second']['n'] == 4, str(split))
    held = W.window_shift([early] * 6)
    check('both halves early confirm the window shift',
          held['confirmed'] and held['first']['early'] == 3 and held['second']['early'] == 3, str(held))
    missing = W.window_shift([_shift_row(1.0, None, 0.9), early, early])
    check('a missing witness clock is left out of the split',
          missing['missing_clock'] == 1 and missing['both_clocks'] == 2, str(missing))

    def raw_word(t, roman, models, second=None, stable=None, mms=None):
        return {
            'w': roman, 'roman': roman, 's': t, 'e': t + 0.3,
            'ctc_s': t, 'ctc_e': t + 0.3,
            'clock_mms': t if mms is None else mms, 'clock_second': second, 'clock_stable': stable,
            'stable_models': dict(models),
        }

    applied = {
        'summary': {'placement_model': 'medium', 'stable_model': 'medium'},
        'lines': [
            {
                'id': 'mms-line', 'lang': 'ar', 'status': 'good', 'placed_by': 'mms', 'group': 'solo',
                'cue_start': 1.0, 'ctc_start': 1.0,
                'words': [raw_word(1.0, 'ba', {'medium': 8.0, 'small': 1.0}, second=1.5, stable=9.0)],
            },
            {
                'id': 'stable-line', 'lang': 'en', 'status': 'good', 'placed_by': 'stable-ts', 'group': 'solo',
                'cue_start': 2.0, 'ctc_start': 2.0,
                'words': [raw_word(2.0, 'ka', {'medium': 4.0}, second=2.0, stable=3.0, mms=1.0)],
            },
            {
                'id': 'kept', 'lang': 'ar', 'status': 'good', 'placed_by': 'mms', 'group': 'solo',
                'cue_start': 3.0, 'ctc_start': 3.0,
                'words': [raw_word(3.0, 'da', {}, second=None, stable=5.5)],
            },
        ],
    }
    C.apply_models(applied, {'ar': 'medium', 'en': 'medium'})
    mms_word = applied['lines'][0]['words'][0]
    stable_word = applied['lines'][1]['words'][0]
    kept_word = applied['lines'][2]['words'][0]
    check('an MMS line takes the chosen model as the stable witness',
          mms_word['third_s'] == 8.0 and mms_word['second_s'] == 1.5 and mms_word['w'] == 'ba', str(mms_word))
    check('a stable-ts line keeps the whisper slot and does not publish the stable clock there',
          stable_word['clock_stable'] == 4.0 and stable_word['third_s'] == 2.0 and stable_word['second_s'] == 1.0,
          str(stable_word))
    check('a word measured only by the placement model keeps that clock',
          kept_word['clock_stable'] == 5.5, str(kept_word))
    C.apply_models(applied, {'ar': 'small', 'en': 'small'})
    check('a model with no saved time leaves no stable clock',
          applied['lines'][1]['words'][0]['clock_stable'] is None, str(applied['lines'][1]['words'][0]['clock_stable']))
    absent = {
        'summary': {'placement_model': 'large-v3'},
        'lines': [{
            'id': 'open', 'lang': 'ar', 'status': 'good', 'placed_by': 'second', 'group': 'solo',
            'words': [raw_word(312.074, 'qad', {'large-v3': 311.49}, second=312.074, stable=311.49, mms=312.64)],
        }],
    }
    C.apply_models(absent, {'ar': 'large-v3-turbo'})
    kept_open = absent['lines'][0]['words'][0]
    import qa_sync as QS
    wiped = {'ctc_s': 312.074, 'second_s': 312.64, 'third_s': None}
    check('the search does not inherit the placement clock',
          kept_open['clock_stable'] is None and kept_open['third_s'] is None
          and kept_open['stable_models'] == {'large-v3': 311.49}, str(kept_open))
    filled_clock = P.placed_clock_for_gap(
        'second', kept_open['stable_models'], 'large-v3-turbo', 'large-v3', kept_open['third_s'])
    filled = {'ctc_s': 312.074, 'second_s': 312.64, 'third_s': filled_clock}
    refute = {'both_agree': 0.10, 'both_far': 0.20, 'only_far': 0.30, 'attack_tol': 0.10}
    check('the empty slot can take the placement clock without a one-witness refutation',
          filled_clock == 311.49
          and QS.word_refuted(wiped, np.array([312.64]), refute) == 'witness-attack'
          and QS.word_refuted(filled, np.array([312.64]), refute) is None,
          str(filled))
    check('an existing third witness is not replaced by the placement clock',
          P.placed_clock_for_gap('second', {'large-v3': 311.49}, 'large-v3-turbo', 'large-v3', 312.0) is None)
    check('a measured chosen model is not replaced by the placement clock',
          P.placed_clock_for_gap(
              'second', {'large-v3-turbo': 311.2, 'large-v3': 311.49}, 'large-v3-turbo', 'large-v3', None) is None)
    check('a stable-ts line does not borrow the placement clock into the whisper slot',
          P.placed_clock_for_gap('stable-ts', {'large-v3': 311.49}, 'large-v3-turbo', 'large-v3', None) is None)
    gap_song = {
        'slug': 's', 'placement_model': 'large-v3', 'proof_models': {'ar': 'large-v3-turbo'},
        'all_lines': [{
            'id': 'open', 'lang': 'ar', 'placed_by': 'second',
            'words': [{
                'third': None, 'third_kind': 'stable-ts', 'clock_stable': None,
                'second': 312.64, 'second_kind': 'mms', 'stable_models': {'large-v3': 311.49},
            }],
        }],
    }
    saved, n_filled = A._fill_placed_clocks([gap_song])
    gap_word = gap_song['all_lines'][0]['words'][0]
    check('the join fills only the empty stable slot',
          n_filled == 1 and gap_word['third'] == 311.49 and gap_word['second'] == 312.64, str(gap_word))
    A._unfill_placed_clocks(saved)
    check('the placement-clock fill restores the empty slot',
          gap_word['third'] is None and gap_word['clock_stable'] is None, str(gap_word))
    report_word = dict(absent['lines'][0]['words'][0])
    check('qa stamps the same empty slot',
          P.stamp_placed_clock([report_word], 'second', 'large-v3-turbo', 'large-v3') == 1
          and report_word['third_s'] == 311.49 and report_word['clock_stable'] == 311.49,
          str(report_word))

    hits = np.zeros((3, len(A.LINE_SHARES), 8), dtype=np.int32)
    cand = np.array([10, 0, 0], dtype=np.int32)
    hits[0, :, 0] = 8
    hits[0, :, 1:] = 2
    blocked = C.decide_lines(hits, cand)
    check('a placer over 5 % at every share is not a passing K',
          (not blocked['ok']) and blocked['proved'] == 0, str(blocked))
    hits[0, :, 1:] = 0
    opened = C.decide_lines(hits, cand)
    check('zero probes keep the smallest share and the real lines',
          opened['ok'] and opened['k'] == A.LINE_SHARES[0] and opened['proved'] == 8, str(opened))

    def pair_word(t, roman, small_t, medium_t):
        return raw_word(t, roman, {'small': small_t, 'medium': medium_t}, second=None, stable=medium_t)

    report = {
        'slug': 's',
        'summary': {'placement_model': 'medium', 'stable_model': 'medium'},
        'lines': [
            {
                'id': 'ar-line', 'lang': 'ar', 'status': 'good', 'placed_by': 'mms', 'group': 'solo',
                'cue_start': 10.0, 'ctc_start': 10.0,
                'words': [pair_word(10.0, 'ba', 10.0, 30.0), pair_word(11.0, 'ka', 11.0, 31.0)],
            },
            {
                'id': 'en-line', 'lang': 'en', 'status': 'good', 'placed_by': 'mms', 'group': 'solo',
                'cue_start': 50.0, 'ctc_start': 50.0,
                'words': [pair_word(50.0, 'da', 80.0, 50.0), pair_word(51.0, 'ga', 81.0, 51.0)],
            },
        ],
    }
    peaks = np.array([10.0, 11.0, 50.0, 51.0])
    result = C.choose(['s'], {'s': report}, {'s': peaks}, {}, {})
    assignment = result['assignment']['s']
    check('each language takes the model that proves its line',
          assignment.get('ar') == 'small' and assignment.get('en') == 'medium'
          and result['decision']['ok'] and result['decision']['proved'] == 2,
          str(assignment) + ' ' + str(result['decision'].get('proved')))
    ar_third = report['lines'][0]['words'][0]['third_s']
    en_third = report['lines'][1]['words'][0]['third_s']
    check('the rewritten witness is that model’s clock',
          ar_third == 10.0 and en_third == 50.0, f'{ar_third}, {en_third}')


def test_phoneme() -> None:
    import inspect

    import attack_chance as A
    import phoneme
    import phoneme_choice as Phone

    check('medieval German is not spoken with the modern German voice', phoneme.voice_for('gmh') is None)
    check('ottoman Turkish is not spoken with the modern Turkish voice', phoneme.voice_for('ota') is None)
    check('German keeps its own espeak voice', phoneme.voice_for('de') == 'de')
    check('Latin keeps its own espeak voice', phoneme.voice_for('la') == 'la')
    ids = ' '.join(spec['id'] for spec in phoneme.MODELS)
    check('the phoneme models are not MMS adapters', 'mms' not in ids)
    check('both phoneme models are Apache-2.0', all(spec['license'] == 'Apache-2.0' for spec in phoneme.MODELS))
    check('MMS adapters are rejected in writing', 'не измерялись' in phoneme.MMS_REJECTION)
    src = inspect.getsource(phoneme._espeak)
    argv = next(line for line in src.splitlines() if '--sep=_' in line and 'espeak-ng' in line and line.strip().startswith('['))
    check('espeak separates phones with --sep=_', '--ipa' in argv and '--ipa=3' not in argv, argv.strip())

    vocab = {'<pad>': 0, '<s>': 1, '</s>': 2, '<unk>': 3, 'h': 4, 'a': 5, 'l': 6, 'o': 7, 'aɪ': 8}
    ids_sep, names, skipped = phoneme.tokenize('h_a_l_o', vocab)
    ids_greedy, names_g, skipped_g = phoneme.tokenize('halo', vocab)
    check('underscore and greedy IPA agree', ids_sep == [4, 5, 6, 7] and ids_sep == ids_greedy and skipped == 0 and skipped_g == 0,
          str((ids_sep, ids_greedy)))
    check('a diphthong is one phone', phoneme.tokenize('haɪ', vocab)[0] == [4, 8])
    ids_skip, _names, skipped = phoneme.tokenize('h_zz', vocab)
    check('an unknown phone is skipped', ids_skip == [4] and skipped == 1, str((ids_skip, skipped)))
    ids_stress, _names, skipped = phoneme.tokenize('h_ˈa', vocab)
    check('stress marks are not phones', ids_stress == [4, 5] and skipped == 0, str(ids_stress))
    check('special tokens are not phones', phoneme.tokenize('<pad>_a', vocab)[0] == [5])
    check('a placed solo line is eligible', phoneme._eligible({'status': 'good', 'group': 'solo'}))
    check('a weak line is not eligible', not phoneme._eligible({'status': 'weak', 'group': 'solo'}))
    check('a line outside solo and choir is not eligible', not phoneme._eligible({'status': 'good', 'group': 'other'}))
    check('an open Latin solo line can be placed', phoneme._latin_open({'lang': 'la', 'status': 'weak', 'group': 'solo'}))
    check('an open Latin choir line can be placed', phoneme._latin_open({'lang': 'la', 'status': 'draft', 'group': 'choir'}))
    check('a placed Latin line is not placed again', not phoneme._latin_open({'lang': 'la', 'status': 'good', 'group': 'solo'}))
    check('a weak line in another language is not the Latin placer',
          not phoneme._latin_open({'lang': 'de', 'status': 'weak', 'group': 'solo'}))
    t0, t1 = phoneme._window({'second_window': [1.0, 1.1]}, 10.0)
    check('a short window is at least 0.4 s', t1 - t0 >= 0.4 - 1e-9, str((t0, t1)))

    saved = phoneme.espeak_available
    phoneme.espeak_available = lambda: False
    try:
        report = {'summary': {}, 'lines': [{'id': 'a', 'status': 'good', 'group': 'solo', 'lang': 'la', 'words': []}]}
        phoneme.measure(np.zeros(1600, dtype=np.float32), report, budget_s_value=30)
    finally:
        phoneme.espeak_available = saved
    models = report['summary']['phoneme']['models']
    check('a missing espeak binary measures nothing',
          len(models) == 2 and all(not row['complete'] and not row['ran'] and row['error'] == 'espeak-ng не найден' for row in models),
          str(models))

    only = [{'roman': 'ba', 'ctc_s': 1.0, 'second_s': 5.0, 'third_s': 5.2, 'phoneme_s': 1.02, 'phoneme_role': 'only'}]
    got = Q.prove_words(only, [0.02], 0.10, witnesses='one')
    check('role only proves from the phoneme start', got[0]['path'] == 'witness-phoneme', str(got[0]))
    rescued = [{'roman': 'ba', 'ctc_s': 1.0, 'second_s': 1.5, 'third_s': 1.6, 'phoneme_s': 1.02, 'phoneme_role': 'or'}]
    got = Q.prove_words(rescued, [0.02], 0.10, witnesses='two')
    check('role or proves when both legacy clocks miss and the phoneme agrees', got[0]['path'] == 'witness-phoneme', str(got[0]))
    already = [{'roman': 'ba', 'ctc_s': 1.0, 'second_s': 1.05, 'third_s': 1.08, 'phoneme_s': 1.02, 'phoneme_role': 'or'}]
    got = Q.prove_words(already, [0.02], 0.10, witnesses='two')
    check('role or keeps the legacy path when the clocks already agree', got[0]['path'] == 'witness-both', str(got[0]))
    missing = [{'roman': 'ba', 'ctc_s': 1.0, 'second_s': 5.0, 'third_s': 5.2, 'phoneme_role': 'only'}]
    got = Q.prove_words(missing, [0.02], 0.10, witnesses='one')
    check('a missing phoneme clock is not a refutation', got[0]['path'] == 'fail' and got[0]['reason'] == 'no-phoneme', str(got[0]))
    untouched = [{'roman': 'ba', 'ctc_s': 1.0, 'second_s': 1.05, 'third_s': 1.40}]
    got = Q.prove_words(untouched, [0.02], 0.10, witnesses='two')
    check('two of three still needs both clocks when the phoneme role is off', got[0]['path'] == 'fail', str(got[0]))

    refute = {'both_agree': 0.10, 'both_far': 0.20, 'only_far': 0.30, 'attack_tol': 0.10}
    both_far = {'ctc_s': 1.0, 'second_s': 1.40, 'third_s': 1.45, 'phoneme_s': 1.0}
    check('a phoneme clock does not cancel a refutation',
          Q.word_refuted(both_far, np.array([1.40]), refute) == 'witnesses-agree-elsewhere')
    check('a phoneme clock alone does not refute',
          Q.word_refuted({'ctc_s': 1.0, 'phoneme_s': 5.0}, np.array([5.0]), refute) is None)

    rule = {'tol': 0.10, 'choir_tol': 0.20, 'agree_tol': 0.10, 'witnesses': 'two'}
    peaks = np.arange(0.0, 3.0, 0.05)
    legacy = [{'t': 1.0, 'group': 'solo', 'second': 1.0, 'third': 1.0, 'line': 'a', 'roman': 'ba'}]
    stamped = [dict(legacy[0], phoneme=9.0, phoneme_role='off')]
    check('an off role matches the legacy mask',
          A.hit_rate(legacy, peaks, 0.0, rule) == A.hit_rate(stamped, peaks, 0.0, rule) == 1.0)
    only_far = [dict(legacy[0], second=9.0, third=9.0, phoneme=9.0, phoneme_role='only')]
    check('role only fails when the phoneme clock is far', A.hit_rate(only_far, peaks, 0.0, rule) == 0.0)
    only_near = [dict(legacy[0], second=9.0, third=9.0, phoneme=1.0, phoneme_role='only')]
    check('role only passes on its own clock', A.hit_rate(only_near, peaks, 0.0, rule) == 1.0)
    rescued_probe = [dict(legacy[0], second=9.0, third=9.0, phoneme=1.0, phoneme_role='or')]
    check('role or with two required clocks passes on the phoneme', A.hit_rate(rescued_probe, peaks, 0.0, rule) == 1.0)
    check('a shifted probe leaves the phoneme clock where it was', A.hit_rate(rescued_probe, peaks, 0.15, rule) == 0.0)

    check('a role over 15 % is not allowed', Phone.allowed_roles({'or': 0.16, 'only': 0.10}) == ['off', 'only'])
    check('a missing chance stays off', Phone.allowed_roles({'or': None, 'only': None}) == ['off'])
    check('fewer than 30 choir words cannot adopt a feature', not Phone.choir_ok(29, 0.01, 0.01, 5, 1, True))
    check('a choir word chance over 15 % is refused', not Phone.choir_ok(40, 0.20, 0.01, 5, 1, True))
    check('a choir line chance over 5 % is refused', not Phone.choir_ok(40, 0.01, 0.06, 5, 1, True))
    check('a choir feature that does not prove more lines is refused', not Phone.choir_ok(40, 0.01, 0.01, 1, 1, True))
    check('a choir feature that changes solo lines is refused', not Phone.choir_ok(40, 0.01, 0.01, 5, 1, False))
    check('a choir feature inside both caps can be adopted', Phone.choir_ok(40, 0.01, 0.01, 5, 1, True))

    def bits(real: bool, shifted: bool = False) -> np.ndarray:
        grid = np.zeros((len(A.LINE_SHARES), 8), dtype=bool)
        grid[:, 0] = real
        if shifted:
            grid[:, 1] = True
            grid[:, 2] = True
        return grid

    def row(pass_off, pass_only) -> dict:
        return {
            'id': 'l', 'song': 's', 'lang': 'la', 'group': 'solo', 'family': 'mms', 'long': True,
            'pass': {'base': {'off': pass_off, 'only': pass_only}},
        }

    admitted = Phone.select({('s', 'la'): ['off', 'only']}, [row(bits(False), bits(True))], 'base')
    check('a phoneme role is admitted when the shifts do not pass',
          admitted['within_limit'] and admitted['assignment'][('s', 'la')] == 'only' and admitted['proved'] == 1,
          str(admitted['assignment']) + ' ' + str(admitted['proved']))
    refused = Phone.select({('s', 'la'): ['off', 'only']}, [row(bits(False), bits(True, True))], 'base')
    check('a phoneme role whose shift also passes stays off',
          refused['assignment'][('s', 'la')] == 'off' and refused['proved'] == 0 and refused['within_limit'],
          str(refused))

    word = {'phones': {'m': 1.0}, 'vowels': {'m': 1.5}}
    solo = {'phones': {'m': 2.0}, 'vowels': {'m': 2.5}}
    song = {'slug': 's', 'use_choir_envelope': False, 'all_lines': [
        {'lang': 'la', 'group': 'choir', 'words': [word]},
        {'lang': 'la', 'group': 'solo', 'words': [solo]},
    ]}
    decision = {
        'long': [['s', 'la']],
        'pairs': [{'song': 's', 'lang': 'la', 'role': 'only', 'model': 'm', 'word_chance': 0.04}],
        'choir_clock': 'vowel', 'choir_attack': 'envelope', 'kept': True,
    }
    Phone.apply([song], decision)
    check('choir vowel nucleus replaces the phone start', word.get('phoneme') == 1.5 and word.get('phoneme_role') == 'only')
    check('a solo line keeps the phone start', solo.get('phoneme') == 2.0)
    check('the choir envelope flag is stamped', song.get('use_choir_envelope') is True)
    Phone.clear([song])
    check('clear removes the stamp', 'phoneme' not in word and 'phoneme_role' not in solo and song.get('use_choir_envelope') is False)

    scopes = [
        {'song': 'k', 'lang': 'la', 'witnesses': 'one'},
        {'song': 'k', 'lang': 'xx', 'witnesses': 'one'},
        {'song': 'k', 'lang': '*', 'witnesses': 'one'},
    ]
    kept = {
        'kept': True,
        'long': [['k', 'la']],
        'pairs': [
            {'song': 'k', 'lang': 'la', 'role': 'only', 'model': 'xlsr-53-espeak', 'word_chance': 0.04},
            {'song': 'k', 'lang': '*', 'role': 'or', 'model': 'xlsr-53-espeak', 'word_chance': 0.02},
        ],
    }
    A._stamp_phoneme_scopes(scopes, kept)
    by = {row['lang']: row for row in scopes}
    check('a long language keeps its own role', by['la']['phoneme'] == 'only' and by['la']['phoneme_model'] == 'xlsr-53-espeak')
    check('a short language inherits the song role', by['xx']['phoneme'] == 'or' and abs(by['xx']['phoneme_chance'] - 0.02) < 1e-12,
          str(by['xx']))
    A._stamp_phoneme_scopes(scopes, dict(kept, kept=False))
    check('a rejected stamp leaves every scope off', all(row['phoneme'] == 'off' and row['phoneme_model'] is None for row in scopes))
    lookup = {'scopes': [
        {'song': 'k', 'lang': 'az', 'phoneme': 'off', 'phoneme_model': None},
        {'song': 'k', 'lang': '*', 'phoneme': 'only', 'phoneme_model': 'xlsr-53-espeak'},
    ]}
    check('an explicit off on a language wins over the song row', Q.phoneme_for(lookup, 'k', 'az') == ('off', None))
    check('a missing language uses the song row', Q.phoneme_for(lookup, 'k', 'fa') == ('only', 'xlsr-53-espeak'))

    rise = np.array([0.0, 0.0, 1.0, 0.0, 0.0])
    peaks = Q.onset_peak_times(None, min_height=0.7, curve=rise)
    check('an envelope curve peaks on its own', len(peaks) == 1 and abs(float(peaks[0]) - 0.02) < 1e-9, str(peaks))

    spectral = np.array([1.50])
    envelope = np.array([1.05])
    check('a spectral gap of 0.40 s stays without the fill',
          abs(Q.nearest_attack(1.10, spectral, None) - 0.40) < 1e-9)
    filled = Q.fill_attack(1.10, spectral, envelope, None, 0.10)
    check('the envelope fills a spectral gap outside 0.10 s', filled is not None and abs(filled - (1.05 - 1.10)) < 1e-9, str(filled))
    kept_dt = Q.fill_attack(1.46, spectral, envelope, None, 0.10)
    check('a spectral peak inside 0.10 s is kept', kept_dt is not None and abs(kept_dt - (1.50 - 1.46)) < 1e-9, str(kept_dt))
    far = Q.fill_attack(1.10, spectral, np.array([2.00]), None, 0.10)
    check('a far envelope leaves the spectral gap', far is not None and abs(far - 0.40) < 1e-9, str(far))
    alone = Q.fill_attack(1.10, spectral, None, None, 0.10)
    check('no envelope leaves the spectral gap', alone is not None and abs(alone - 0.40) < 1e-9, str(alone))
    empty_fill = Q.fill_attack(1.10, np.zeros(0), envelope, None, 0.10)
    check('an empty spectral list can use the envelope',
          empty_fill is not None and abs(empty_fill - (1.05 - 1.10)) < 1e-9, str(empty_fill))
    probe_word = {
        't': 1.10, 'roman': 'am', 'ctc_e': 1.40,
        'second': 1.10, 'third': 1.12, 'group': 'solo',
    }
    probe_refute = {'both_agree': 0.10, 'both_far': 0.20, 'only_far': 0.30, 'attack_tol': 0.10}
    bare, bare_flags = A._probe_parts([probe_word], spectral, 'solo', 'one', probe_refute, None)
    check('without the fill the word is not proved', bare[0]['path'] == 'fail' and not bare_flags[0], str(bare[0]))
    filled_words, filled_flags = A._probe_parts(
        [probe_word], spectral, 'solo', 'one', probe_refute, None, fill_peaks=envelope)
    check('the fill proves the word and does not refute it',
          filled_words[0]['path'] != 'fail' and not filled_flags[0], str(filled_words[0]['path']))
    check('a word chance over 15 % refuses the fill', not A.fill_ok(40, 0.16, True, 5, 1))
    check('a line chance over 5 % refuses the fill', not A.fill_ok(40, 0.01, False, 5, 1))
    check('a fill that does not prove more lines is refused', not A.fill_ok(40, 0.01, True, 4, 4))
    check('a fill inside both caps can be kept', A.fill_ok(40, 0.01, True, 5, 4))
    check('fewer than 30 words cannot adopt the fill', not A.fill_ok(29, 0.01, True, 5, 1))

    def scan_attack(t, peak_times, owned):
        usable = peak_times
        if owned is not None and len(peak_times):
            usable = peak_times[peak_times > owned]
        if len(usable) == 0:
            return None
        return float(usable[int(np.argmin(np.abs(usable - t)))] - t)

    tied = np.array([0.0, 1.0, 2.0])
    check('an equal gap keeps the earlier peak', Q.nearest_attack(0.5, tied, None) == scan_attack(0.5, tied, None) == -0.5)
    check('a peak at or before owned is not usable', Q.nearest_attack(0.5, tied, 0.0) == 0.5)
    check('no peak after owned has no attack', Q.nearest_attack(0.5, tied, 2.0) is None)
    check('an empty peak list has no attack', Q.nearest_attack(0.5, np.zeros(0), None) is None)
    rng = np.random.default_rng(20261020)
    cloud = np.sort(rng.uniform(0.0, 80.0, 400))
    owned_values = [None, 0.0, 1.25, 40.0, 79.9, 80.0]
    mismatches = 0
    for t in list(cloud[::17]) + [-1.0, 0.0, 80.0, 90.0]:
        for owned in owned_values:
            got = Q.nearest_attack(float(t), cloud, owned)
            ref = scan_attack(float(t), cloud, owned)
            if got != ref and not (got is None and ref is None):
                mismatches += 1
    check('sorted nearest-attack matches the filtered scan', mismatches == 0, str(mismatches))
    near_miss = 0
    for t in rng.uniform(-1.0, 81.0, 80):
        for tol in (0.0, 0.04, 0.10, 0.5):
            got = Q._peak_near(float(t), cloud, tol)
            ref = bool(np.min(np.abs(cloud - float(t))) <= tol + 1e-12)
            if got != ref:
                near_miss += 1
    check('a sorted peak neighbourhood matches the full scan', near_miss == 0, str(near_miss))
    check('no peaks are not near', Q._peak_near(1.0, np.zeros(0), 0.1) is False)
    check('missing peaks are not near', Q._peak_near(1.0, None, 0.1) is False)

    def slow_select(pair_roles, line_rows, variant='base'):
        assignments, how = Phone._assignments(pair_roles)
        if how != 'exact':
            raise AssertionError(how)
        best = None
        best_rank = None
        for assignment in assignments:
            picked = Phone._score(assignment, line_rows, variant)
            if not picked.get('within_limit'):
                continue
            rank = Phone._rank(picked, assignment)
            if best_rank is None or rank > best_rank:
                best_rank = rank
                best = (dict(assignment), picked)
        if best is None:
            assignment = {key: 'off' for key in pair_roles}
            picked = Phone._score(assignment, line_rows, variant)
            return assignment, picked, False
        return best[0], best[1], True

    def agree(pair_roles, line_rows, label):
        got = Phone.select(pair_roles, line_rows, 'base')
        assignment, picked, within = slow_select(pair_roles, line_rows, 'base')
        same = all(got['assignment'].get(key, 'off') == assignment.get(key, 'off') for key in pair_roles)
        within_ok = bool(got['within_limit']) == bool(within and picked.get('within_limit'))
        count = int(got.get('count_proved', got['proved']))
        proved_ok = int(got['proved']) == int(picked.get('proved') or 0) and count == int(picked.get('proved') or 0)
        chance_ok = got.get('chance') == picked.get('chance')
        k_ok = got.get('k') == picked.get('k')
        check(label, same and within_ok and proved_ok and chance_ok and k_ok,
              str((got['assignment'], assignment, got['proved'], picked.get('proved'), got.get('chance'), picked.get('chance'), got.get('k'), picked.get('k'))))

    blank = np.zeros((len(A.LINE_SHARES), 8), dtype=bool)
    proved_only = blank.copy()
    proved_only[:, 0] = True
    tie_row = {
        'id': 'tie', 'song': 's', 'lang': 'la', 'group': 'solo', 'family': 'mms', 'long': True,
        'pass': {'base': {'off': blank, 'or': proved_only, 'only': proved_only.copy()}},
    }
    agree({('s', 'la'): ['off', 'or', 'only']}, [tie_row], 'an equal phoneme role keeps the earlier one')
    listed_backwards = {
        'id': 'back', 'song': 's', 'lang': 'la', 'group': 'solo', 'family': 'mms', 'long': True,
        'pass': {'base': {'off': proved_only, 'only': proved_only.copy()}},
    }
    agree({('s', 'la'): ['only', 'off']}, [listed_backwards], 'fewer admissions win when off is not listed first')

    def pass_grid(real: bool, shift: bool) -> np.ndarray:
        grid = np.zeros((len(A.LINE_SHARES), 8), dtype=bool)
        grid[:, 0] = real
        if shift:
            grid[:, 1] = True
            grid[:, 2] = True
        return grid

    blocked_family = [
        {
            'id': 'mms', 'song': 's', 'lang': 'la', 'group': 'solo', 'family': 'mms', 'long': True,
            'pass': {'base': {'off': pass_grid(True, True), 'only': pass_grid(True, True)}},
        },
        {
            'id': 'stable', 'song': 's', 'lang': 'la', 'group': 'solo', 'family': 'stable-ts', 'long': True,
            'pass': {'base': {'off': pass_grid(True, False), 'only': pass_grid(True, False)}},
        },
    ]
    agree({('s', 'la'): ['off', 'only']}, blocked_family, 'a placer over 5 % at K = 1 is dropped before the role is chosen')
    over_both = [
        dict(blocked_family[0]),
        {
            'id': 'stable', 'song': 's', 'lang': 'la', 'group': 'solo', 'family': 'stable-ts', 'long': True,
            'pass': {'base': {'off': pass_grid(True, True), 'only': pass_grid(True, True)}},
        },
    ]
    agree({('s', 'la'): ['off']}, over_both, 'every placer over 5 % leaves the assignment outside the cap')

    rng = np.random.default_rng(11)
    families = ('mms', 'stable-ts', 'second')
    random_roles = {
        ('s', 'a'): ['off', 'or', 'only'],
        ('s', 'b'): ['off', 'only'],
        ('s', '*'): ['off', 'or'],
        ('t', 'a'): ['off', 'or', 'only'],
    }
    random_rows = []
    for i in range(18):
        lang = ('a', 'b', 'c')[i % 3]
        song = 's' if i < 12 else 't'
        grid = {}
        for role in ('off', 'or', 'only'):
            cell = rng.random((len(A.LINE_SHARES), 8)) < (0.04 if role == 'off' else 0.08)
            cell[:, 0] = rng.random(len(A.LINE_SHARES)) < 0.7
            grid[role] = cell
        random_rows.append({
            'id': f'r{i}', 'song': song, 'lang': lang, 'group': 'solo' if i % 5 else 'choir',
            'family': families[i % 3], 'long': lang != 'c',
            'pass': {'base': grid},
        })
    agree(random_roles, random_rows, 'the summed search matches the product on a mixed sample')

    def cover_grid(real: bool, shift: bool = False) -> np.ndarray:
        grid = np.zeros((len(A.LINE_SHARES), 8), dtype=bool)
        grid[:, 0] = real
        if shift:
            grid[:, 1] = True
            grid[:, 2] = True
        return grid

    def cover_line(line_id: str, only_real: bool, or_real: bool, only_shift: bool = False, or_shift: bool = False) -> dict:
        return {
            'id': line_id, 'song': 's', 'lang': 'la', 'group': 'solo', 'family': 'mms', 'long': True,
            'pass': {'base': {
                'off': cover_grid(False),
                'only': cover_grid(only_real, only_shift),
                'or': cover_grid(or_real, or_shift),
            }},
        }

    quiet = [cover_line(f'q{i}', True, True) for i in range(18)]
    kept_cover = Phone.select(
        {('s', 'la'): ['off', 'or', 'only']},
        quiet + [cover_line('keep-a', True, False), cover_line('keep-b', False, True)],
        'base')
    check('a within-limit role keeps the line the count-max missed',
          kept_cover['assignment'][('s', 'la')] == 'or'
          and kept_cover['proved'] == 19 and kept_cover['count_proved'] == 19
          and kept_cover['cover_proved'] == 20
          and kept_cover['line_roles'].get('keep-a') == 'only'
          and 'keep-b' not in kept_cover['line_roles']
          and kept_cover['lost'] == [],
          str((kept_cover['assignment'], kept_cover['proved'], kept_cover['cover_proved'],
               kept_cover['line_roles'], kept_cover['lost'])))
    blocked_cover = Phone.select(
        {('s', 'la'): ['off', 'or', 'only']},
        quiet + [
            cover_line('shift-a', True, False, only_shift=True),
            cover_line('shift-b', False, True, or_shift=True),
        ],
        'base')
    check('a mix over 5 % does not keep the extra line and does not drop the winner',
          blocked_cover['assignment'][('s', 'la')] == 'or'
          and blocked_cover['proved'] == 19 and blocked_cover['count_proved'] == 19
          and blocked_cover['line_roles'] == {}
          and blocked_cover['lost'] == ['shift-a']
          and blocked_cover['lost_chance'] is not None and float(blocked_cover['lost_chance']) > 0.05,
          str((blocked_cover['proved'], blocked_cover['line_roles'], blocked_cover['lost'], blocked_cover['lost_chance'])))
    facts = Phone.counterfactuals(
        kept_cover['assignment'], {('s', 'la'): ['off', 'or', 'only']},
        quiet + [cover_line('keep-a', True, False), cover_line('keep-b', False, True)],
        'base', kept_cover.get('k'))
    only_row = next(row for row in facts if row['role'] == 'only')
    check('a dropped role reports its line count and its line chance',
          only_row['within_limit'] and only_row['proved'] == 19 and only_row['pair_proved'] == 19
          and 'keep-a' in only_row['gained'] and 'keep-b' in only_row['lost_ids']
          and only_row['chance'] is not None and float(only_row['chance']) <= 0.05,
          str(only_row))

    word_line = {'phones': {'m': 1.0}, 'vowels': {'m': 9.0}}
    other_line = {'phones': {'m': 2.0}, 'vowels': {'m': 9.0}}
    role_song = {'slug': 's', 'use_choir_envelope': False, 'all_lines': [
        {'id': 'solo-a', 'lang': 'la', 'group': 'solo', 'words': [word_line]},
        {'id': 'solo-b', 'lang': 'la', 'group': 'solo', 'words': [other_line]},
    ]}
    Phone.apply([role_song], {
        'long': [['s', 'la']],
        'pairs': [{'song': 's', 'lang': 'la', 'role': 'or', 'model': 'm'}],
        'line_roles': {'solo-b': 'only'},
        'choir_clock': 'phone', 'choir_attack': 'spectral',
    })
    check('a line role replaces the pair role',
          word_line.get('phoneme_role') == 'or' and other_line.get('phoneme_role') == 'only'
          and other_line.get('phoneme') == 2.0,
          str((word_line.get('phoneme_role'), other_line.get('phoneme_role'), other_line.get('phoneme'))))
    Phone.clear([role_song])

    empty = Phone.choose([], {}, {'both_far': 0.20, 'only_far': 0.30})
    variant_names = [row.get('variant') for row in (empty.get('chorus') or {}).get('variants') or []]
    check('every choir feature is listed even when none is adopted',
          variant_names == ['envelope', 'vowel', 'both'] and empty['chorus'].get('adopted') is False,
          str(variant_names))

    lyrics = {'sections': [{'id': 's', 'kind': 'vocal', 'start': 0, 'end': 10, 'lines': [{
        'id': 'h',
        'words': [{'w': 'aa', 's': 0.10, 'e': 0.40}, {'w': 'bb', 's': 0.50, 'e': 0.90}],
    }]}]}
    report = {'lines': [{
        'id': 'h', 'status': 'weak', 'placed_by': 'mms', 'structure_ok': False,
        'words': [
            {'w': 'aa', 'roman': 'aa', 's': 0.10, 'e': 0.40, 'ctc_s': 9.0, 'ctc_e': 9.4,
             'phoneme_models': {'xlsr-53-espeak': 1.0}},
            {'w': 'bb', 'roman': 'bb', 's': 0.50, 'e': 0.90, 'ctc_s': 9.4, 'ctc_e': 9.8,
             'phoneme_models': {'xlsr-53-espeak': 1.4}},
        ],
    }]}
    rule = {'retime': {'song': [{
        'id': 'h', 'by': 'phoneme',
        'words': [
            {'wi': 0, 'ctc_s': 1.00, 'ctc_e': 1.40, 'second_s': 1.0, 'third_s': 1.25,
             'second_kind': 'mms', 'third_kind': 'whisperx'},
            {'wi': 1, 'ctc_s': 1.45, 'ctc_e': 1.90, 'second_s': 1.4, 'third_s': 1.70,
             'second_kind': 'mms', 'third_kind': 'whisperx'},
        ],
    }]}}
    saved_peaks = Q.onset_peak_times
    Q.onset_peak_times = lambda *args, **kwargs: np.array([1.05, 1.50])
    try:
        rewritten = Q.apply_saved_retime('song', lyrics, report, rule, None)
    finally:
        Q.onset_peak_times = saved_peaks
    published = lyrics['sections'][0]['lines'][0]['words']
    stored = report['lines'][0]
    check('a kept placement rewrites the pre-snap start and snaps the published one',
          rewritten == 1 and stored['status'] == 'good' and stored['placed_by'] == 'phoneme'
          and stored['words'][0]['ctc_s'] == 1.0 and published[0]['s'] == 1.05
          and stored['words'][0]['phoneme_models'] == {} and published[1]['s'] == 1.50,
          str((stored['status'], stored['words'][0], published)))


def test_translation_window() -> None:
    """Same-language cues stay at 0.30 s. A translation cue can use the measured half."""
    import placement as P

    check('a same-language cue, including the region, stays at 0.30 s',
          P.cue_accept_limit('en', 'en-GB') == P.CUE_TOL)
    check('a missing language is not a translation',
          P.cue_accept_limit('fa', None) == P.CUE_TOL and P.cue_accept_limit(None, 'en-GB') == P.CUE_TOL)
    check('a Persian line on an English cue uses the measured half',
          P.cue_accept_limit('fa', 'en-GB') == P.TRANSLATION_HALF)
    near = P.judge([0.30, 0.80], [0.80, 1.20], 0.0, None)
    check('exactly 0.30 s is placed', near.get('placed') is True, str(near))
    over = P.judge([0.31, 0.81], [0.81, 1.21], 0.0, None)
    check('0.31 s is not placed at the default gate', over.get('placed') is False and over.get('near') is False, str(over))
    wide = P.judge([1.50, 2.00], [2.00, 2.40], 0.0, None, limit=2.01)
    check('1.50 s is placed when the translation half is the limit', wide.get('placed') is True, str(wide))
    fenced = P.translation_span(10.0, 9.5, 10.4, 2.01)
    check('the neighbour fence is tighter than the half',
          abs(fenced[0] - 9.5) < 1e-9 and abs(fenced[1] - 10.4) < 1e-9, str(fenced))
    check('a start inside that fence is accepted',
          P.in_translation_window(10.2, 10.0, 9.5, 10.4, 2.01))
    check('a start past the next cue is not accepted',
          not P.in_translation_window(10.5, 10.0, 9.5, 10.4, 2.01))
    early = P.translation_leftover(
        375.90, 376.34, 376.34, 381.0, structure_ok=True, translated=True)
    check('a start before the previous cue end is not a wide leftover', not early)
    inside = P.translation_leftover(
        10.80, 10.0, 9.5, 12.0, structure_ok=True, translated=True)
    check('a fenced translation start outside 0.30 s is a wide leftover', inside)
    tight = P.translation_leftover(
        10.20, 10.0, 9.5, 12.0, structure_ok=True, translated=True)
    check('a start inside 0.30 s is not a wide leftover', not tight)
    same = P.translation_leftover(
        10.80, 10.0, 9.5, 12.0, structure_ok=True, translated=False)
    check('a same-language start is not a wide leftover', not same)
    unit = type('U', (), {'id': 'x', 'line': {'lang': 'fa'}})()
    check('the adoption gate stays 0.30 s for a translation cue',
          align._cue_limit(unit, {'x': {'lang': 'en-GB', 'start': 1.0}}) == P.CUE_TOL)

    words = [{
        'roman': 'aa', 'ctc_s': 1.0, 'ctc_e': 1.2,
        'second_s': 1.02, 'third_s': 1.03, 'vowel_s': 1.0,
    }]
    held = Q.prove_words(words, [0.40], 0.10, witnesses='two', nucleus=True)
    plain = Q.prove_words(words, [0.40], 0.10, witnesses='two', nucleus=False)
    check('a long vowel uses the nucleus when the spectral attack is outside tolerance',
          held and held[0]['path'] == 'nucleus' and held[0]['reason'] == 'pass', str(held))
    check('without the nucleus the same word is not proved',
          plain and plain[0]['path'] == 'fail', str(plain))
    consonant = [{
        'roman': 'ba', 'ctc_s': 1.0, 'ctc_e': 2.0,
        'second_s': 1.02, 'third_s': 1.03, 'vowel_s': 1.0,
        'own_t': 1.0, 'own_e': 1.2,
    }]
    not_held = Q.prove_words(consonant, [0.40], 0.10, witnesses='two', nucleus=True)
    check('a shifted span does not turn a short consonant into a nucleus',
          not_held and not_held[0]['path'] == 'fail', str(not_held))

    lyrics = {'sections': [{'kind': 'vocal', 'id': 's', 'lines': [
        {'id': 'far', 'lang': 'fa', 'words': [{'w': 'a', 's': 10.50, 'e': 11.00}, {'w': 'b', 's': 11.00, 'e': 11.40}]},
        {'id': 'en', 'lang': 'en', 'words': [{'w': 'c', 's': 12.10, 'e': 12.50}]},
    ]}]}
    report = {'lines': [
        {'id': 'far', 'status': 'good', 'placed_by': 'mms', 'ctc_start': 10.50},
        {'id': 'en', 'status': 'good', 'placed_by': 'mms', 'ctc_start': 12.10},
    ]}
    cues = {
        'far': {'lang': 'en-GB', 'start': 10.0, 'end': 11.8},
        'en': {'lang': 'en', 'start': 12.0, 'end': 13.0},
    }
    rejected = {'translation_measured': True, 'translation_half': None, 'line_wide': []}
    n = Q.reject_wide_translation(lyrics, report, rejected, cues)
    far = lyrics['sections'][0]['lines'][0]['words']
    check('a rejected translation window returns the line to the cue',
          n == 1 and abs(far[0]['s'] - 10.0) < 1e-9
          and report['lines'][0]['status'] == 'weak' and report['lines'][0]['placed_by'] is None
          and abs(lyrics['sections'][0]['lines'][1]['words'][0]['s'] - 12.10) < 1e-9,
          str((n, far, report['lines'][0])))
    kept_lyrics = {'sections': [{'kind': 'vocal', 'id': 's', 'lines': [
        {'id': 'far', 'lang': 'fa', 'words': [{'w': 'a', 's': 10.50, 'e': 11.00}, {'w': 'b', 's': 11.00, 'e': 11.40}]},
    ]}]}
    kept_report = {'lines': [{'id': 'far', 'status': 'good', 'placed_by': 'mms', 'ctc_start': 10.50}]}
    admitted = {'translation_measured': True, 'translation_half': 2.01, 'line_wide': ['far']}
    n_keep = Q.reject_wide_translation(kept_lyrics, kept_report, admitted, cues)
    check('a line the join paid for keeps its wider start',
          n_keep == 0 and kept_lyrics['sections'][0]['lines'][0]['words'][0]['s'] == 10.50
          and kept_report['lines'][0]['status'] == 'good',
          str((n_keep, kept_report['lines'][0])))
    outside = {'sections': [{'kind': 'vocal', 'id': 's', 'lines': [
        {'id': 'far', 'lang': 'fa', 'words': [{'w': 'a', 's': 13.00, 'e': 13.40}]},
    ]}]}
    outside_report = {'lines': [{'id': 'far', 'status': 'good', 'placed_by': 'mms', 'ctc_start': 13.00}]}
    n_out = Q.reject_wide_translation(
        outside, outside_report,
        {'translation_measured': True, 'translation_half': 2.01, 'line_wide': None}, cues)
    check('a start outside the measured half is still returned to the cue',
          n_out == 1 and abs(outside['sections'][0]['lines'][0]['words'][0]['s'] - 10.0) < 1e-9,
          str(outside['sections'][0]['lines'][0]['words']))
    # Published start drifted past 0.30 s. The raw aligner start did not.
    tight_lyrics = {'sections': [{'kind': 'vocal', 'id': 's', 'lines': [
        {'id': 'shushtari-1-1', 'lang': 'ar', 'words': [{'w': 'a', 's': 58.67, 'e': 59.20}]},
    ]}]}
    tight_report = {'lines': [{
        'id': 'shushtari-1-1', 'status': 'good', 'placed_by': 'mms', 'ctc_start': 58.58,
    }]}
    tight_cues = {'shushtari-1-1': {'lang': 'en-GB', 'start': 58.298, 'end': 60.0}}
    n_tight = Q.reject_wide_translation(
        tight_lyrics, tight_report,
        {'translation_measured': True, 'translation_half': 2.01, 'line_wide': []}, tight_cues)
    published = tight_lyrics['sections'][0]['lines'][0]['words'][0]['s']
    gap = abs(published - 58.298)
    check('a raw start inside 0.30 s stays placed when the published start drifted',
          n_tight == 1 and tight_report['lines'][0]['status'] == 'good'
          and tight_report['lines'][0]['placed_by'] == 'mms'
          and tight_report['lines'][0]['ctc_start'] == 58.58
          and round(gap, 3) <= 0.30,
          str((n_tight, tight_report['lines'][0], published, gap)))


def test_monotone_union() -> None:
    """A join keeps every baseline line unless holding it pushes the line pass over 5 %."""
    import attack_chance as A

    def grid(cols: tuple[int, ...] = ()) -> np.ndarray:
        bits = np.zeros((len(A.LINE_SHARES), 8), dtype=bool)
        bits[:, 0] = True
        for col in cols:
            bits[:, col] = True
        return bits

    def pack(name: str, ids: list[str], *, baseline: bool = False, within: bool = True,
             partial: bool = False, cols: dict | None = None) -> dict:
        cols = cols or {}
        return {
            'name': name,
            'baseline': baseline,
            'within_limit': within or baseline,
            'partial': partial,
            'k': 0.25,
            'lines': {
                lid: {'family': 'mms', 'bits': grid(tuple(cols.get(lid, ()))), 'song': 's'}
                for lid in ids
            },
            'words': {},
            'extra': {},
        }

    quiet = [f'q{i:02d}' for i in range(18)]
    base = pack('baseline', quiet + ['A'], baseline=True)
    other = pack('other', quiet + ['B'])
    joined = A.admit_union([base, other])
    check('the full join keeps the baseline line and the extra line',
          joined.get('full_or') is True and joined.get('within_limit') is True
          and 'A' in joined['proved'] and 'B' in joined['proved']
          and abs(float(joined['chance']) - 0.0) < 1e-12
          and A.pass_keeps_baseline(joined, joined['baseline_ids']),
          str((joined['proved'], joined['chance'], joined['full_or'])))
    dropped = {'proved': quiet + ['B'], 'lost': [], 'lost_detail': {}, 'lost_chance': None}
    check('dropping a baseline line without a cap reason fails',
          not A.pass_keeps_baseline(dropped, quiet + ['A']))
    capped = {
        'proved': quiet, 'lost': ['A'], 'lost_detail': {'A': 0.10}, 'lost_chance': 0.10,
    }
    check('a drop whose line pass is above 5 % is the allowed cap reason',
          A.pass_keeps_baseline(capped, quiet + ['A']))

    partial = pack(
        'partial', ['shift-a', 'shift-b'], within=False, partial=True,
        cols={'shift-a': (1, 2), 'shift-b': (1, 2)})
    partial['within_limit'] = False
    added = A.admit_union([base, partial])
    check('one extra line at exactly 5 % stays and the next one is lost',
          'A' in added['proved'] and 'shift-a' in added['proved'] and 'shift-b' not in added['proved']
          and added.get('lost') == ['shift-b']
          and added.get('lost_chance') is not None and float(added['lost_chance']) > 0.05
          and A.pass_keeps_baseline(added, added['baseline_ids']),
          str((added['proved'], added['lost'], added['lost_chance'], added['chance'])))
    clock = pack(
        'stable:one:de:large-v3-turbo', ['kept'], within=False, partial=True, cols={})
    clock['within_limit'] = False
    held = A.admit_union([base, clock])
    check('an alternate clock keeps its line and the baseline line',
          'A' in held['proved'] and 'kept' in held['proved']
          and held['line_member'].get('kept') == 'stable:one:de:large-v3-turbo'
          and A.pass_keeps_baseline(held, held['baseline_ids']),
          str((held['proved'], held['line_member'])))
    fill_ids, placed_ids = A._union_line_flags(
        {'old': 'fill', 'gap': 'placed-fill', 'phone': 'phone-fill:karitas:la:lv-60-espeak', 'skip': 'placed-fill'},
        {'old', 'gap', 'phone'})
    check('a placed-fill line takes both the envelope and the empty-slot clock',
          fill_ids == ['gap', 'old', 'phone'] and placed_ids == ['gap'],
          str((fill_ids, placed_ids)))
    check('a combined wide gate publishes both flags and not the empty slot',
          A._member_features('wide-fill') == {'fill', 'wide'}
          and A._member_features('wide') == {'wide'}
          and A._member_features('nearest') == {'nearest'}
          and A._member_features('wide-nearest') == {'wide', 'nearest'}
          and A._member_features('wide-nucleus') == {'nucleus', 'wide'}
          and A._member_features('wide-phoneme') == {'wide', 'phone'}
          and A._member_features('wide-phoneme-fill') == {'fill', 'wide', 'phone'}
          and A._member_features('placed-fill') == {'fill', 'placed'})
    wide_fill, wide_placed = A._union_line_flags(
        {'a': 'wide-fill', 'b': 'nearest', 'c': 'placed-fill'}, {'a', 'b', 'c'})
    check('the envelope list keeps wide-fill and the empty slot stays placed-fill',
          wide_fill == ['a', 'c'] and wide_placed == ['c']
          and A._ids_with({'a': 'wide-fill', 'b': 'nearest', 'c': 'wide'}, {'a', 'b', 'c'}, 'wide') == ['a', 'c']
          and A._ids_with({'a': 'wide-fill', 'b': 'nearest'}, {'a', 'b'}, 'nearest') == ['b'],
          str((wide_fill, wide_placed)))

    def half(left: bool, right: bool) -> np.ndarray:
        grid_half = np.zeros((len(A.LINE_SHARES), 2), dtype=bool)
        grid_half[0, 0] = left
        grid_half[0, 1] = right
        return grid_half

    wide = pack('wide', ['W'], within=True, partial=True)
    wide['extra'] = {'W': half(False, False), 'N': half(False, False), 'H': half(False, False)}
    filled = pack('wide-fill', ['N'], within=False, partial=True)
    filled['within_limit'] = False
    filled['extra'] = {'N': half(True, True)}
    hand = pack('handoff', ['H'], within=False, partial=True)
    hand['within_limit'] = False
    hand['extra'] = {'H': half(True, True)}
    priced = A.admit_union([base, wide, filled, hand])
    check('a combined gate pays its own half, and an older gate keeps the earlier map',
          'A' in priced['proved'] and 'W' in priced['proved'] and 'H' in priced['proved']
          and 'N' not in priced['proved'] and priced['line_member'].get('H') == 'handoff',
          str((priced['proved'], priced['lost'], priced['chance'], priced['line_member'])))
    cheap = pack('wide-fill', ['N'], within=False, partial=True)
    cheap['within_limit'] = False
    cheap['extra'] = {'N': half(False, False)}
    kept_wide = A.admit_union([base, wide, cheap])
    check('a combined gate keeps the line when its own half does not still pass',
          'N' in kept_wide['proved'] and kept_wide['line_member'].get('N') == 'wide-fill'
          and 'A' in kept_wide['proved'] and 'W' in kept_wide['proved'],
          str((kept_wide['proved'], kept_wide['line_member'], kept_wide['chance'])))


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
    test_translation_window()
    test_monotone_union()
    test_section_edges()
    test_bias_and_witnesses()
    test_attack_chance()
    test_line_rule()
    test_placement_chain()
    test_whisper_witness()
    test_whisper_choice()
    test_phoneme()
    test_calibration()
    test_bench_summary()
    test_harakat()
    test_cue_in_build_proof()
    test_anchor_fence()
    print('FAIL' if PASS else 'all checks passed')
    return PASS


if __name__ == '__main__':
    sys.exit(main())
