// lib/ats-fallback.js
// Uses Claude Haiku to find PM roles on tier-2 company career pages.
// Does NOT use the web_search tool — uses Claude's training knowledge instead.

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PM_PROMPT = (company, url) => `You are a job search assistant. Based on your knowledge of ${company}'s current open roles (careers page: ${url}), list any open Product Manager, Senior Product Manager, Staff Product Manager, Group Product Manager, Program Manager, Technical Program Manager, TPM, Head of Product, VP of Product, Director of Product, or Chief Product Officer roles.

Return ONLY a JSON array with no other text, markdown, or explanation. Each element must have exactly:
- "title": the job title (string)
- "location": city/state or "Remote" (string, empty string if unknown)
- "url": direct link to the job or the careers page if no direct link (string)

If you are not aware of any open PM roles at this company, return an empty array: []

Example response:
[{"title":"Senior Product Manager, Platform","location":"San Francisco, CA","url":"${url}"},{"title":"Technical Program Manager","location":"Remote","url":"${url}"}]`;

async function scanCompany(company) {
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: PM_PROMPT(company.name, company.careers_url) }],
    });

    const textBlock = response.content.filter(b => b.type === 'text').pop();
    if (!textBlock) {
      console.log(`[fallback] No text response for ${company.name}`);
      return [];
    }

    const text = textBlock.text.trim();
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    if (!cleaned || cleaned === '[]') return [];

    let jobs;
    try {
      jobs = JSON.parse(cleaned);
    } catch {
      console.error(`[fallback] JSON parse failed for ${company.name}:`, cleaned.slice(0, 200));
      return [];
    }

    if (!Array.isArray(jobs) || jobs.length === 0) return [];

    console.log(`[fallback] ${company.name}: ${jobs.length} PM role(s) found`);

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
