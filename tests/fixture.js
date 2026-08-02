'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function buildFixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-fixture-'));
  const claude = path.join(home, '.claude');

  const realProject = path.join(home, 'real-project');
  fs.mkdirSync(realProject, { recursive: true });
  const deadProject = path.join(home, 'gone-project');

  write(
    path.join(home, '.claude.json'),
    JSON.stringify({
      mcpServers: { alpha: {} },
      projects: { [realProject]: {}, [deadProject]: {} },
    })
  );
  write(path.join(home, '.claude.json.backup-old'), '{}');

  write(
    path.join(claude, 'settings.json'),
    JSON.stringify({
      enableAllProjectMcpServers: true,
      enabledPlugins: { 'good@mp': true },
      skillOverrides: { hidden: 'off' },
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: 'echo hello' }] },
          { hooks: [{ type: 'command', command: 'echo hello' }] },
        ],
      },
    })
  );

  write(
    path.join(claude, 'plugins', 'installed_plugins.json'),
    JSON.stringify({ plugins: { 'good@mp': {}, 'thing@casedmp': {} } })
  );
  write(path.join(claude, 'plugins', 'cache', 'mp', 'good', 'f.txt'), 'x');
  write(path.join(claude, 'plugins', 'cache', 'mp', 'orphan-plugin', 'f.txt'), 'x');
  write(path.join(claude, 'plugins', 'cache', 'deadmp', 'thing', 'f.txt'), 'x');
  write(path.join(claude, 'plugins', 'cache', 'temp_git_123', 'f.txt'), 'x');
  write(path.join(claude, 'plugins', 'marketplaces', 'mp', 'f.txt'), 'x');
  write(path.join(claude, 'plugins', 'marketplaces', 'deadmp', 'f.txt'), 'x');
  write(path.join(claude, 'plugins', 'marketplaces', 'CasedMp', 'f.txt'), 'x');

  const oldFile = path.join(claude, 'file-history', 'old.snapshot');
  write(oldFile, 'x');
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000);
  fs.utimesSync(oldFile, ninetyDaysAgo, ninetyDaysAgo);
  write(path.join(claude, 'file-history', 'fresh.snapshot'), 'x');

  const slugOf = (p) => p.replace(/[^A-Za-z0-9]/g, '-');
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000);
  const ageTree = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) ageTree(full);
      fs.utimesSync(full, sixtyDaysAgo, sixtyDaysAgo);
    }
    fs.utimesSync(dir, sixtyDaysAgo, sixtyDaysAgo);
  };
  write(path.join(claude, 'projects', slugOf(realProject), 'transcript.jsonl'), '{}');
  const movedRepoSlug = path.join(claude, 'projects', '-moved-repo-old-path');
  write(path.join(movedRepoSlug, 'memory', 'MEMORY.md'), '# Memory Index\n- alive');
  write(path.join(movedRepoSlug, 'transcript.jsonl'), '{}');
  ageTree(movedRepoSlug);
  write(path.join(claude, 'projects', '-dead-no-memory', 'transcript.jsonl'), '{}');
  ageTree(path.join(claude, 'projects', '-dead-no-memory'));
  write(path.join(claude, 'projects', '-dead-but-recent', 'transcript.jsonl'), '{}');

  const memDir = path.join(claude, 'projects', slugOf(realProject), 'memory');
  write(path.join(memDir, 'MEMORY.md'), '# Memory Index\n- entry\n');
  write(path.join(memDir, 'huge-topic.md'), 'x'.repeat(15 * 1024));

  return { home, claude };
}

module.exports = { buildFixture };
