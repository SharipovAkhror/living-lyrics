"""Recompute the numbers cited in docs/research/repo-audit.md.

    python docs/research/repo-audit/measure.py

Reads git, ops/usage/ledger and (if `gh` is logged in) GitHub Actions.
Writes docs/research/repo-audit/facts.json. Does not change project files.
The snapshot revision is origin/main. Open durations use that commit's time,
so a later re-run on new commits produces new durations.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ANSI = re.compile(r"\x1b\[[0-9;]*m")

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent / "facts.json"
REV = "origin/main"
TEXT_EXT = {
    ".md", ".ts", ".tsx", ".js", ".mjs", ".py", ".json", ".css", ".yml", ".yaml",
    ".html", ".txt", ".svg", ".toml",
}


def run(args: list[str], check: bool = True) -> tuple[int, str, str]:
    env = os.environ.copy()
    env["GH_FORCE_TTY"] = "0"
    env["NO_COLOR"] = "1"
    proc = subprocess.run(args, cwd=ROOT, capture_output=True, env=env)
    out = ANSI.sub("", proc.stdout.decode("utf-8", "replace"))
    err = ANSI.sub("", proc.stderr.decode("utf-8", "replace"))
    if check and proc.returncode != 0:
        raise RuntimeError(f"{args}\n{err or out}")
    return proc.returncode, out, err


def git(*args: str, check: bool = True) -> str:
    _, out, _ = run(["git", *args], check=check)
    return out


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def hours(start: datetime, end: datetime) -> float:
    return round((end - start).total_seconds() / 3600, 2)


def show(rev: str, path: str) -> str | None:
    code, out, _ = run(["git", "show", f"{rev}:{path}"], check=False)
    if code != 0:
        return None
    return out


def is_ancestor(commit: str, rev: str = REV) -> bool | None:
    full = git("rev-parse", "--verify", f"{commit}^{{commit}}", check=False)
    if not full.strip():
        return None
    code, _, _ = run(["git", "merge-base", "--is-ancestor", full.strip(), rev], check=False)
    return code == 0


def commit_time(rev: str) -> datetime:
    return parse_time(git("log", "-1", "--format=%cI", rev).strip())


def task_files() -> dict[int, str]:
    code, out, _ = run(["git", "ls-tree", "-r", "--name-only", REV, "docs/tasks"], check=False)
    found: dict[int, str] = {}
    for path in out.splitlines():
        name = Path(path).name
        match = re.match(r"T(\d+)", name)
        if match:
            found[int(match.group(1))] = path
    return found


def first_add(path: str) -> dict | None:
    out = git(
        "log", "--all", "--follow", "--diff-filter=A", "--format=%H%x09%cI%x09%s", "--", path,
        check=False,
    )
    rows = [line for line in out.splitlines() if line.strip()]
    if not rows:
        return None
    commit, when, subject = rows[-1].split("\t", 2)
    return {"commit": commit, "at": when, "subject": subject}


def on_main(path: str) -> dict | None:
    out = git("log", REV, "--diff-filter=A", "--reverse", "--format=%H%x09%cI%x09%s", "--", path, check=False)
    line = next((row for row in out.splitlines() if row.strip()), "")
    if not line:
        # File is on the tree but the adding commit was not classified as an add
        # (rename, or the file arrived inside a squash). Fall back to the oldest touch.
        out = git("log", REV, "--reverse", "--format=%H%x09%cI%x09%s", "--", path, check=False)
        line = next((row for row in out.splitlines() if row.strip()), "")
    if not line:
        return None
    commit, when, subject = line.split("\t", 2)
    return {"commit": commit, "at": when, "subject": subject}


def header_marker(path: str) -> dict | None:
    """First commit on origin/main whose title line says the task is done or rejected."""
    out = git("log", REV, "--reverse", "--format=%H%x09%cI", "--", path, check=False)
    for line in out.splitlines():
        if not line.strip():
            continue
        commit, when = line.split("\t")
        text = show(commit, path)
        if text is None:
            continue
        title = text.splitlines()[0] if text.splitlines() else ""
        if re.search(r"сделано|отклонено", title, re.IGNORECASE):
            return {"commit": commit, "at": when, "title": title}
    return None


def mentioned_commits(path: str) -> list[dict]:
    text = show(REV, path) or ""
    found = []
    seen = set()
    for token in re.findall(r"\b([0-9a-f]{7,40})\b", text):
        if token in seen:
            continue
        seen.add(token)
        kind = git("cat-file", "-t", token, check=False).strip()
        if kind != "commit":
            continue
        found.append({
            "hash": token,
            "ancestorOfMain": is_ancestor(token),
            "subject": git("log", "-1", "--format=%s", token, check=False).strip(),
            "at": git("log", "-1", "--format=%cI", token, check=False).strip(),
        })
        if len(found) >= 30:
            break
    return found


def measure_tasks(audit_at: datetime) -> dict:
    files = task_files()
    rows = []
    for number in range(1, 31):
        path = files.get(number)
        row: dict = {"id": f"T{number}", "brief": path}
        if not path:
            row["leadHours"] = None
            row["reason"] = "no file docs/tasks/T{n}-*.md on origin/main"
            rows.append(row)
            continue
        added = first_add(path)
        landed = on_main(path)
        marker = header_marker(path)
        title = ""
        current = show(REV, path)
        if current:
            title = current.splitlines()[0]
        row.update({
            "title": title,
            "added": added,
            "onMain": landed,
            "marked": marker,
            "commitsOnMain": len([line for line in git("log", REV, "--format=%H", "--", path, check=False).splitlines() if line.strip()]),
            "mentionedCommits": mentioned_commits(path) if number in (1, 18, 29, 30) else [],
        })
        if added and marker:
            start = parse_time(added["at"])
            end = parse_time(marker["at"])
            same = added["commit"].startswith(marker["commit"]) or marker["commit"].startswith(added["commit"])
            row["markerInFirstCommit"] = same or abs((end - start).total_seconds()) < 60
            row["leadHours"] = hours(start, end)
        elif added:
            row["markerInFirstCommit"] = False
            row["leadHours"] = None
            row["openHours"] = hours(parse_time(added["at"]), audit_at)
        else:
            row["leadHours"] = None
            row["reason"] = "file exists but git log found no adding commit"
        rows.append(row)
    return {"tasks": rows}


def measure_merges() -> dict:
    out = git("log", REV, "--first-parent", "--merges", "--format=%H%x09%cI%x09%P%x09%s")
    merges = []
    for line in out.splitlines():
        if not line.strip():
            continue
        commit, when, parents, subject = line.split("\t", 3)
        parent_list = parents.split()
        item = {"commit": commit, "at": when, "subject": subject, "parents": len(parent_list)}
        if len(parent_list) >= 2:
            left, right = parent_list[0], parent_list[1]
            introduced = git("log", "--format=%cI%x09%s", f"{left}..{right}", check=False)
            commits = [row for row in introduced.splitlines() if row.strip()]
            if commits:
                times = [parse_time(row.split("\t", 1)[0]) for row in commits]
                merged = parse_time(when)
                item["branchCommits"] = len(commits)
                item["branchHours"] = hours(min(times), merged)
                item["reviewHours"] = hours(max(times), merged)
                item["tipSubject"] = commits[0].split("\t", 1)[1]
        merges.append(item)
    direct = [line for line in git("log", REV, "--first-parent", "--no-merges", "--format=%H").splitlines() if line.strip()]
    first_parent = [line for line in git("log", REV, "--first-parent", "--format=%H").splitlines() if line.strip()]
    durations = [item["branchHours"] for item in merges if "branchHours" in item]
    reviews = [item["reviewHours"] for item in merges if "reviewHours" in item]

    def dist(values: list[float]) -> dict | None:
        if not values:
            return None
        ordered = sorted(values)
        mid = ordered[len(ordered) // 2]
        p90 = ordered[min(len(ordered) - 1, int(len(ordered) * 0.9))]
        return {"n": len(ordered), "min": ordered[0], "median": mid, "p90": p90, "max": ordered[-1], "sum": round(sum(ordered), 2)}

    return {
        "mergeCommits": len(merges),
        "directFirstParentCommits": len(direct),
        "firstParentCommits": len(first_parent),
        "branchHours": dist(durations),
        "reviewHours": dist(reviews),
        "longest": sorted([item for item in merges if "branchHours" in item], key=lambda item: -item["branchHours"])[:12],
    }


def measure_branches() -> list[dict]:
    code, out, _ = run(["git", "branch", "-a", "--format=%(refname:short)"], check=False)
    names = sorted({line.strip() for line in out.splitlines() if line.strip()})
    rows = []
    for name in names:
        if name in ("main", "origin/main", "origin/HEAD", "origin") or "t31-audit" in name:
            continue
        if not any(part in name for part in ("grok/", "ll-", "site/", "gemini/", "wip/")):
            continue
        ahead = git("rev-list", "--count", f"{REV}..{name}", check=False).strip()
        if not ahead.isdigit() or ahead == "0":
            continue
        subjects = git("log", "--format=%h%x09%cI%x09%s", f"{REV}..{name}", check=False)
        commits = []
        for line in subjects.splitlines():
            if not line.strip():
                continue
            short, when, subject = line.split("\t", 2)
            commits.append({"hash": short, "at": when, "subject": subject})
        rows.append({"branch": name, "ahead": int(ahead), "commits": commits[:20]})
    return rows


def load_board_history() -> list[dict]:
    out = git("log", REV, "--reverse", "--format=%H%x09%cI", "--", "ops/board.json", check=False)
    history = []
    for line in out.splitlines():
        if not line.strip():
            continue
        commit, when = line.split("\t")
        text = show(commit, "ops/board.json")
        if text is None:
            history.append({"commit": commit, "at": when, "error": "missing"})
            continue
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            history.append({"commit": commit, "at": when, "error": str(exc)})
            continue
        tasks = data.get("tasks") or []
        history.append({"commit": commit, "at": when, "tasks": tasks, "updated": data.get("updated")})
    return history


def measure_board(audit_at: datetime) -> dict:
    history = load_board_history()
    good = [item for item in history if "tasks" in item]
    you_open: dict[str, dict] = {}
    you_closed = []
    running_open: dict[str, dict] = {}
    running_sum_hours = 0.0
    you_union_hours = 0.0
    running_union_hours = 0.0
    mismatch_revs = 0
    for index, item in enumerate(good):
        when = parse_time(item["at"])
        nxt = parse_time(good[index + 1]["at"]) if index + 1 < len(good) else audit_at
        span = max(0.0, hours(when, nxt))
        you_ids = set()
        run_ids = set()
        mismatched = 0
        for task in item["tasks"]:
            tid = str(task.get("id") or "")
            section = task.get("section")
            status = task.get("status")
            if section == "done" and status == "running":
                mismatched += 1
            if section == "you" and status == "waiting":
                you_ids.add(tid)
                slot = you_open.get(tid)
                if slot is None:
                    you_open[tid] = {"id": tid, "title": task.get("title"), "since": item["at"], "commit": item["commit"]}
            if section == "now" and status == "running":
                run_ids.add(tid)
                slot = running_open.get(tid)
                if slot is None:
                    running_open[tid] = {"id": tid, "title": task.get("title"), "since": item["at"]}
                running_sum_hours += span
        if you_ids:
            you_union_hours += span
        if run_ids:
            running_union_hours += span
        if mismatched:
            mismatch_revs += 1
        for tid in list(you_open):
            if tid not in you_ids:
                slot = you_open.pop(tid)
                you_closed.append({**slot, "until": item["at"], "hours": hours(parse_time(slot["since"]), when)})
        for tid in list(running_open):
            if tid not in run_ids:
                running_open.pop(tid)
    you_still = []
    for slot in you_open.values():
        you_still.append({**slot, "until": None, "hours": hours(parse_time(slot["since"]), audit_at)})
    final = good[-1]["tasks"] if good else []
    mismatch_now = [
        {"id": task.get("id"), "title": task.get("title"), "status": task.get("status"), "section": task.get("section"), "date": task.get("date")}
        for task in final
        if task.get("section") == "done" and task.get("status") == "running"
    ]
    waiting_chip = [
        {"id": task.get("id"), "section": task.get("section"), "status": task.get("status"), "chip": task.get("chip"), "title": task.get("title")}
        for task in final
        if "ждёт" in str(task.get("chip") or "") or "ждет" in str(task.get("chip") or "")
    ]
    return {
        "revisions": len(good),
        "unparsed": len(history) - len(good),
        "firstAt": good[0]["at"] if good else None,
        "lastAt": good[-1]["at"] if good else None,
        "youClosed": you_closed,
        "youOpen": you_still,
        "youUnionHours": round(you_union_hours, 2),
        "youSumHours": round(sum(item["hours"] for item in you_closed) + sum(item["hours"] for item in you_still), 2),
        "runningUnionHours": round(running_union_hours, 2),
        "runningTaskHours": round(running_sum_hours, 2),
        "revisionsWithDoneButRunning": mismatch_revs,
        "doneButRunningNow": mismatch_now,
        "waitingChipNow": waiting_chip,
        "finalTasks": [
            {"id": task.get("id"), "section": task.get("section"), "status": task.get("status"), "worktree": task.get("worktree"), "date": task.get("date")}
            for task in final
        ],
    }


def measure_usage() -> dict:
    ledger = ROOT / "ops" / "usage" / "ledger" / "2026-10.jsonl"
    raw = ledger.read_text(encoding="utf-8").splitlines()
    rows = [json.loads(line) for line in raw if line.strip()]
    kinds = Counter((row.get("agent"), row.get("kind")) for row in rows)
    grok = [row for row in rows if row.get("agent") == "grok" and row.get("kind") == "session"]
    by_session: dict[str, list] = defaultdict(list)
    for row in grok:
        by_session[row["session"]].append(row)
    justified = 0
    duplicate_rows = 0
    decreases = 0
    latest_rows = []
    for items in by_session.values():
        seen = None
        for row in items:
            key = (row.get("totalTokens"), row.get("outputTokens"), row.get("modelCalls"), row.get("turns"))
            if key == seen:
                duplicate_rows += 1
            else:
                justified += 1
                seen = key
            if seen is not None and row.get("totalTokens", 0) < (items[0].get("totalTokens") or 0) and row is not items[0]:
                pass
        peak = max(items, key=lambda row: row.get("totalTokens") or 0)
        if any((row.get("totalTokens") or 0) < (prev.get("totalTokens") or 0) for prev, row in zip(items, items[1:])):
            decreases += 1
        latest_rows.append(peak)
    by_task: dict[str, dict] = {}
    for row in latest_rows:
        slot = by_task.setdefault(row.get("task") or "?", {"sessions": 0, "totalTokens": 0, "outputTokens": 0, "modelCalls": 0, "turns": 0})
        slot["sessions"] += 1
        slot["totalTokens"] += int(row.get("totalTokens") or 0)
        slot["outputTokens"] += int(row.get("outputTokens") or 0)
        slot["modelCalls"] += int(row.get("modelCalls") or 0)
        slot["turns"] += int(row.get("turns") or 0)
    last_ts = parse_time(rows[-1]["ts"])
    window_start = last_ts - timedelta(days=7)
    week_total, week_by_task = grok_window(rows, window_start)
    runs = [row for row in rows if row.get("kind") == "run"]
    quota = [row for row in rows if row.get("kind") == "quota" and row.get("group") == "gemini"]
    quota_series = [
        {"ts": row["ts"], "weekly": row.get("weeklyRemaining"), "five": row.get("fiveHourRemaining"), "reset": row.get("weeklyResetIn")}
        for row in quota
    ]
    resets = 0
    prev_reset = None
    for point in quota_series:
        reset = point["reset"] or ""
        if prev_reset and reset and _reset_hours(reset) > _reset_hours(prev_reset) + 24:
            resets += 1
        if reset:
            prev_reset = reset
    weekly_values = [point["weekly"] for point in quota_series if isinstance(point["weekly"], (int, float))]
    return {
        "file": "ops/usage/ledger/2026-10.jsonl",
        "bytes": ledger.stat().st_size,
        "lines": len(rows),
        "kinds": {f"{agent}:{kind}": count for (agent, kind), count in kinds.items()},
        "firstTs": rows[0]["ts"],
        "lastTs": rows[-1]["ts"],
        "uniqueTs": len({row["ts"] for row in rows}),
        "grokSessions": len(by_session),
        "grokRows": len(grok),
        "grokRowsThatRepeatPreviousTuple": duplicate_rows,
        "grokRowsThatChangeTuple": justified,
        "sessionsWhoseTotalDecreased": decreases,
        "sumOfPeakTotalTokens": sum(int(row.get("totalTokens") or 0) for row in latest_rows),
        "sumOfPeakOutputTokens": sum(int(row.get("outputTokens") or 0) for row in latest_rows),
        "byTask": dict(sorted(by_task.items(), key=lambda item: -item[1]["totalTokens"])),
        "week": {"start": window_start.isoformat(), "end": last_ts.isoformat(), "totalTokens": week_total, "byTask": week_by_task},
        "claudeRows": sum(1 for row in rows if row.get("agent") == "claude"),
        "geminiRuns": runs,
        "geminiQuotaPoints": len(quota_series),
        "geminiWeeklyFirst": weekly_values[0] if weekly_values else None,
        "geminiWeeklyLast": weekly_values[-1] if weekly_values else None,
        "geminiWeeklyMin": min(weekly_values) if weekly_values else None,
        "geminiWeeklyMax": max(weekly_values) if weekly_values else None,
        "geminiWindowResetsDetected": resets,
    }


def _reset_hours(text: str) -> float:
    hours_found = 0.0
    for number, unit in re.findall(r"(\d+)\s*([hdm])", text):
        value = int(number)
        hours_found += value if unit == "h" else value / 60 if unit == "m" else value * 24
    return hours_found


def grok_window(rows: list[dict], start: datetime) -> tuple[int, dict]:
    """Same rule as ops/usage/collect.py grok_window: last snapshot minus the last one before start."""
    per: dict[str, dict] = {}
    for row in rows:
        if row.get("agent") != "grok" or row.get("kind") != "session":
            continue
        when = parse_time(row["ts"])
        rec = per.setdefault(row["session"], {"before": 0, "last": 0, "task": row.get("task"), "active": ""})
        total = int(row.get("totalTokens") or 0)
        if when < start:
            rec["before"] = max(rec["before"], total)
        else:
            rec["last"] = max(rec["last"], total)
            rec["active"] = max(rec["active"], row.get("sessionUpdated") or "")
    total_spent = 0
    by_task: dict[str, int] = {}
    for rec in per.values():
        active = False
        if rec["active"]:
            try:
                stamp = rec["active"][:26]
                if stamp.endswith("Z"):
                    stamp = stamp[:-1]
                active = datetime.fromisoformat(stamp).replace(tzinfo=timezone.utc) >= start
            except ValueError:
                active = True
        spent = max(0, rec["last"] - rec["before"]) if rec["last"] and active else 0
        total_spent += spent
        if spent:
            by_task[rec["task"]] = by_task.get(rec["task"], 0) + spent
    return total_spent, dict(sorted(by_task.items(), key=lambda item: -item[1]))


def measure_blobs() -> dict:
    out = git("ls-tree", "-r", "-l", REV)
    rows = []
    by_ext = defaultdict(lambda: {"files": 0, "bytes": 0})
    by_top = defaultdict(lambda: {"files": 0, "bytes": 0})
    for line in out.splitlines():
        if "\t" not in line:
            continue
        meta, path = line.split("\t", 1)
        parts = meta.split()
        if len(parts) < 4 or parts[3] == "-":
            continue
        size = int(parts[3])
        rows.append({"bytes": size, "path": path})
        ext = Path(path).suffix.lower() or "(none)"
        by_ext[ext]["files"] += 1
        by_ext[ext]["bytes"] += size
        top = path.split("/", 1)[0]
        by_top[top]["files"] += 1
        by_top[top]["bytes"] += size
    rows.sort(key=lambda item: -item["bytes"])
    code, objects, _ = run(["git", "count-objects", "-vH"], check=False)
    tracked_junk = git("ls-files", "*.pyc", "*.pyo", "*~", "*.log", ".DS_Store", check=False)
    return {
        "countObjects": objects.strip() if code == 0 else None,
        "files": len(rows),
        "bytes": sum(item["bytes"] for item in rows),
        "top": rows[:30],
        "byExt": dict(sorted(by_ext.items(), key=lambda item: -item[1]["bytes"])),
        "byTop": dict(sorted(by_top.items(), key=lambda item: -item[1]["bytes"])),
        "trackedJunk": [line for line in tracked_junk.splitlines() if line.strip()],
    }


def line_count_blob(path: str) -> int | None:
    text = show(REV, path)
    if text is None:
        return None
    if text == "":
        return 0
    return text.count("\n") + (0 if text.endswith("\n") else 1)


def measure_docs() -> dict:
    out = git("ls-tree", "-r", "--name-only", REV)
    paths = [line for line in out.splitlines() if line.endswith(".md")]
    per_dir = defaultdict(lambda: {"files": 0, "lines": 0, "bytes": 0})
    interesting = [
        "AGENTS.md", "CLAUDE.md", "GEMINI.md", "README.md",
        "docs/STATUS.md", "docs/BACKLOG.md", "docs/tasks/README.md", "docs/tasks/_executor.md",
        "docs/methodology/README.md", "ops/README.md", "ops/usage/README.md",
        "docs/process/chat-rotation.md", "docs/research/agent-system.md",
    ]
    named = {path: line_count_blob(path) for path in interesting}
    method_lines = 0
    task_lines = 0
    analysis_lines = 0
    for path in paths:
        text = show(REV, path)
        if text is None:
            continue
        lines = text.count("\n") + (0 if text.endswith("\n") or text == "" else 1)
        top = path.split("/", 1)[0]
        if path.startswith("docs/"):
            top = "/".join(path.split("/")[:2])
        per_dir[top]["files"] += 1
        per_dir[top]["lines"] += lines
        per_dir[top]["bytes"] += len(text.encode("utf-8"))
        if path.startswith("docs/methodology/") and path.endswith(".md"):
            method_lines += lines
        if path.startswith("docs/tasks/") and path.endswith(".md"):
            task_lines += lines
        if path.startswith("docs/analysis/") and path.endswith(".md"):
            analysis_lines += lines
    must = ["AGENTS.md", "docs/STATUS.md", "docs/BACKLOG.md", "docs/tasks/README.md", "docs/tasks/_executor.md"]
    return {
        "namedLines": named,
        "mustReadLines": sum(named[path] or 0 for path in must),
        "methodologyLines": method_lines,
        "taskBriefLines": task_lines,
        "analysisMarkdownLines": analysis_lines,
        "byDir": dict(sorted(per_dir.items(), key=lambda item: -item[1]["lines"])),
    }


def measure_duplicates() -> list[dict]:
    roots = ["AGENTS.md", "README.md", "docs/STATUS.md", "docs/BACKLOG.md", "docs/tasks", "docs/methodology", "ops"]
    paragraphs: dict[str, list] = defaultdict(list)
    out = git("ls-tree", "-r", "--name-only", REV)
    for path in out.splitlines():
        if not path.endswith(".md"):
            continue
        if not any(path == root or path.startswith(root.rstrip("/") + "/") or path.startswith(root) for root in roots):
            continue
        if path.startswith("docs/analysis/"):
            continue
        text = show(REV, path)
        if not text:
            continue
        line_no = 1
        for block in re.split(r"\n\s*\n", text):
            block_lines = block.count("\n") + 1
            norm = re.sub(r"\s+", " ", block).strip()
            if len(norm) >= 280:
                digest = hashlib.sha1(norm.encode("utf-8")).hexdigest()[:12]
                paragraphs[digest].append({"path": path, "line": line_no, "text": norm[:220]})
            line_no += block_lines
    groups = []
    for digest, places in paragraphs.items():
        files = {place["path"] for place in places}
        if len(files) < 2:
            continue
        groups.append({"id": digest, "files": len(files), "copies": len(places), "places": places[:8], "text": places[0]["text"]})
    groups.sort(key=lambda item: (-item["files"], -item["copies"]))
    return groups[:25]


def measure_zero_refs() -> list[dict]:
    """Files whose basename is not mentioned anywhere else in the origin/main tree.

    A directory that is loaded by a glob can still show up here. The report
    treats this list as candidates, not as a delete order.
    """
    out = git("ls-tree", "-r", "--name-only", REV)
    paths = [line for line in out.splitlines() if line.strip()]
    corpus_parts = []
    for path in paths:
        if Path(path).suffix.lower() not in TEXT_EXT:
            continue
        text = show(REV, path)
        if text is None or len(text) > 2_000_000:
            continue
        corpus_parts.append(text)
    corpus = "\n".join(corpus_parts)
    candidates = []
    for path in paths:
        suffix = Path(path).suffix.lower()
        if suffix not in {".py", ".ts", ".tsx", ".mjs", ".sh"}:
            continue
        base = Path(path).name
        hits = corpus.count(base)
        own = 0
        own_text = show(REV, path) or ""
        own = own_text.count(base)
        others = hits - own
        if others <= 0:
            candidates.append({"path": path, "basenameHitsElsewhere": others})
    return candidates


def measure_tests() -> dict:
    out = git("ls-tree", "-r", "--name-only", REV)
    paths = [line for line in out.splitlines() if line.strip()]
    tests = [
        path for path in paths
        if re.search(r"\.test\.tsx?$|test_.*\.py$|/tests/", path)
    ]
    package = show(REV, "package.json") or ""
    workflows = []
    for path in paths:
        if path.startswith(".github/workflows/") and path.endswith(".yml"):
            workflows.append((path, show(REV, path) or ""))
    wired = []
    for path in tests:
        base = Path(path).name
        in_pkg = base in package or path in package
        in_ci = [name for name, text in workflows if base in text or path in text]
        wired.append({"path": path, "inPackageJson": in_pkg, "workflows": in_ci})
    script_block = re.search(r'"scripts"\s*:\s*\{.*?\}', package, re.S)
    return {"files": wired, "packageScripts": script_block.group(0) if script_block else ""}


def measure_actions() -> dict:
    code, out, err = run([
        "gh", "run", "list", "--limit", "300",
        "--json", "databaseId,name,displayTitle,status,conclusion,createdAt,updatedAt,headBranch,event,workflowName",
    ], check=False)
    if code != 0:
        return {"error": (err or out)[:500]}
    runs = json.loads(out)
    summary = Counter((row["workflowName"], row["conclusion"]) for row in runs)
    enriched = []
    for row in runs:
        start = parse_time(row["createdAt"])
        end = parse_time(row["updatedAt"])
        enriched.append({**row, "minutes": round((end - start).total_seconds() / 60, 1)})
    by_workflow = {}
    for row in enriched:
        slot = by_workflow.setdefault(row["workflowName"], {"runs": 0, "minutes": 0.0, "byConclusion": Counter()})
        slot["runs"] += 1
        slot["minutes"] += row["minutes"]
        slot["byConclusion"][row["conclusion"]] += 1
    for slot in by_workflow.values():
        slot["minutes"] = round(slot["minutes"], 1)
        slot["byConclusion"] = dict(slot["byConclusion"])
    long_cancel = [compact_run(row) for row in enriched if row["conclusion"] == "cancelled" and row["minutes"] >= 20]
    short_cancel = [row for row in enriched if row["conclusion"] == "cancelled" and row["minutes"] < 2]
    failures = [compact_run(row) for row in enriched if row["conclusion"] == "failure"]
    overlap = overlap_minutes(enriched)
    return {
        "runs": len(enriched),
        "from": min(row["createdAt"] for row in enriched) if enriched else None,
        "to": max(row["createdAt"] for row in enriched) if enriched else None,
        "byWorkflow": by_workflow,
        "summary": {f"{name}:{conclusion}": count for (name, conclusion), count in summary.items()},
        "cancelledUnder2Min": len(short_cancel),
        "cancelledAtLeast20Min": long_cancel,
        "failures": failures,
        "overlapMinutesSameBranch": overlap,
    }


def compact_run(row: dict) -> dict:
    return {
        "id": row["databaseId"],
        "workflow": row["workflowName"],
        "branch": row["headBranch"],
        "conclusion": row["conclusion"],
        "minutes": row["minutes"],
        "createdAt": row["createdAt"],
        "title": row["displayTitle"],
    }


def overlap_minutes(runs: list[dict]) -> list[dict]:
    groups = defaultdict(list)
    for row in runs:
        groups[(row["workflowName"], row["headBranch"])].append(row)
    report = []
    for (workflow, branch), items in groups.items():
        items = sorted(items, key=lambda row: row["createdAt"])
        overlap = 0.0
        for index, row in enumerate(items):
            start = parse_time(row["createdAt"])
            end = parse_time(row["updatedAt"])
            for other in items[index + 1:]:
                other_start = parse_time(other["createdAt"])
                if other_start >= end:
                    break
                other_end = parse_time(other["updatedAt"])
                overlap += (min(end, other_end) - other_start).total_seconds() / 60
        if overlap >= 1:
            report.append({"workflow": workflow, "branch": branch, "overlapMinutes": round(overlap, 1), "runs": len(items)})
    report.sort(key=lambda item: -item["overlapMinutes"])
    return report


def measure_churn() -> dict:
    paths = [
        "AGENTS.md", "docs/STATUS.md", "docs/BACKLOG.md", "ops/board.json",
        "docs/methodology", "docs/tasks", "ops/usage/ledger",
    ]
    rows = {}
    for path in paths:
        commits = [line for line in git("log", REV, "--format=%H", "--", path, check=False).splitlines() if line.strip()]
        rows[path] = len(commits)
    authors = Counter()
    for line in git("log", REV, "--format=%an").splitlines():
        if line.strip():
            authors[line.strip()] += 1
    days = Counter()
    for line in git("log", REV, "--format=%ad", "--date=short").splitlines():
        if line.strip():
            days[line.strip()] += 1
    phrases = {}
    for phrase in ("LL · Main", "LL · Site", "оркестратор"):
        code, out, _ = run(["git", "grep", "-l", "-I", phrase, REV, "--", "*.md"], check=False)
        phrases[phrase] = sorted(line.split(":", 1)[-1] for line in out.splitlines() if line.strip()) if code == 0 else []
    return {"commitsTouching": rows, "authors": dict(authors), "commitsByDay": dict(sorted(days.items())), "phraseFiles": phrases}


def measure_mentions() -> dict:
    code, out, _ = run(["git", "grep", "-n", "-I", "-E", r"раунд|Round [0-9]|Дополнение|заново", REV, "--", "*.md"], check=False)
    hits = []
    if code == 0:
        for line in out.splitlines():
            if "docs/analysis/" in line or "docs/research/repo-audit" in line:
                continue
            hits.append(line.split(":", 1)[-1][:240])
    return {"roundAndRedoLines": hits[:80], "roundAndRedoCount": len(hits)}


def main() -> None:
    audit_at = commit_time(REV)
    head = git("rev-parse", "HEAD").strip()
    main_rev = git("rev-parse", REV).strip()
    diff = git("diff", "--stat", head, main_rev, check=False)
    facts = {
        "generatedBy": "docs/research/repo-audit/measure.py",
        "head": head,
        "originMain": main_rev,
        "auditClock": audit_at.isoformat(),
        "diffHeadToOriginMain": diff.strip(),
        "tasks": measure_tasks(audit_at),
        "merges": measure_merges(),
        "unmergedBranches": measure_branches(),
        "board": measure_board(audit_at),
        "usage": measure_usage(),
        "blobs": measure_blobs(),
        "docs": measure_docs(),
        "duplicateParagraphs": measure_duplicates(),
        "zeroBasenameRefs": measure_zero_refs(),
        "tests": measure_tests(),
        "actions": measure_actions(),
        "churn": measure_churn(),
        "mentions": measure_mentions(),
    }
    OUT.write_text(json.dumps(facts, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    usage = facts["usage"]
    actions = facts["actions"]
    print(f"wrote {OUT.relative_to(ROOT)}")
    print(f"audit {facts['originMain'][:12]} clock {facts['auditClock']}")
    print(f"ledger lines {usage['lines']} sessions {usage['grokSessions']} duplicateRows {usage['grokRowsThatRepeatPreviousTuple']} changeRows {usage['grokRowsThatChangeTuple']}")
    print(f"peak tokens {usage['sumOfPeakTotalTokens']} week tokens {usage['week']['totalTokens']}")
    print(f"actions {actions.get('runs')} overlap groups {len(actions.get('overlapMinutesSameBranch') or [])}")
    briefs = [row for row in facts["tasks"]["tasks"] if row.get("brief")]
    print(f"briefs {len(briefs)} of 30; marked {sum(1 for row in briefs if row.get('marked'))}")
    print(f"done-but-running now {len(facts['board']['doneButRunningNow'])}")
    print(f"you open {facts['board']['youOpen']}")


if __name__ == "__main__":
    main()
