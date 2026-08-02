#!/usr/bin/env node
'use strict';

// Posts a run summary to the configured webhook. A dedicated script rather than
// an inline `node -e` call: inline code is arbitrary execution and is correctly
// refused by the permission classifier in an unattended run.
// Usage: node notify.js <summary-file>   (or pipe the summary on stdin)

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = process.env.DOCTOR_HOME || os.homedir();
const CONFIG = path.join(HOME, '.claude', 'doctor', 'config.json');
const MAX_CHARS = 1800;

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  } catch {
    return null;
  }
}

function readSummary() {
  const file = process.argv[2];
  if (file) return fs.readFileSync(file, 'utf8');
  return fs.readFileSync(0, 'utf8');
}

async function main() {
  const config = readConfig();
  if (!config || !config.webhook_url) {
    console.log('notify: no webhook configured, skipped');
    return;
  }
  let summary = readSummary().trim();
  if (!summary) {
    console.log('notify: empty summary, skipped');
    return;
  }
  if (summary.length > MAX_CHARS) summary = `${summary.slice(0, MAX_CHARS)}\n...(truncated)`;

  const body =
    config.webhook_format === 'slack' ? { text: summary } : { content: summary };

  try {
    const res = await fetch(config.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.log(`notify: webhook responded ${res.status}`);
      process.exitCode = 0;
      return;
    }
    console.log('notify: delivered');
  } catch (err) {
    // A webhook failure never fails the run.
    console.log(`notify: delivery failed (${err.message})`);
  }
}

main();
