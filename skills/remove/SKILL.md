---
name: remove
description: Uninstall the system doctor scheduler (launchd, cron or schtasks entry). Keeps config, state, reports and archives. Use when the user wants to disable, unschedule or uninstall the system doctor.
---

# System Doctor: remove

Unregister the scheduled run. Nothing else is deleted.

1. Show what will be removed:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/schedule.js" remove --print`
2. On confirmation: `node "${CLAUDE_PLUGIN_ROOT}/scripts/schedule.js" remove`
3. Tell the user what remains on disk (config, state, reports, archives under
   `~/.claude/doctor/` and `~/Archives/doctor/`) and that `/system-doctor:audit`
   still works manually. To wipe those too, they can delete the two directories
   themselves.
