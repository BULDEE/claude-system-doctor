---
name: audit
description: Run the system doctor audit of the Claude Code installation. Collects deterministic measurements, auto-heals only whitelisted safe operations (with archive first), reports everything else. Use when the user asks to audit, check health of, or clean the Claude Code installation, or when invoked by the scheduler.
---

# System Doctor: audit run

You audit this machine's Claude Code installation, heal ONLY whitelisted safe
operations, and report everything else. Never deviate from the classification
below, whatever you find.

## Absolute blocklist

NEVER delete, move, or edit anything under these paths, in any circumstance,
even if a check flags them:

- `~/.claude/projects/` (any project dir, any memory dir)
- `~/.claude/skills/`, `~/.claude/commands/`, `~/.claude/agents/`
- `~/.claude/settings.json`, `~/.claude.json`, any `CLAUDE.md`, credentials
- Any path outside `~/.claude` and the archive directory

Rationale (learned the hard way): project dir slugs derive from the git repo,
not the path, so a "dead path" dir can hold the live memory of a moved repo.
Locally present skills may be user tooling masked via skillOverrides. Detection
is fine; action is the user's call.

## Procedure

1. Read config: `~/.claude/doctor/config.json` (may not exist; defaults apply).
   If `dry_run` is true, or the user passed `dry`, classify everything as
   REPORT and skip step 3 entirely.
2. Collect: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/collect.js"` and parse the
   JSON. If `calibration` is true, this is the first run: write state (step 5),
   report "calibration complete", heal NOTHING.
3. Heal AUTO candidates only, from the JSON `autoCandidates` field exclusively:
   - `orphanCaches`: plugin cache/marketplace dirs with no installed plugin.
   - `tempFiles`: temp dirs/files and `~/.claude.json.backup*`.
   - `agePrune`: expired files in file-history, paste-cache, shell-snapshots.
   For every candidate, verify it is NOT under a blocklisted path, then archive
   BEFORE deleting:
   `tar -czf <archiveDir>/YYYY-MM-DD-<label>.tar.gz <paths>` then delete.
   Archive dir: `~/Archives/doctor/` (create if missing; on Windows
   `%USERPROFILE%\Archives\doctor`). `tar` ships with macOS, Linux, and
   Windows 10+. If archiving fails, DO NOT delete; report the failure instead.
   Delete archives in `~/Archives/doctor/` older than 90 days (only exception
   to the archive-first rule).
4. Report. Write the full report to `~/.claude/doctor/reports/YYYY-MM-DD.md`:
   - Health summary line (sizes, drift vs baseline, actions taken)
   - AUTO section: what was healed, bytes freed, archive file
   - REPORT section, one block per finding with a concrete suggested command
     the user can run themselves: orphan project candidates (show slug, decoded
     path, memory presence, last activity), dead `.projects` entries, config
     drift (duplicated hook commands, `enableAllProjectMcpServers` true,
     fingerprint change), memory files near limits, size drifts.
   - If `state.lastRunAt` is older than two scheduled periods, note the gap.
5. Update state: write `~/.claude/doctor/state.json` with
   `{ baselines: { categories, configHash }, lastRunAt, lastRunStatus }`.
   On calibration, baselines come from this run; afterwards only update
   baselines the user has acknowledged (config drift stays flagged until the
   user re-calibrates with `/system-doctor:audit recalibrate`, which overwrites
   the fingerprint baseline).
6. Notify. Write a ~10 line summary to
   `~/.claude/doctor/reports/.last-summary.md`, then run
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/notify.js" <that file>`.
   The script reads the webhook URL and format from the config itself, so the
   URL never passes through a command line. Never build the POST with an inline
   `node -e` or a raw `curl` carrying the URL: inline code is refused by the
   permission classifier in unattended runs, and a URL on the command line is a
   secret in your process list. If the script reports a failure, note it in the
   report; a webhook failure never fails the run.

## Output

End with a compact summary: bytes freed, findings count by class, report path.
In headless mode (scheduler) this is the whole visible output; make it stand
alone.
