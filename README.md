# JobPulse

A daily dashboard for tracking PM and Program Manager roles at ~180 AI-focused
Bay Area companies. Log in, click Refresh, see new jobs, mark what you've
applied to.

Built to avoid the manual grind of checking 180 career pages one at a time.

---

## Architecture

```
┌────────────────────────┐      ┌─────────────────────────┐
│  Browser (Vercel CDN)  │ ───► │  Supabase (auth + DB)   │
│  public/index.html     │      │  jobs, applications,    │
│  Alpine.js + Tailwind  │      │  user_prefs, scan_runs  │
└───────────┬────────────┘      └───────────┬─────────────┘
            │                               ▲
            │ clicks "Refresh"              │
            ▼                               │ writes job results
┌────────────────────────────────────────────────────────┐
│  Vercel serverless functions (api/*.js)                │
│  ─ /api/scan   — daily cron + manual trigger           │
│  ─ /api/apply  — mark-as-applied endpoint              │
└─────┬──────────────────────────────┬───────────────────┘
      │                              │
      │ tier 1: direct ATS API       │ tier 2: Claude web search
      ▼                              ▼
  Greenhouse / Lever / Ashby    Anthropic Claude Haiku API
  (34 companies, ~3,400 jobs)   (149 companies, fallback)
```

## Project layout

Phase 1 (current — scaffolding only):

```
jobpulse/
├── public/
│   └── companies.json          # generated from data/NorcalTech_validated.csv
├── data/                       # source CSVs (gitignored; see data/README.md)
│   └── README.md
├── scripts/
│   └── build_companies.py      # CSV → public/companies.json
├── supabase/
│   └── schema.sql              # full schema, run once in the SQL editor
├── .env.example                # template for environment variables
├── .gitignore
├── package.json                # JS deps for serverless functions (Phase 2)
├── vercel.json                 # deployment config + cron schedule
└── README.md                   # you are here
```

Phase 2+ will add:

```
├── api/                        # Vercel serverless functions (Node.js)
│   ├── scan.js                   # the daily scan job
│   ├── apply.js                  # mark-as-applied endpoint
│   └── health.js                 # uptime ping
├── public/
│   ├── index.html                # the whole app (Alpine.js + Tailwind)
│   └── favicon.ico
├── lib/                        # shared code between serverless functions
│   ├── supabase.js               # Supabase client factory
│   ├── ats-greenhouse.js         # Greenhouse API adapter
│   ├── ats-lever.js              # Lever API adapter
│   ├── ats-ashby.js              # Ashby API adapter
│   └── ats-fallback.js           # Claude Haiku + web search fallback
```

## Setup

### 1. Prerequisites

- Node.js 20+
- Python 3.9+ (for the build script)
- A [Supabase](https://supabase.com) project (free tier is fine)
- An [Anthropic API key](https://console.anthropic.com) with a monthly spend limit
- A [Vercel](https://vercel.com) account

### 2. Clone and install

```bash
git clone https://github.com/YOUR-USER/jobpulse.git
cd jobpulse
npm install
```

### 3. Set up Supabase

1. Create a new Supabase project
2. Open the SQL editor → paste contents of `supabase/schema.sql` → Run
3. Grab your project URL, anon key, and service role key from Settings → API
4. Go to Authentication → Providers → enable Email (password-based signup)

### 4. Configure environment variables

```bash
cp .env.example .env.local
# fill in the values
```

### 5. Build the company list

Drop your validated company CSV into `data/NorcalTech_validated.csv`, then:

```bash
python3 scripts/build_companies.py
```

You should see output like:

```
✓ Wrote public/companies.json
  Total: 183 companies
  Tier 1 (API): 34 companies, 3,388 known jobs
  Tier 2 (fallback): 149 companies
```

### 6. Deploy to Vercel

```bash
npm install -g vercel
vercel link
vercel env pull .env.local   # if you set env vars in the dashboard
vercel --prod
```

Or hook the GitHub repo to Vercel for auto-deploy on push.

## How the scan works

The scan runs once daily at 7am PT (14:00 UTC) via Vercel cron, and can also
be triggered manually by an authenticated user clicking "Refresh".

**Tier 1 (API-friendly, ~34 companies)** — the scan hits public Greenhouse,
Lever, and Ashby JSON APIs directly. Fast, free, reliable. Each platform has
a clean `/jobs` endpoint that returns all open positions. We filter client-side
for PM/Program Manager titles.

**Tier 2 (fallback, ~149 companies)** — the scan uses Claude Haiku to parse
the company's careers page via web search. Slower and costs API tokens, but
handles companies whose ATS we can't hit directly. Results go through a strict
JSON schema prompt to avoid hallucination.

Results write into the `jobs` table. Each row has a `first_seen_at` timestamp,
so the frontend can show a "NEW" badge for jobs that appeared since the user's
last visit.

## Known limitations

- **Greenhouse legacy API gaps** — some newer Greenhouse tenants (Perplexity,
  Cohere, Groq, Harvey) aren't served by the `boards-api.greenhouse.io/v1` endpoint.
  These fall through to the tier-2 fallback for now.
- **Workday** — 8 companies (Adobe, Nvidia, etc.) are on Workday. The scan
  uses the fallback for these. A dedicated Workday adapter is possible but
  not priority for MVP.
- **JavaScript-rendered career pages** — the fallback uses static HTML fetches.
  Pages that require JS rendering return empty. Not common for the target list.

## Roadmap

- [ ] **MVP1** — auth, scan, dashboard, mark-as-applied
- [ ] **MVP2** — resume version dropdown, application status pipeline
- [ ] **Phase 3** — email alerts, LinkedIn integration, community-contributed companies
