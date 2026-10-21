"""Numbers cited in docs/research/repo-audit.md that facts.json does not store.

    python docs/research/repo-audit/extras.py

Pins git revision bd92a0788939 (origin/main at the audit clock). Does not
follow a later origin/main and does not rewrite facts.json.

GitHub Actions are read live, then kept only when createdAt is within the
window already stored in facts.json (actions.from .. actions.to). A run
outside that window is counted under "actionsAfterSnapshot" and is not
used in the prose.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
FACTS = HERE / "facts.json"
OUT = HERE / "extras.json"
SNAP = "bd92a0788939fc97f4303f5bf0156503dccd5f64"
ANSI = re.compile(r"\x1b\[[0-9;]*m")


def run(args: list[str]) -> str:
    env = os.environ.copy()
    env["GH_FORCE_TTY"] = "0"
    env["NO_COLOR"] = "1"
    proc = subprocess.run(args, cwd=ROOT, capture_output=True, env=env)
    out = ANSI.sub("", proc.stdout.decode("utf-8", "replace"))
    err = ANSI.sub("", proc.stderr.decode("utf-8", "replace"))
    if proc.returncode != 0:
        raise RuntimeError(f"{args}\n{err or out}")
    return out


def git_show(rev: str, path: str) -> str:
    return run(["git", "show", f"{rev}:{path}"])


def blob_size(rev: str, path: str) -> int:
    return int(run(["git", "cat-file", "-s", f"{rev}:{path}"]).strip())


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def line_stats(text: str) -> dict:
    lines = text.splitlines()
    longest = max(range(len(lines)), key=lambda i: len(lines[i]))
    return {
        "lines": len(lines),
        "longestLine": longest + 1,
        "longestChars": len(lines[longest]),
        "lineChars": {str(i + 1): len(lines[i]) for i in range(len(lines)) if len(lines[i]) >= 400},
    }


def ledger_extras(text: str) -> dict:
    rows = [json.loads(line) for line in text.splitlines() if line.strip()]
    grok = [row for row in rows if row.get("agent") == "grok" and row.get("kind") == "session"]
    by_session: dict[str, list] = {}
    for row in grok:
        by_session.setdefault(row["session"], []).append(row)
    duplicate_bytes = 0
    change_rows = 0
    peaks = []
    for items in by_session.values():
        seen = None
        peak = max(items, key=lambda row: int(row.get("totalTokens") or 0))
        peaks.append(peak)
        for row in items:
            key = (row.get("totalTokens"), row.get("outputTokens"), row.get("modelCalls"), row.get("turns"))
            payload = json.dumps(row, ensure_ascii=False, separators=(",", ":"))
            # git show is LF. Count the line the way it sits in the blob: JSON + newline.
            # collect.py writes json.dumps with default separators and a newline, which is
            # not the same byte string. Measure the raw file line instead.
            if key == seen:
                pass
            else:
                change_rows += 1
                seen = key
    # Raw lines, so the byte count matches the blob rather than a re-encoding.
    raw_lines = text.splitlines(keepends=True)
    raw_rows = []
    for raw in raw_lines:
        body = raw.strip()
        if not body:
            continue
        raw_rows.append((json.loads(body), raw))
    duplicate_bytes = 0
    seen_by_session: dict[str, tuple] = {}
    for row, raw in raw_rows:
        if row.get("agent") != "grok" or row.get("kind") != "session":
            continue
        key = (row.get("totalTokens"), row.get("outputTokens"), row.get("modelCalls"), row.get("turns"))
        previous = seen_by_session.get(row["session"])
        if previous == key:
            duplicate_bytes += len(raw.encode("utf-8"))
        else:
            seen_by_session[row["session"]] = key
    calls = sum(int(row.get("modelCalls") or 0) for row in peaks)
    output = sum(int(row.get("outputTokens") or 0) for row in peaks)
    total = sum(int(row.get("totalTokens") or 0) for row in peaks)

    def series(group: str) -> dict:
        points = [row for row in rows if row.get("kind") == "quota" and row.get("group") == group]
        percent_changes = 0
        previous = None
        for row in points:
            key = (row.get("weeklyRemaining"), row.get("fiveHourRemaining"))
            if previous is None or key != previous:
                percent_changes += 1
                previous = key
        return {"rows": len(points), "percentTupleChanges": percent_changes, "repeatedPercentTuples": len(points) - percent_changes}

    gemini_quota = series("gemini")
    claude_gpt = series("claude-gpt")
    return {
        "blobBytes": len(text.encode("utf-8")),
        "lines": len(rows),
        "grokDuplicatePayloadBytes": duplicate_bytes,
        "grokChangeRows": change_rows,
        "peakModelCalls": calls,
        "peakOutputTokens": output,
        "peakTotalTokens": total,
        "tokensPerCall": round(total / calls, 1) if calls else None,
        "outputPerCall": round(output / calls, 1) if calls else None,
        "outputShare": round(output / total, 4) if total else None,
        "geminiQuota": gemini_quota,
        "claudeGptQuota": claude_gpt,
    }


def board_lines(text: str) -> dict:
    lines = text.splitlines()
    interesting = []
    for index, line in enumerate(lines, start=1):
        if any(token in line for token in ("74", "68", "proven", "Синхронизация", "хор ONE", "не влита")):
            if any(token in line for token in ("proven", "Синхронизация", "74 /", "74 из", "I Have", "Karitas", "ONE")):
                interesting.append({"line": index, "chars": len(line), "text": line.strip()[:240]})
    return {"matchingLines": interesting}


def t1_unmerged() -> dict:
    text = git_show("651d948", "docs/tasks/T1-sync.md")
    lines = text.splitlines()
    hits = []
    for index, line in enumerate(lines, start=1):
        if any(token in line for token in ("39485477434", "2cb65e0", "70 /", "27 /", "22 /", "11 /", "не влита", "74 /")):
            hits.append({"line": index, "text": line.strip()[:240]})
    ancestor = subprocess.run(
        ["git", "merge-base", "--is-ancestor", "6eb52cc", SNAP],
        cwd=ROOT,
        capture_output=True,
    ).returncode == 0
    ops = subprocess.run(
        ["git", "cat-file", "-e", f"{SNAP}:src/pages/OpsPage.tsx"],
        cwd=ROOT,
        capture_output=True,
    ).returncode
    return {
        "commit": "651d948",
        "hits": hits,
        "sixeb52ccAncestorOfSnapshot": ancestor,
        "opsPageOnSnapshotExit": ops,
    }


def alignment_runs(window_from: str, window_to: str) -> dict:
    raw = run([
        "gh", "run", "list", "--limit", "300",
        "--json", "databaseId,workflowName,displayTitle,conclusion,createdAt,updatedAt,headBranch",
    ])
    runs = json.loads(raw)
    start = parse_time(window_from)
    end = parse_time(window_to)
    inside = []
    after = 0
    for row in runs:
        created = parse_time(row["createdAt"])
        if created < start or created > end:
            if created > end:
                after += 1
            continue
        inside.append(row)
    phrase = "queue alignment for the three songs"
    same = []
    for row in inside:
        title = (row.get("displayTitle") or "").strip().lower().rstrip(".")
        if title == phrase:
            start_at = parse_time(row["createdAt"])
            end_at = parse_time(row["updatedAt"])
            same.append({
                "id": row["databaseId"],
                "branch": row["headBranch"],
                "conclusion": row["conclusion"],
                "createdAt": row["createdAt"],
                "minutes": round((end_at - start_at).total_seconds() / 60, 1),
                "title": row["displayTitle"],
            })
    same.sort(key=lambda row: row["createdAt"])
    conclusions = Counter(row["conclusion"] for row in same)
    if same:
        span_h = round((parse_time(same[-1]["createdAt"]) - parse_time(same[0]["createdAt"])).total_seconds() / 3600, 2)
    else:
        span_h = None
    pipeline = [row for row in inside if row.get("workflowName") == "pipeline"]
    return {
        "windowFrom": window_from,
        "windowTo": window_to,
        "runsInsideWindow": len(inside),
        "runsAfterWindow": after,
        "pipelineInsideWindow": len(pipeline),
        "sameTitle": {
            "phrase": "Queue alignment for the three songs",
            "runs": same,
            "byConclusion": dict(conclusions),
            "spanHours": span_h,
        },
    }


def file_sizes() -> dict:
    paths = [
        "src/components/controls.tsx",
        "src/ui/controls.tsx",
        "scripts/tools/font-shots.mjs",
        "scripts/pipeline/sandbox/__pycache__/research.cpython-313.pyc",
        "ops/usage/ledger/2026-10.jsonl",
    ]
    sizes = {}
    for path in paths:
        try:
            sizes[path] = blob_size(SNAP, path)
        except RuntimeError as exc:
            sizes[path] = f"missing: {exc}"[:180]
    return sizes


def main() -> None:
    facts = json.loads(FACTS.read_text(encoding="utf-8"))
    if not facts["originMain"].startswith(SNAP[:12]):
        raise SystemExit(f"facts.json is not the pinned snapshot: {facts['originMain']}")
    backlog = line_stats(git_show(SNAP, "docs/BACKLOG.md"))
    status = line_stats(git_show(SNAP, "docs/STATUS.md"))
    ledger = git_show(SNAP, "ops/usage/ledger/2026-10.jsonl")
    usage = ledger_extras(ledger)
    usage["gitCatFileBytes"] = blob_size(SNAP, "ops/usage/ledger/2026-10.jsonl")
    first = parse_time(facts["usage"]["firstTs"])
    last = parse_time(facts["usage"]["lastTs"])
    span_h = (last - first).total_seconds() / 3600
    usage["spanHours"] = round(span_h, 2)
    usage["linesPer30DaysIfRateHolds"] = round(facts["usage"]["lines"] / span_h * 24 * 30)
    usage["grokChangeRowsPer30DaysIfRateHolds"] = round(facts["usage"]["grokRowsThatChangeTuple"] / span_h * 24 * 30)
    board = board_lines(git_show(SNAP, "ops/board.json"))
    actions = facts["actions"]
    report = {
        "snapshot": SNAP,
        "auditClock": facts["auditClock"],
        "backlog": backlog,
        "status": status,
        "usage": usage,
        "boardLines": board,
        "t1": t1_unmerged(),
        "alignment": alignment_runs(actions["from"], actions["to"]),
        "fileSizes": file_sizes(),
        "firstCommit": run(["git", "log", "--reverse", "--format=%H %cI %s", SNAP]).splitlines()[0],
    }
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}")
    print("duplicateBytes", usage["grokDuplicatePayloadBytes"], "calls", usage["peakModelCalls"])
    print("gemini", usage["geminiQuota"], "claude-gpt", usage["claudeGptQuota"])
    print("sameTitle", report["alignment"]["sameTitle"]["byConclusion"], "span", report["alignment"]["sameTitle"]["spanHours"])
    print("backlog long", backlog["lineChars"])
    print("status long", status["lineChars"])


if __name__ == "__main__":
    main()
