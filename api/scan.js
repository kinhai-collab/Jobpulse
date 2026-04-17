// api/scan.js
// Vercel serverless function — scans tier-2 companies for PM roles using Claude Haiku.
// Triggered by Vercel cron (daily at 7am PT) or manually via POST.
//
// Auth: requires Authorization: Bearer <CRON_SECRET> header.
// The cron runner in vercel.json sends this automatically.
//
// Env vars required:
//   ANTHROPIC_API_KEY        — from console.anthropic.com
//   SUPABASE_URL             — https://vnkgseafftmaykypbscv.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY — from Supabase Settings → API (the secret key)
//   CRON_SECRET              — any random string, set in Vercel dashboard

const path = require('path');
const fs = require('fs');
const { getServiceClient } = require('../lib/supabase');
const { scanCompany } = require('../lib/ats-fallback');

const PM_PATTERN = /product\s*manag|program\s*manag|technical\s*program|tpm\b|chief\s*product|vp.*product|head.*product|director.*product/i;

// Process tier-2 companies in batches to stay within Anthropic rate limits.
// Haiku rate limit is generous but scanning 149 companies in parallel would spike usage.
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 2000; // 2 seconds between batches

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runScan() {
  const sb = getServiceClient();

  // Load companies.json from the public folder
  const companiesPath = path.join(process.cwd(), 'public', 'companies.json');
  const companiesData = JSON.parse(fs.readFileSync(companiesPath, 'utf8'));
  const tier2 = companiesData.companies.filter(c => c.tier === 2);

  console.log(`[scan] Starting tier-2 scan: ${tier2.length} companies`);

  const startedAt = new Date().toISOString();
  let allJobs = [];
  let errors = {};
  let companiesScanned = 0;
  let companiesFailed = 0;

  // Process in batches
  for (let i = 0; i < tier2.length; i += BATCH_SIZE) {
    const batch = tier2.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(tier2.length / BATCH_SIZE);
    console.log(`[scan] Batch ${batchNum}/${totalBatches}: ${batch.map(c => c.name).join(', ')}`);

    const results = await Promise.all(
      batch.map(async company => {
        try {
          const jobs = await scanCompany(company);
          companiesScanned++;
          return { company, jobs, error: null };
        } catch (err) {
          companiesFailed++;
          errors[company.id] = err.message;
          return { company, jobs: [], error: err.message };
        }
      })
    );

    for (const { jobs } of results) {
      // Filter to PM roles only (Claude should have done this, but double-check)
      const pmJobs = jobs.filter(j => PM_PATTERN.test(j.title));
      allJobs = allJobs.concat(pmJobs);
    }

    // Delay between batches (skip after last batch)
    if (i + BATCH_SIZE < tier2.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log(`[scan] Found ${allJobs.length} PM jobs across ${companiesScanned} companies`);

  // Upsert jobs into Supabase
  let jobsNew = 0;
  if (allJobs.length > 0) {
    // Get existing job IDs to compute "new" count
    const existingIds = new Set();
    const { data: existing } = await sb
      .from('jobs')
      .select('id')
      .in('id', allJobs.map(j => j.id));
    if (existing) existing.forEach(r => existingIds.add(r.id));
    jobsNew = allJobs.filter(j => !existingIds.has(j.id)).length;

    const { error: upsertError } = await sb
      .from('jobs')
      .upsert(allJobs, { onConflict: 'id', ignoreDuplicates: false });

    if (upsertError) {
      console.error('[scan] Upsert error:', upsertError);
    }
  }

  // Log to scan_runs table
  const finishedAt = new Date().toISOString();
  await sb.from('scan_runs').insert({
    started_at: startedAt,
    finished_at: finishedAt,
    jobs_found: allJobs.length,
    jobs_new: jobsNew,
    companies_scanned: companiesScanned,
    companies_failed: companiesFailed,
    errors: Object.keys(errors).length > 0 ? errors : null,
    source: 'cron',
  });

  return {
    jobs_found: allJobs.length,
    jobs_new: jobsNew,
    companies_scanned: companiesScanned,
    companies_failed: companiesFailed,
  };
}

// Vercel serverless handler
module.exports = async function handler(req, res) {
  // Only allow POST (Vercel cron sends GET, so we accept both)
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify auth
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    console.log('[scan] Starting scan run...');
    const result = await runScan();
    console.log('[scan] Scan complete:', result);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('[scan] Fatal error:', err);
    return res.status(500).json({ error: err.message });
  }
};
