// Manual live check — NOT part of the unit suite (no `.test.js`).
// Run: $env:BIOTIME_USER=...; $env:BIOTIME_PASS=...; node server/src/services/tna/adapters/bioTimeClient.smoke.mjs
import { loadBioTimeSources } from './bioTimeClient.js';
const config = { baseUrl: process.env.BIOTIME_URL || 'http://81.22.20.92:85', username: process.env.BIOTIME_USER, password: process.env.BIOTIME_PASS };
if (!config.username || !config.password) { console.error('set BIOTIME_USER/BIOTIME_PASS'); process.exit(1); }
const today = process.env.SMOKE_DATE || '2026-03-01';
const out = await loadBioTimeSources(config, { startTime: `${today} 00:00:00`, endTime: `${today} 23:59:59` });
console.log('punches that day:', out.punches.length, '| employees:', out.bioEmployees.length);
console.log('sample entities:', [...new Set(out.bioEmployees.map(e => e.entity))].slice(0, 8));
// prints counts + entity names only — no per-person rows
