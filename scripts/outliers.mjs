// Outlier finder: scrape recent Reels for a list of accounts, score each Reel
// against its own account's median, and write the top N to a CSV.
//
//   node --env-file-if-exists=.env scripts/outliers.mjs                 # scrape via APIFY_TOKEN
//   node scripts/outliers.mjs --input data/intel/raw-2026-10-07.json    # rescore a saved scrape
//
// Flags: --accounts intel/accounts.txt  --out intel/outliers.csv  --per-account 30
//        --top 10  --min-ratio 2  --budget 2  --min-age-days 7  --min-baseline 5
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {deduplicate, median} from '../lib/data.mjs';

const REEL_SCRAPER = 'xMc5Ga1oCONPmWJIa'; // apify/instagram-reel-scraper, same actor the app uses
const DAY = 86400000;

export function parseArgs(argv) {
  const o = {accounts: 'intel/accounts.txt', out: 'intel/outliers.csv', input: null, perAccount: 30, top: 10, minRatio: 2, budget: 2, minAgeDays: 7, minBaseline: 5};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase());
    if (!(key in o)) throw new Error(`Unknown flag ${argv[i]}`);
    o[key] = typeof o[key] === 'number' ? Number(argv[i + 1]) : argv[i + 1];
  }
  return o;
}

export function parseAccounts(text) {
  return [...new Set(text.split('\n').map(l => l.replace(/#.*/, '').trim().replace(/^@/, '').toLowerCase()).filter(Boolean))];
}

// Plays and views are different Instagram counters. Score each account on one
// counter only: plays when every Reel has it, otherwise views.
function pickMetric(posts) {
  return posts.every(p => p.plays !== null) ? 'plays' : 'views';
}

export function hookOf(caption) {
  const line = String(caption).split('\n').map(s => s.trim()).find(Boolean) || '';
  return line.length > 140 ? line.slice(0, 137) + '...' : line;
}

export function score(rows, {top = 10, minRatio = 0, minAgeDays = 7, minBaseline = 5, now = Date.now()} = {}) {
  const byAccount = new Map();
  for (const p of deduplicate(rows)) {
    const key = p.creator.toLowerCase();
    if (!byAccount.has(key)) byAccount.set(key, []);
    byAccount.get(key).push(p);
  }
  const scored = [], skipped = [];
  for (const [account, posts] of byAccount) {
    const metric = pickMetric(posts);
    const counted = posts.filter(p => p[metric] !== null);
    // Reels younger than minAgeDays are still accumulating views, so they stay
    // out of the baseline but can still be candidates.
    const baseline = counted.filter(p => p.publishedAt && now - Date.parse(p.publishedAt) >= minAgeDays * DAY);
    const med = median(baseline.map(p => p[metric]));
    if (baseline.length < minBaseline || !med) { skipped.push(`${account} (${baseline.length} baseline Reels)`); continue; }
    for (const p of counted) scored.push({account, ratio: p[metric] / med, metric, count: p[metric], median: med, baselineN: baseline.length, post: p});
  }
  scored.sort((a, b) => b.ratio - a.ratio);
  return {rows: scored.filter(r => r.ratio >= minRatio).slice(0, top), skipped, accounts: byAccount.size};
}

const csvCell = v => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };

export function toCsv(rows) {
  const header = ['rank', 'account', 'outlier_ratio', 'metric', 'count', 'account_median', 'baseline_n', 'hook', 'format', 'duration_s', 'posted', 'url'];
  const lines = rows.map((r, i) => [
    i + 1, r.account, r.ratio.toFixed(1), r.metric, r.count, Math.round(r.median), r.baselineN,
    hookOf(r.post.caption), '', r.post.duration === null ? '' : Math.round(r.post.duration),
    (r.post.publishedAt || '').slice(0, 10), r.post.url,
  ].map(csvCell).join(','));
  return [header.join(','), ...lines].join('\n') + '\n';
}

async function apify(path, token, init = {}) {
  const res = await fetch(`https://api.apify.com/v2/${path}`, {...init, headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers}});
  if (!res.ok) throw new Error(`Apify ${res.status} on ${path.split('?')[0]}`);
  return res.json();
}

async function scrape(accounts, {perAccount, budget}, token) {
  const run = (await apify(`acts/${REEL_SCRAPER}/runs?maxTotalChargeUsd=${budget}`, token, {method: 'POST', body: JSON.stringify({username: accounts, resultsLimit: perAccount, includeSharesCount: false, includeTranscript: false, includeDownloadedVideo: false, skipPinnedPosts: true, skipTrialReels: true})})).data;
  let state = run;
  while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(state.status)) {
    await new Promise(r => setTimeout(r, 5000));
    state = (await apify(`actor-runs/${run.id}`, token)).data;
    process.stderr.write(`Apify ${state.status}\n`);
  }
  const items = await apify(`datasets/${state.defaultDatasetId}/items?clean=true&format=json&limit=${accounts.length * perAccount}`, token);
  return {items, status: state.status, costUsd: state.usageTotalUsd ?? null};
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  let rows;
  if (o.input) {
    rows = JSON.parse(await readFile(o.input, 'utf8'));
  } else {
    const token = process.env.APIFY_TOKEN;
    if (!token) throw new Error('Set APIFY_TOKEN in .env, or pass --input <saved scrape JSON>');
    const accounts = parseAccounts(await readFile(o.accounts, 'utf8'));
    if (!accounts.length) throw new Error(`No accounts in ${o.accounts}`);
    const result = await scrape(accounts, o, token);
    rows = result.items;
    const raw = `data/intel/raw-${new Date().toISOString().slice(0, 10)}.json`;
    await mkdir(dirname(raw), {recursive: true});
    await writeFile(raw, JSON.stringify(rows));
    process.stderr.write(`Apify ${result.status}, ${rows.length} rows, cost ${result.costUsd ?? 'unknown'} USD, raw saved to ${raw}\n`);
  }
  const {rows: top, skipped, accounts} = score(rows, o);
  await mkdir(dirname(o.out), {recursive: true});
  await writeFile(o.out, toCsv(top));
  process.stderr.write(`Scored ${accounts} accounts, wrote ${top.length} rows to ${o.out}\n`);
  if (skipped.length) process.stderr.write(`Skipped (too few baseline Reels): ${skipped.join(', ')}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e.message); process.exit(1); });
