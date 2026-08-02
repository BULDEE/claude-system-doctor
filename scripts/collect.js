#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const HOME = process.env.DOCTOR_HOME || os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const CLAUDE_JSON = path.join(HOME, '.claude.json');
const DOCTOR_DIR = path.join(CLAUDE_DIR, 'doctor');

const DEFAULTS = { drift_threshold_pct: 20, retention_days: 30, memory_big_file_kb: 10 };

const SIZE_CATEGORIES = [
  'plugins/cache',
  'plugins/marketplaces',
  'projects',
  'skills',
  'file-history',
  'paste-cache',
  'shell-snapshots',
  'knowledge',
  'backups',
  'cache',
];

const TEMP_PATTERNS = [/^temp_git_/, /^temp_subdir_/, /^temp_\d+$/, /\.tmp$/, /\.bak$/];
const AGE_PRUNE_DIRS = ['file-history', 'paste-cache', 'shell-snapshots'];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function dirSize(dir) {
  let total = 0;
  let stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) stack.push(full);
      else {
        try {
          total += fs.statSync(full).size;
        } catch {}
      }
    }
  }
  return total;
}

function newestMtimeMs(dir) {
  let newest = 0;
  let stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs > newest) newest = st.mtimeMs;
        if (entry.isDirectory()) stack.push(full);
      } catch {}
    }
  }
  return newest;
}

function listDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function slugOf(projectPath) {
  return projectPath.replace(/[^A-Za-z0-9]/g, '-');
}

function collectSizes() {
  const categories = {};
  for (const cat of SIZE_CATEGORIES) {
    categories[cat] = dirSize(path.join(CLAUDE_DIR, cat));
  }
  categories.total = dirSize(CLAUDE_DIR);
  return categories;
}

function collectOrphanCaches(installed) {
  const active = new Set();
  for (const key of Object.keys(installed)) {
    const [plugin, marketplace] = key.split('@');
    if (plugin && marketplace) active.add(`${marketplace}/${plugin}`.toLowerCase());
  }
  const orphans = [];
  const cacheRoot = path.join(CLAUDE_DIR, 'plugins', 'cache');
  for (const marketplace of listDirs(cacheRoot)) {
    const marketplaceDir = path.join(cacheRoot, marketplace);
    for (const plugin of listDirs(marketplaceDir)) {
      if (!active.has(`${marketplace}/${plugin}`.toLowerCase())) {
        const full = path.join(marketplaceDir, plugin);
        orphans.push({ path: full, bytes: dirSize(full) });
      }
    }
  }
  const marketplaceRoot = path.join(CLAUDE_DIR, 'plugins', 'marketplaces');
  const activeMarketplaces = new Set([...active].map((k) => k.split('/')[0]));
  for (const marketplace of listDirs(marketplaceRoot)) {
    if (!activeMarketplaces.has(marketplace.toLowerCase()) && !TEMP_PATTERNS.some((p) => p.test(marketplace))) {
      const full = path.join(marketplaceRoot, marketplace);
      orphans.push({ path: full, bytes: dirSize(full) });
    }
  }
  return orphans;
}

function collectTempFiles() {
  const found = [];
  const roots = [path.join(CLAUDE_DIR, 'plugins'), path.join(CLAUDE_DIR, 'plugins', 'cache'), path.join(CLAUDE_DIR, 'plugins', 'marketplaces'), CLAUDE_DIR];
  for (const root of roots) {
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (TEMP_PATTERNS.some((p) => p.test(entry.name))) {
        const full = path.join(root, entry.name);
        found.push({ path: full, bytes: entry.isDirectory() ? dirSize(full) : safeSize(full) });
      }
    }
  }
  let homeEntries;
  try {
    homeEntries = fs.readdirSync(HOME);
  } catch {
    homeEntries = [];
  }
  for (const name of homeEntries) {
    if (/^\.claude\.json\.backup/.test(name)) {
      const full = path.join(HOME, name);
      found.push({ path: full, bytes: safeSize(full) });
    }
  }
  return dedupeByPath(found);
}

function safeSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function dedupeByPath(items) {
  const seen = new Set();
  return items.filter((i) => (seen.has(i.path) ? false : (seen.add(i.path), true)));
}

function collectAgePruneCandidates(retentionDays) {
  const cutoff = Date.now() - retentionDays * 86400000;
  const candidates = [];
  for (const dir of AGE_PRUNE_DIRS) {
    const root = path.join(CLAUDE_DIR, dir);
    let stack = [root];
    while (stack.length > 0) {
      const current = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
          continue;
        }
        try {
          const st = fs.statSync(full);
          if (st.mtimeMs < cutoff) candidates.push({ path: full, bytes: st.size });
        } catch {}
      }
    }
  }
  return candidates;
}

function collectOrphanProjects(claudeJson, retentionDays) {
  const projectsRoot = path.join(CLAUDE_DIR, 'projects');
  const knownSlugs = new Set();
  for (const p of Object.keys((claudeJson && claudeJson.projects) || {})) {
    knownSlugs.add(slugOf(p));
  }
  const candidates = [];
  for (const slug of listDirs(projectsRoot)) {
    if (knownSlugs.has(slug)) continue;
    const naiveDecoded = slug.replace(/^-/, path.sep).replace(/-/g, path.sep);
    if (fs.existsSync(naiveDecoded)) continue;
    const full = path.join(projectsRoot, slug);
    const newest = newestMtimeMs(full);
    const staleDays = newest ? Math.round((Date.now() - newest) / 86400000) : null;
    if (staleDays !== null && staleDays <= retentionDays) continue;
    candidates.push({
      slug,
      naiveDecodedPath: naiveDecoded,
      hasMemory: fs.existsSync(path.join(full, 'memory')),
      newestActivityDays: staleDays,
      bytes: dirSize(full),
    });
  }
  return candidates;
}

function collectConfigFingerprint(settings, claudeJson) {
  const hookCommands = [];
  const duplicatedHookCommands = [];
  for (const [event, eventEntries] of Object.entries((settings && settings.hooks) || {})) {
    const inEvent = [];
    for (const matcherEntry of eventEntries) {
      for (const hook of matcherEntry.hooks || []) {
        if (!hook.command) continue;
        hookCommands.push(`${event}:${hook.command}`);
        if (inEvent.includes(hook.command)) duplicatedHookCommands.push(`${event}: ${hook.command}`);
        inEvent.push(hook.command);
      }
    }
  }
  const material = {
    enableAllProjectMcpServers: Boolean(settings && settings.enableAllProjectMcpServers),
    enabledPlugins: Object.entries((settings && settings.enabledPlugins) || {})
      .filter(([, v]) => v === true)
      .map(([k]) => k)
      .sort(),
    skillOverrideCount: Object.keys((settings && settings.skillOverrides) || {}).length,
    hookCommands: hookCommands.sort(),
    mcpServers: Object.keys((claudeJson && claudeJson.mcpServers) || {}).sort(),
  };
  return {
    material,
    hash: crypto.createHash('sha256').update(JSON.stringify(material)).digest('hex'),
    duplicatedHookCommands,
  };
}

function collectDeadProjectEntries(claudeJson) {
  return Object.keys((claudeJson && claudeJson.projects) || {}).filter((p) => !fs.existsSync(p));
}

function collectMemoryHealth(bigFileKb) {
  const result = { indexes: [], bigFiles: [] };
  const projectsRoot = path.join(CLAUDE_DIR, 'projects');
  for (const slug of listDirs(projectsRoot)) {
    const memDir = path.join(projectsRoot, slug, 'memory');
    if (!fs.existsSync(memDir)) continue;
    const indexPath = path.join(memDir, 'MEMORY.md');
    if (fs.existsSync(indexPath)) {
      const content = fs.readFileSync(indexPath, 'utf8');
      result.indexes.push({
        path: indexPath,
        lines: content.split('\n').length,
        bytes: Buffer.byteLength(content),
        nearLimit: content.split('\n').length > 160 || Buffer.byteLength(content) > 20000,
      });
    }
    let entries;
    try {
      entries = fs.readdirSync(memDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || entry.name === 'MEMORY.md') continue;
      const full = path.join(memDir, entry.name);
      const bytes = safeSize(full);
      if (bytes > bigFileKb * 1024) result.bigFiles.push({ path: full, bytes });
    }
  }
  return result;
}

function computeDeltas(categories, state, thresholdPct) {
  const baseline = (state && state.baselines && state.baselines.categories) || null;
  if (!baseline) return { calibration: true, drifts: [] };
  const drifts = [];
  for (const [cat, bytes] of Object.entries(categories)) {
    const base = baseline[cat];
    if (!base || base < 1024 * 1024) continue;
    const pct = Math.round(((bytes - base) / base) * 100);
    if (pct > thresholdPct) drifts.push({ category: cat, baselineBytes: base, currentBytes: bytes, driftPct: pct });
  }
  return { calibration: false, drifts };
}

function main() {
  const config = { ...DEFAULTS, ...(readJson(path.join(DOCTOR_DIR, 'config.json')) || {}) };
  const state = readJson(path.join(DOCTOR_DIR, 'state.json'));
  const settings = readJson(path.join(CLAUDE_DIR, 'settings.json'));
  const claudeJson = readJson(CLAUDE_JSON);
  const installed = (readJson(path.join(CLAUDE_DIR, 'plugins', 'installed_plugins.json')) || {}).plugins || {};

  const categories = collectSizes();
  const fingerprint = collectConfigFingerprint(settings, claudeJson);
  const previousHash = state && state.baselines && state.baselines.configHash;

  const report = {
    version: 1,
    timestamp: new Date().toISOString(),
    home: HOME,
    config,
    calibration: !state,
    categories,
    sizeDrift: computeDeltas(categories, state, config.drift_threshold_pct),
    autoCandidates: {
      orphanCaches: collectOrphanCaches(installed),
      tempFiles: collectTempFiles(),
      agePrune: collectAgePruneCandidates(config.retention_days),
    },
    reportOnly: {
      orphanProjectCandidates: collectOrphanProjects(claudeJson, config.retention_days),
      deadProjectEntries: collectDeadProjectEntries(claudeJson),
      configDrift: {
        fingerprint,
        changedSinceBaseline: Boolean(previousHash && previousHash !== fingerprint.hash),
        enableAllProjectMcpServers: Boolean(settings && settings.enableAllProjectMcpServers),
      },
      memory: collectMemoryHealth(config.memory_big_file_kb),
    },
    lastRun: state ? { at: state.lastRunAt, status: state.lastRunStatus } : null,
  };

  process.stdout.write(JSON.stringify(report, null, 2));
}

main();
