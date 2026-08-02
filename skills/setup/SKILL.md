---
name: setup
description: Install and schedule the system doctor - interactive configuration of cadence, report channel and thresholds, then registers the OS scheduler (launchd, cron or schtasks). Use when the user wants to install, enable, schedule or reconfigure the system doctor.
---

# System Doctor: setup

Configure the doctor and register the scheduled run. Ask, write config, install
the scheduler, propose a calibration run.

## Steps

1. Ask the user (one question at a time, with defaults):
   - Cadence: daily / weekly (default) / monthly, and the hour (default 9).
   - Report channel: webhook URL (Discord or Slack), file only (default), or
     none. If a webhook is given, ask which format (`discord` default, `slack`).
   - Thresholds: accept defaults unless the user objects
     (drift 20%, retention 30 days, archive retention 90 days).
2. Write `~/.claude/doctor/config.json`:
   ```json
   {
     "cadence": "weekly",
     "hour": 9,
     "webhook_url": null,
     "webhook_format": "discord",
     "drift_threshold_pct": 20,
     "retention_days": 30,
     "dry_run": false
   }
   ```
   Create `~/.claude/doctor/` and `~/.claude/doctor/reports/` if missing.
3. Preview then install the scheduler:
   - `node "${CLAUDE_PLUGIN_ROOT}/scripts/schedule.js" install --print` and show
     the user what will be registered for their OS.
   - On confirmation: `node "${CLAUDE_PLUGIN_ROOT}/scripts/schedule.js" install`.
   - The scheduler resolves the absolute path of the `claude` binary at install
     time, because launchd and cron do not source the login shell: a bare
     `claude` works in your terminal but not in the job. If resolution fails,
     set `CLAUDE_BIN` to the absolute path and run setup again.
   - The scheduled run uses a scoped `--allowedTools` list, not
     `--dangerously-skip-permissions`. Tell the user plainly that the job can
     run `rm` and `tar` unattended, and that what gets removed is governed by
     the audit skill's blocklist rather than by a hard sandbox. If they are not
     comfortable with that, set `dry_run: true` so scheduled runs only report.
4. Propose the calibration run now: `/system-doctor:audit` (first run measures
   baselines and heals nothing). Recommend reviewing that first report before
   trusting scheduled runs.
