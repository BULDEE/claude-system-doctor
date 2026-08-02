#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, execSync } = require('child_process');

const HOME = process.env.DOCTOR_HOME || os.homedir();
const DOCTOR_DIR = path.join(HOME, '.claude', 'doctor');
const LOG_FILE = path.join(DOCTOR_DIR, 'runs.log');
const MARKER = 'claude-system-doctor';
const LABEL = 'com.claude.system-doctor';
const TASK_NAME = 'ClaudeSystemDoctor';

function loadConfig() {
  const file = path.join(DOCTOR_DIR, 'config.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cadence = config.cadence || 'weekly';
  const hour = Number.isInteger(config.hour) ? config.hour : 9;
  if (!['daily', 'weekly', 'monthly'].includes(cadence)) {
    throw new Error(`invalid cadence: ${cadence}`);
  }
  if (hour < 0 || hour > 23) throw new Error(`invalid hour: ${hour}`);
  return { cadence, hour };
}

function runCommand() {
  return `claude -p "/system-doctor:audit" --output-format json >> "${LOG_FILE}" 2>&1`;
}

function darwinPlist({ cadence, hour }) {
  const interval = { Hour: hour, Minute: 0 };
  if (cadence === 'weekly') interval.Weekday = 0;
  if (cadence === 'monthly') interval.Day = 1;
  const intervalXml = Object.entries(interval)
    .map(([k, v]) => `      <key>${k}</key>\n      <integer>${v}</integer>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/sh</string>
      <string>-c</string>
      <string>cd "$HOME" &amp;&amp; ${runCommand().replace(/&/g, '&amp;')}</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
${intervalXml}
    </dict>
  </dict>
</plist>
`;
}

function linuxCronLine({ cadence, hour }) {
  const schedule = { daily: `0 ${hour} * * *`, weekly: `0 ${hour} * * 0`, monthly: `0 ${hour} 1 * *` }[cadence];
  return `${schedule} cd "$HOME" && ${runCommand()} # ${MARKER}`;
}

function windowsArgs({ cadence, hour }) {
  const st = `${String(hour).padStart(2, '0')}:00`;
  const base = ['/create', '/f', '/tn', TASK_NAME, '/st', st, '/tr', `cmd /c cd /d %USERPROFILE% && ${runCommand()}`];
  if (cadence === 'daily') return [...base, '/sc', 'DAILY'];
  if (cadence === 'weekly') return [...base, '/sc', 'WEEKLY', '/d', 'SUN'];
  return [...base, '/sc', 'MONTHLY', '/d', '1'];
}

function plistPath() {
  return path.join(HOME, 'Library', 'LaunchAgents', `${LABEL}.plist`);
}

function currentCrontab() {
  try {
    return execSync('crontab -l', { encoding: 'utf8' });
  } catch {
    return '';
  }
}

function writeCrontab(content) {
  execSync('crontab -', { input: content });
}

function install(config, print) {
  fs.mkdirSync(DOCTOR_DIR, { recursive: true });
  if (process.platform === 'darwin') {
    const plist = darwinPlist(config);
    if (print) return void process.stdout.write(plist);
    fs.mkdirSync(path.dirname(plistPath()), { recursive: true });
    fs.writeFileSync(plistPath(), plist);
    try {
      execFileSync('launchctl', ['unload', plistPath()], { stdio: 'ignore' });
    } catch {}
    execFileSync('launchctl', ['load', plistPath()]);
    return void console.log(`installed: ${plistPath()}`);
  }
  if (process.platform === 'linux') {
    const line = linuxCronLine(config);
    if (print) return void console.log(line);
    const kept = currentCrontab()
      .split('\n')
      .filter((l) => l.trim() !== '' && !l.includes(MARKER));
    writeCrontab([...kept, line, ''].join('\n'));
    return void console.log('installed: user crontab entry');
  }
  if (process.platform === 'win32') {
    const args = windowsArgs(config);
    if (print) return void console.log(`schtasks ${args.join(' ')}`);
    execFileSync('schtasks', args);
    return void console.log(`installed: scheduled task ${TASK_NAME}`);
  }
  throw new Error(`unsupported platform: ${process.platform}`);
}

function remove(print) {
  if (process.platform === 'darwin') {
    if (print) return void console.log(`launchctl unload ${plistPath()} && rm ${plistPath()}`);
    try {
      execFileSync('launchctl', ['unload', plistPath()], { stdio: 'ignore' });
    } catch {}
    fs.rmSync(plistPath(), { force: true });
    return void console.log('removed: launchd agent');
  }
  if (process.platform === 'linux') {
    if (print) return void console.log(`crontab filtered on marker ${MARKER}`);
    const kept = currentCrontab()
      .split('\n')
      .filter((l) => l.trim() !== '' && !l.includes(MARKER));
    writeCrontab([...kept, ''].join('\n'));
    return void console.log('removed: crontab entry');
  }
  if (process.platform === 'win32') {
    if (print) return void console.log(`schtasks /delete /f /tn ${TASK_NAME}`);
    execFileSync('schtasks', ['/delete', '/f', '/tn', TASK_NAME]);
    return void console.log(`removed: scheduled task ${TASK_NAME}`);
  }
  throw new Error(`unsupported platform: ${process.platform}`);
}

function main() {
  const action = process.argv[2];
  const print = process.argv.includes('--print');
  if (action === 'install') return install(loadConfig(), print);
  if (action === 'remove') return remove(print);
  console.error('usage: schedule.js <install|remove> [--print]');
  process.exit(1);
}

main();
