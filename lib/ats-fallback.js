// lib/ats-fallback.js
// Uses Claude Haiku + web_search tool to find PM roles on tier-2 company career pages.
// Called by api/scan.js for companies without a working ATS API.

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PM_PROMPT = (company, url) => `Search ${company}'s careers page at ${url} for any open roles matching: Product Manager, Senior Product Manager, Staff Product Manager, Group Product Manager, Program Manager, Technical Program Manager, TPM, Head of Product, VP Product, Director of Product, or Chief Product Officer.

Return ONLY a JSON array. Each element must have exactly these fields:
- title: string (job title)
- location: string (location or "Remote" if remote, empty string if not listed)
- url: string (direct link to the job posting, or the careers page URL if no direct link)

If no matching roles are found, return an empty array: []

Do not include any explanation, markdown, or text outside the JSON array.`;

/**
 * Scan a single tier-2 company for PM roles using Claude Haiku.
 * Returns array of normalized job objects, or [] on failure.
 */
async function scanCompany(company) {
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: PM_PROMPT(company.name, company.careers_url) }],
    });

    // Extract the final text block (after any tool use)
    const textBlock = response.content.filter(b => b.type === 'text').pop();
    if (!textBlock) return [];

    const text = textBlock.text.trim();

    // Strip any accidental markdown fences
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    let jobs;
    try {
      jobs = JSON.parse(cleaned);
    } catch {
      console.error(`[fallback] JSON parse failed for ${company.name}:`, cleaned.slice(0, 200));
      return [];
    }

    if (!Array.isArray(jobs)) return [];

    // Normalize into the same shape as tier-1 jobs
    const now = new Date().toISOString();
    return jobs
      .filter(j => j && typeof j.title === 'string' && j.title.trim())
      .map(j => ({
        id: company.id + ':fb:' + slugify(j.title),
        company_id: company.id,
        company_name: company.name,
        title: j.title.trim(),
        location: (j.location || '').trim(),
        url: (j.url || company.careers_url).trim(),
        salary_min: null,
        salary_max: null,
        posted_at: null,
        first_seen_at: now,
        last_seen_at: now,
        is_active: true,
        source: 'fallback',
      }));
  } catch (err) {
    console.error(`[fallback] Error scanning ${company.name}:`, err.message);
    return [];
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

module.exports = { scanCompany };
