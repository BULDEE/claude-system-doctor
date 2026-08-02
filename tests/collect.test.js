'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildFixture } = require('./fixture');

const COLLECT = path.join(__dirname, '..', 'scripts', 'collect.js');

function runCollect(home) {
  const out = execFileSync(process.execPath, [COLLECT], {
    env: { ...process.env, DOCTOR_HOME: home },
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

test('collect.js on fixture', async (t) => {
  const { home } = buildFixture();
  const report = runCollect(home);

  await t.test('calibration is true without prior state', () => {
    assert.equal(report.calibration, true);
  });

  await t.test('orphan caches: uninstalled plugin dirs and dead marketplaces, never installed ones', () => {
    const paths = report.autoCandidates.orphanCaches.map((o) => o.path);
    assert.ok(paths.some((p) => p.includes(path.join('mp', 'orphan-plugin'))));
    assert.ok(paths.some((p) => p.includes(path.join('cache', 'deadmp'))));
    assert.ok(paths.some((p) => p.includes(path.join('marketplaces', 'deadmp'))));
    assert.ok(!paths.some((p) => p.includes(path.join('mp', 'good'))));
    assert.ok(!paths.some((p) => p.includes(path.join('marketplaces', 'mp'))));
    assert.ok(!paths.some((p) => p.includes('CasedMp')), 'marketplace matching must be case-insensitive');
  });

  await t.test('temp files: temp_git dirs and .claude.json backups', () => {
    const paths = report.autoCandidates.tempFiles.map((o) => o.path);
    assert.ok(paths.some((p) => p.includes('temp_git_123')));
    assert.ok(paths.some((p) => p.includes('.claude.json.backup-old')));
  });

  await t.test('age prune: only files older than retention', () => {
    const paths = report.autoCandidates.agePrune.map((o) => o.path);
    assert.ok(paths.some((p) => p.includes('old.snapshot')));
    assert.ok(!paths.some((p) => p.includes('fresh.snapshot')));
  });

  await t.test('NON-REGRESSION: dead-path project with live memory is REPORT-only, memory flagged', () => {
    const candidates = report.reportOnly.orphanProjectCandidates;
    const moved = candidates.find((c) => c.slug === '-moved-repo-old-path');
    assert.ok(moved, 'moved-repo candidate must be detected');
    assert.equal(moved.hasMemory, true);
    const autoPaths = JSON.stringify(report.autoCandidates);
    assert.ok(!autoPaths.includes('-moved-repo-old-path'), 'must never appear in autoCandidates');
    assert.ok(!autoPaths.includes(path.join('.claude', 'projects')), 'no projects path in autoCandidates at all');
  });

  await t.test('active project dir is not an orphan candidate', () => {
    const slugs = report.reportOnly.orphanProjectCandidates.map((c) => c.slug);
    assert.ok(!slugs.some((s) => s.includes('real-project')));
    assert.ok(slugs.includes('-dead-no-memory'));
  });

  await t.test('dead-path dir with RECENT activity is not a candidate (noise guard)', () => {
    const slugs = report.reportOnly.orphanProjectCandidates.map((c) => c.slug);
    assert.ok(!slugs.includes('-dead-but-recent'));
  });

  await t.test('dead .projects entries detected', () => {
    assert.ok(report.reportOnly.deadProjectEntries.some((p) => p.includes('gone-project')));
  });

  await t.test('config drift: duplicated hook command and enableAllProjectMcpServers', () => {
    const drift = report.reportOnly.configDrift;
    assert.deepEqual(drift.fingerprint.duplicatedHookCommands, ['SessionStart: echo hello']);
    assert.equal(drift.enableAllProjectMcpServers, true);
    assert.match(drift.fingerprint.hash, /^[a-f0-9]{64}$/);
  });

  await t.test('memory health: big topic file flagged, index measured', () => {
    assert.ok(report.reportOnly.memory.bigFiles.some((f) => f.path.includes('huge-topic.md')));
    assert.ok(report.reportOnly.memory.indexes.length >= 1);
  });
});
