'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildFixture } = require('./fixture');

const NOTIFY = path.join(__dirname, '..', 'scripts', 'notify.js');

function writeConfig(home, config) {
  const dir = path.join(home, '.claude', 'doctor');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
}

function runNotify(home, args) {
  return execFileSync(process.execPath, [NOTIFY, ...args], {
    env: { ...process.env, DOCTOR_HOME: home },
    encoding: 'utf8',
  });
}

function writeSummary(home, content) {
  const file = path.join(home, 'summary.md');
  fs.writeFileSync(file, content);
  return file;
}

test('notify.js skips cleanly when no webhook is configured', () => {
  const { home } = buildFixture();
  writeConfig(home, { cadence: 'weekly' });
  assert.match(runNotify(home, [writeSummary(home, 'all good')]), /no webhook configured/);
});

test('notify.js skips an empty summary', () => {
  const { home } = buildFixture();
  writeConfig(home, { cadence: 'weekly', webhook_url: 'https://example.invalid/hook' });
  assert.match(runNotify(home, [writeSummary(home, '   \n')]), /empty summary/);
});

test('notify.js never fails the run on delivery error', () => {
  const { home } = buildFixture();
  writeConfig(home, { cadence: 'weekly', webhook_url: 'https://127.0.0.1:1/hook' });
  const out = runNotify(home, [writeSummary(home, 'report')]);
  assert.match(out, /delivery failed|webhook responded/);
});
