# claude-system-doctor

**Scheduled audit and safe auto-heal for your Claude Code installation.**
macOS, Linux and Windows. Zero dependencies. Nothing destructive without an archive first.

---

## Why this exists

A Claude Code installation degrades quietly. Nothing breaks, so nothing tells you.

This plugin was extracted from a real cleanup session on a heavily used machine
(25 plugins, 15 MCP servers, 4 overlapping memory systems). The audit found
problems that had been silently accumulating for months, and fixing them produced
these **measured** results:

| Metric | Before | After |
|---|---|---|
| `~/.claude` on disk | ~8.0 GB | 4.3 GB |
| Plugin cache | 6.0 GB | 2.1 GB |
| Skill descriptions loaded every session | 900+ | 119 |
| MCP tool schemas in startup context | loaded upfront | 483 tools at **0 tokens** (deferred) |
| Largest single memory file | 38.5 KB | 5.6 KB |
| Global `CLAUDE.md` | 9.5 KB | 4.5 KB |
| Startup context (measured via `/context`) | not baselined | **32k tokens fixed cost** |
| Full first API call (measured, cache creation + read) | not baselined | **50.7k tokens** |

The single biggest win: one plugin was contributing **816 skill descriptions** to
every single session, in every project, forever. Nothing in the interface
surfaces that. You only find it if you go looking.

Other findings from the same session, all of which this plugin now detects
automatically:

- **Plugin caches that re-clone themselves.** Disabling a plugin does not stop
  its marketplace from re-cloning the cache. Two disabled plugins had silently
  restored 1 GB of cache after an earlier manual purge. The only real fix is
  `uninstall` plus `marketplace remove` plus cache removal.
- **Duplicated hooks.** A plugin declared its hooks in its manifest, and its
  install script had also copied them into `settings.json`. Result: every hook
  fired twice, on every session start and on every single message.
- **Dead MCP servers.** A server that no longer connects still costs its slot and
  its instruction block.
- **30 dead project entries** in `~/.claude.json`, pointing at directories that
  had been moved or deleted months earlier.
- **1 GB of data** belonging to a third-party memory tool that had been disabled
  since June and was fully redundant with native auto memory.

None of this is exotic. It is what any actively used installation looks like
after six months. The problem is that auditing it by hand takes an afternoon,
so nobody does it twice.

## What it does not do

This is deliberately not a "clean everything" tool.

The same session that produced these numbers also produced two near misses,
and both are now hard rules in this plugin:

1. **A project directory whose path no longer exists is not necessarily dead.**
   Project directory names derive from the git repository, not the filesystem
   path. A repository that was moved keeps its original directory name, which
   means a naive "the path is gone, delete it" heuristic would have destroyed
   141 live memory files. Orphan project directories are therefore **report only,
   always**, no matter how confident the heuristic looks.

2. **Local skills that look orphaned may be deliberately hidden.** A directory of
   about 80 personal skills was masked from context via `skillOverrides` while
   remaining fully functional on disk. They look like leftovers. They are not.

So the plugin splits every finding into two classes, and the boundary never moves:

- **AUTO**: whitelisted, reversible, archived before removal.
- **REPORT**: everything else, with a suggested command you run yourself.

Hard blocklist, never touched automatically under any circumstance:
`projects/`, `skills/`, `commands/`, `agents/`, any `memory/` directory,
`settings.json`, `~/.claude.json`, any `CLAUDE.md`, credentials.

## Install

```
/plugin marketplace add BULDEE/claude-system-doctor
/plugin install system-doctor@claude-system-doctor
/system-doctor:setup
```

`setup` asks three questions (cadence and hour, report channel, thresholds),
writes `~/.claude/doctor/config.json`, shows you exactly what will be registered
with your operating system's scheduler, and installs it only after you confirm.

The first run is a **calibration run**: it measures baselines and heals nothing.
Review that first report before trusting scheduled runs.

## Commands

| Command | Effect |
|---|---|
| `/system-doctor:audit` | Run the audit now |
| `/system-doctor:audit dry` | Report only, no healing, whatever the config says |
| `/system-doctor:audit recalibrate` | Accept the current configuration as the new baseline |
| `/system-doctor:setup` | Configure and schedule |
| `/system-doctor:remove` | Unregister the scheduler, keep reports and archives |

## Checks

| Check | Class |
|---|---|
| Plugin caches and marketplaces with no matching installed plugin | AUTO |
| Temp artifacts (`temp_git_*`, `temp_subdir_*`, `*.tmp`, `*.bak`, `.claude.json.backup*`) | AUTO |
| Expired files in `file-history/`, `paste-cache/`, `shell-snapshots/` | AUTO |
| Size drift per category against baseline | REPORT |
| Orphan project directories | REPORT, always |
| Dead project entries in `~/.claude.json` | REPORT |
| Config drift: duplicated hooks, `enableAllProjectMcpServers`, fingerprint change | REPORT |
| `MEMORY.md` near its 200 line / 25 KB load limit, oversized topic files | REPORT |
| MCP servers failing to connect | REPORT |

Config drift works by fingerprint, not by hardcoded rules: the first run captures
what your configuration looks like, and later runs flag what changed. That makes
it portable to any machine without knowing anything about your setup in advance.

## Safety model

- Every AUTO deletion is preceded by a timestamped `tar.gz` in `~/Archives/doctor/`
  (`%USERPROFILE%\Archives\doctor` on Windows), kept for 90 days.
- If archiving fails, the deletion does not happen. The failure goes in the report.
- The collector script is strictly read only. It measures and classifies; it never
  deletes. All actions are taken by the skill, under the blocklist.
- A webhook failure never fails a run.
- If a scheduled run is missed, the next run detects the gap and says so.

## Reports

Full report per run in `~/.claude/doctor/reports/YYYY-MM-DD.md`, run log in
`~/.claude/doctor/runs.log`. If you configure a webhook (Discord or Slack), a
ten line summary is pushed there so you do not have to go looking.

## How it works

```
scheduler (launchd / cron / schtasks)
   └─> claude -p "/system-doctor:audit"
          └─> node scripts/collect.js      read only, emits JSON
                 └─> skill classifies      AUTO vs REPORT, blocklist enforced
                        ├─> archive + heal AUTO candidates
                        ├─> write report
                        ├─> update baselines
                        └─> optional webhook summary
```

Node is used for everything rather than shell scripts, because Claude Code ships
on Node: it is guaranteed present on all three platforms, and one implementation
produces identical results everywhere. The scheduler layer is the only
platform-specific code (`launchd` plist, user `crontab` entry, `schtasks` task),
and it has a `--print` mode so you can see exactly what will be registered before
anything touches your system.

## Development

```
npm test
```

Zero runtime dependencies. Tests run the collectors against a disposable fixture
tree via the `DOCTOR_HOME` environment variable, so nothing touches your real
installation. CI runs the suite on macOS, Linux and Windows.

The suite includes a permanent non-regression test for the failure mode described
above: a project directory whose decoded path is gone but whose `memory/`
directory is alive must be classified REPORT, and no path under `projects/` may
ever appear in the AUTO candidate set.

## License

MIT
