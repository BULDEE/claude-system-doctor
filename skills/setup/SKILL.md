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
   - Requires the `claude` CLI on PATH for the scheduled context; on macOS and
     Linux verify with `command -v claude`, on Windows `where claude`. If
     missing, warn and point to the docs instead of installing a broken job.
4. Propose the calibration run now: `/system-doctor:audit` (first run measures
   baselines and heals nothing). Recommend reviewing that first report before
   trusting scheduled runs.
