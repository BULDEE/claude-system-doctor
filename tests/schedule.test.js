'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildFixture } = require('./fixture');

const SCHEDULE = path.join(__dirname, '..', 'scripts', 'schedule.js');

function runSchedule(home, args) {
  return execFileSync(process.execPath, [SCHEDULE, ...args], {
    env: { ...process.env, DOCTOR_HOME: home },
    encoding: 'utf8',
  });
}

function writeConfig(home, config) {
  const dir = path.join(home, '.claude', 'doctor');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
}

test('schedule.js --print for current platform', async (t) => {
  const { home } = buildFixture();
  writeConfig(home, { cadence: 'weekly', hour: 9 });

  const out = runSchedule(home, ['install', '--print']);

  if (process.platform === 'darwin') {
    await t.test('darwin plist has label, weekday and hour', () => {
      assert.ok(out.includes('com.claude.system-doctor'));
      assert.ok(out.includes('<key>Weekday</key>'));
      assert.ok(out.includes('<integer>9</integer>'));
      assert.ok(out.includes('/system-doctor:audit'));
    });
  } else if (process.platform === 'linux') {
    await t.test('linux cron line has schedule and marker', () => {
      assert.ok(out.includes('0 9 * * 0'));
      assert.ok(out.includes('# claude-system-doctor'));
      assert.ok(out.includes('/system-doctor:audit'));
    });
  } else if (process.platform === 'win32') {
    await t.test('windows schtasks command is weekly sunday', () => {
      assert.ok(out.includes('ClaudeSystemDoctor'));
      assert.ok(out.includes('/sc WEEKLY'));
      assert.ok(out.includes('/system-doctor:audit'));
    });
  }
});

test('schedule.js rejects invalid config', () => {
  const { home } = buildFixture();
  writeConfig(home, { cadence: 'hourly', hour: 9 });
  assert.throws(() => runSchedule(home, ['install', '--print']));
});

test('schedule.js daily and monthly cadences', () => {
  const { home } = buildFixture();
  writeConfig(home, { cadence: 'daily', hour: 6 });
  const daily = runSchedule(home, ['install', '--print']);
  writeConfig(home, { cadence: 'monthly', hour: 6 });
  const monthly = runSchedule(home, ['install', '--print']);
  assert.notEqual(daily, monthly);
});

test('schedule.js bakes an absolute claude path, never a bare command', () => {
  const { home } = buildFixture();
  writeConfig(home, { cadence: 'weekly', hour: 9 });
  const fakeBin = path.join(home, 'fake-claude');
  fs.writeFileSync(fakeBin, '');
  const out = execFileSync(process.execPath, [SCHEDULE, 'install', '--print'], {
    env: { ...process.env, DOCTOR_HOME: home, CLAUDE_BIN: fakeBin },
    encoding: 'utf8',
  });
  assert.ok(out.includes(fakeBin), 'resolved binary path must appear in the entry');
  assert.ok(!/[^/\\"]claude -p/.test(out), 'must not schedule a bare `claude` command');
});

test('schedule.js scopes tool permissions instead of skipping them', () => {
  const { home } = buildFixture();
  writeConfig(home, { cadence: 'weekly', hour: 9 });
  const fakeBin = path.join(home, 'fake-claude');
  fs.writeFileSync(fakeBin, '');
  const out = execFileSync(process.execPath, [SCHEDULE, 'install', '--print'], {
    env: { ...process.env, DOCTOR_HOME: home, CLAUDE_BIN: fakeBin },
    encoding: 'utf8',
  });
  assert.ok(out.includes('--allowedTools'));
  assert.ok(!out.includes('dangerously-skip-permissions'));
});
