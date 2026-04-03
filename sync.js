/**
 * skill-up/sync.js
 *
 * Daily cron script — reads two Google Sheets tabs (problems + certs),
 * processes stats with Gemini, writes data/stats.json, then commits & pushes
 * to the skill-up GitHub repo so the portfolio can fetch it.
 *
 * Environment variables needed:
 *   APPS_SCRIPT_URL  — Google Apps Script web app URL (no token needed)
 *   GH_TOKEN         — GitHub PAT with Contents: write on skill-up repo
 *   GH_REPO          — e.g. "AnupamaSharma2000/skill-up"
 */

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbxLj1EI97HGEnrrtfo4F-x7sXE-Kv8Q4Y6D0xOZLVDMD-P_3zIJe-eMh49Dmbc4kJkk/exec';
const GH_TOKEN        = process.env.GH_TOKEN;
const GH_REPO         = process.env.GH_REPO || 'AnupamaSharma2000/skill-up';
const GH_FILE_PATH      = 'data/stats.json';

// ── Fetch a public Google Sheet CSV ─────────────────────────────────────────
async function fetchCSV(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch CSV: ${res.status} ${url}`);
  return res.text();
}

// ── Parse CSV into array of objects ─────────────────────────────────────────
function parseCSV(raw) {
  const lines = raw.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1)
    .filter(l => l.trim())
    .map(line => {
      // Handle quoted fields with commas inside
      const values = [];
      let cur = '', inQ = false;
      for (const ch of line) {
        if (ch === '"') { inQ = !inQ; continue; }
        if (ch === ',' && !inQ) { values.push(cur.trim()); cur = ''; continue; }
        cur += ch;
      }
      values.push(cur.trim());
      return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
    });
}

// ── Process problems data ────────────────────────────────────────────────────
function processProblems(rows) {
  const valid = rows.filter(r => r.date && r.title);

  const byDiff = { Easy: 0, Medium: 0, Hard: 0 };
  valid.forEach(r => {
    const d = r.difficulty?.trim();
    if (byDiff[d] !== undefined) byDiff[d]++;
  });

  // Streak: consecutive days solved (desc from today)
  const today = new Date();
  const solvedDates = [...new Set(valid.map(r => r.date?.trim()))].sort().reverse();
  let streak = 0;
  let check = new Date(today);
  for (const d of solvedDates) {
    const row = new Date(d);
    const diff = Math.round((check - row) / 86400000);
    if (diff <= 1) { streak++; check = row; }
    else break;
  }

  // This week
  const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
  const thisWeek = valid.filter(r => new Date(r.date) >= weekAgo).length;

  // Recent 5
  const recent = valid.slice(-5).reverse().map(r => ({
    date:       r.date,
    title:      r.title,
    difficulty: r.difficulty,
    platform:   r.platform,
    tags:       r.tags ? r.tags.split('|').map(t => t.trim()) : [],
    solution:   r.solution_url || null,
    problem:    r.problem_url  || null,
  }));

  return {
    total:     valid.length,
    easy:      byDiff.Easy,
    medium:    byDiff.Medium,
    hard:      byDiff.Hard,
    streak,
    this_week: thisWeek,
    recent,
  };
}

// ── Process certs data ───────────────────────────────────────────────────────
function processCerts(rows) {
  return rows
    .filter(r => r.name)
    .map(r => ({
      name:      r.name,
      provider:  r.provider  || '',
      progress:  parseInt(r.progress_pct || '0', 10),
      status:    r.status    || 'In Progress',  // In Progress | Completed | Planned
      url:       r.url       || null,
      eta:       r.eta       || null,
    }));
}

// ── Write stats.json to GitHub via API ──────────────────────────────────────
async function pushToGitHub(content) {
  const apiUrl = `https://api.github.com/repos/${GH_REPO}/contents/${GH_FILE_PATH}`;

  // Get current file SHA (needed for update)
  const getRes = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
    },
  });
  const existing = getRes.ok ? await getRes.json() : null;
  const sha = existing?.sha;

  const body = {
    message: `chore: sync stats ${new Date().toISOString().slice(0, 10)}`,
    content: Buffer.from(content).toString('base64'),
    ...(sha ? { sha } : {}),
  };

  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!putRes.ok) {
    const err = await putRes.text();
    throw new Error(`GitHub API error: ${putRes.status} — ${err}`);
  }
  return putRes.json();
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🔄 skill-up sync starting…');
  if (!GH_TOKEN) throw new Error('Missing GH_TOKEN env var');

  // Fetch directly from Apps Script (no token needed)
  const res = await fetch(APPS_SCRIPT_URL);
  if (!res.ok) throw new Error(`Apps Script fetch failed: ${res.status}`);
  const stats = await res.json();
  if (stats.error) throw new Error(`Apps Script error: ${stats.error}`);

  const json = JSON.stringify(stats, null, 2);
  console.log('📊 Fetched stats:', JSON.stringify({
    problems: { total: stats.problems?.total, streak: stats.problems?.streak },
    certs: stats.certs?.length
  }, null, 2));

  await pushToGitHub(json);
  console.log('✅ stats.json pushed to GitHub successfully');
}

main().catch(err => {
  console.error('❌ Sync failed:', err.message);
  process.exit(1);
});
