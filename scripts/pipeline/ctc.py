"""CTC forced alignment (Viterbi) in NumPy, shared by align.py and the second-opinion engines."""
from __future__ import annotations

import numpy as np


def viterbi(lp: np.ndarray, tokens: list[int], blank: int = 0) -> np.ndarray | None:
    """Best monotonic path of `tokens` through frames `lp` (frames × vocabulary, log posteriors).

    CTC topology: optional blanks between letters, a doubled letter needs a blank in between.
    Returns the state per frame (odd state 2k+1 = token k, even = blank) or None when the window is
    too short for the text."""
    n_t, n_l = lp.shape[0], len(tokens)
    tok = np.asarray(tokens, dtype=np.int64)
    repeats = int(np.sum(tok[1:] == tok[:-1])) if n_l > 1 else 0
    if n_l == 0 or n_t < n_l + repeats:
        return None
    S = 2 * n_l + 1
    ext = np.full(S, blank, dtype=np.int64)
    ext[1::2] = tok
    skip = np.zeros(S, dtype=bool)
    skip[3::2] = tok[1:] != tok[:-1]
    neg = -1e30
    alpha = np.full(S, neg)
    alpha[0], alpha[1] = lp[0, blank], lp[0, ext[1]]
    back = np.zeros((n_t, S), dtype=np.int8)
    cand = np.full((3, S), neg)
    cols = np.arange(S)
    for t in range(1, n_t):
        cand[0] = alpha
        cand[1, 1:] = alpha[:-1]
        cand[2, 2:] = np.where(skip[2:], alpha[:-2], neg)
        choice = cand.argmax(axis=0)
        alpha = cand[choice, cols] + lp[t, ext]
        back[t] = choice
    s = S - 1 if alpha[S - 1] >= alpha[S - 2] else S - 2
    if alpha[s] <= neg / 2:
        return None
    path = np.empty(n_t, dtype=np.int64)
    for t in range(n_t - 1, -1, -1):
        path[t] = s
        s -= int(back[t, s])  # int(): NumPy 2 would keep int8 and overflow
    return path


def token_spans(path: np.ndarray, n_tokens: int) -> tuple[np.ndarray, np.ndarray]:
    """First and last frame of every token on a Viterbi path."""
    tok = np.where(path % 2 == 1, (path - 1) // 2, -1)
    first = np.full(n_tokens, -1)
    last = np.full(n_tokens, -1)
    for f in np.flatnonzero(tok >= 0):
        k = tok[f]
        if first[k] < 0:
            first[k] = f
        last[k] = f
    return first, last
