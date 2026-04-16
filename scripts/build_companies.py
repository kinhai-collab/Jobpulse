#!/usr/bin/env python3
"""
build_companies.py — convert NorcalTech_validated.csv into companies.json

Run from project root:
    python3 scripts/build_companies.py

Input:  data/NorcalTech_validated.csv (drop the validated CSV here)
Output: public/companies.json

The JSON structure is optimized for the frontend:
{
  "updated_at": "2026-04-15T12:00:00Z",
  "tier1_count": 34,
  "tier2_count": 150,
  "companies": [
    {
      "id": "anthropic",           // stable slug from company name
      "name": "Anthropic",
      "careers_url": "https://www.anthropic.com/careers",
      "hq": "San Francisco",
      "size": "2500+",
      "stage": "Late Stage",
      "focus": "Foundation Models",
      "tier": 1,                    // 1 = API-friendly, 2 = fallback
      "ats": {
        "platform": "Greenhouse",   // only for tier 1
        "slug": "anthropic",
        "api_url": "https://boards-api.greenhouse.io/v1/boards/anthropic/jobs"
      }
    },
    ...
  ]
}
"""
import csv
import json
import re
import os
from datetime import datetime, timezone


def make_id(name):
    """Stable ID from company name: 'Anthropic' -> 'anthropic', 'Hugging Face (SF)' -> 'hugging-face'"""
    # Strip parenthetical annotations
    cleaned = re.sub(r'\s*\([^)]*\)\s*', '', name)
    # Lowercase, replace non-alphanumeric with hyphens
    slug = re.sub(r'[^a-z0-9]+', '-', cleaned.lower()).strip('-')
    return slug


def clean_size(size_str):
    """Some rows have '11-50' mangled to 'Nov-50' by Excel. Unmangle."""
    if not size_str:
        return ""
    fixes = {
        "Nov-50": "11-50",
        "Oct-50": "10-50",
    }
    return fixes.get(size_str, size_str)


def build_companies(csv_path, output_path):
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    companies = []
    seen_ids = set()

    for row in rows:
        name = row.get('Company Name', '').strip()
        if not name or name == 'Company Name':
            continue

        cid = make_id(name)
        # Dedupe on ID (handles cases like "MosaicML (Databricks)" which maps to databricks)
        orig_id = cid
        suffix = 2
        while cid in seen_ids:
            cid = f"{orig_id}-{suffix}"
            suffix += 1
        seen_ids.add(cid)

        verified = row.get('ATS Verified', '').strip().upper() in ('TRUE', '1')
        platform = row.get('ATS Platform (enriched)', '').strip()

        company = {
            'id': cid,
            'name': name,
            'careers_url': row.get('Career Page URL', '').strip(),
            'hq': row.get('Headquarters City', '').strip(),
            'size': clean_size(row.get('Company Size', '').strip()),
            'stage': row.get('Funding Stage', '').strip(),
            'focus': row.get('AI Focus Area', '').strip(),
        }

        if verified and platform in ('Greenhouse', 'Lever', 'Ashby'):
            # Tier 1: API-friendly
            company['tier'] = 1
            company['ats'] = {
                'platform': platform,
                'slug': row.get('ATS Slug', '').strip(),
                'api_url': row.get('ATS API URL', '').strip(),
            }
            try:
                company['known_job_count'] = int(row.get('Job Count', '0'))
            except (ValueError, TypeError):
                company['known_job_count'] = 0
        else:
            # Tier 2: fallback to web search
            company['tier'] = 2
            # Note the claimed platform even for tier 2, useful for Workday detection
            if platform and platform not in ('Unknown', ''):
                company['claimed_platform'] = platform

        companies.append(company)

    # Dedupe tier 1 companies that share the same ATS slug
    # (e.g. MosaicML → Databricks). Keep the first, note the alias on the survivor.
    seen_api = {}
    deduped = []
    for c in companies:
        if c['tier'] == 1:
            key = (c['ats']['platform'], c['ats']['slug'])
            if key in seen_api:
                # Already have this ATS board — attach as alias to the survivor
                survivor = seen_api[key]
                survivor.setdefault('aliases', []).append(c['name'])
                continue
            seen_api[key] = c
        deduped.append(c)
    companies = deduped

    # Sort: tier 1 first (highest job count), then tier 2 alphabetical
    companies.sort(key=lambda c: (
        c['tier'],
        -c.get('known_job_count', 0) if c['tier'] == 1 else 0,
        c['name'].lower(),
    ))

    tier1 = [c for c in companies if c['tier'] == 1]
    tier2 = [c for c in companies if c['tier'] == 2]

    output = {
        'updated_at': datetime.now(timezone.utc).isoformat(),
        'total_companies': len(companies),
        'tier1_count': len(tier1),
        'tier2_count': len(tier2),
        'tier1_known_jobs': sum(c.get('known_job_count', 0) for c in tier1),
        'companies': companies,
    }

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    # Print summary
    print(f"✓ Wrote {output_path}")
    print(f"  Total: {len(companies)} companies")
    print(f"  Tier 1 (API): {len(tier1)} companies, {output['tier1_known_jobs']:,} known jobs")
    print(f"  Tier 2 (fallback): {len(tier2)} companies")
    print()
    print("Top 10 tier-1 companies by job count:")
    for c in tier1[:10]:
        print(f"  {c['known_job_count']:>5}  {c['name']:30s}  {c['ats']['platform']}/{c['ats']['slug']}")


if __name__ == '__main__':
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    csv_path = os.path.join(project_root, 'data', 'NorcalTech_validated.csv')
    output_path = os.path.join(project_root, 'public', 'companies.json')

    if not os.path.exists(csv_path):
        print(f"ERROR: {csv_path} not found.")
        print("Drop NorcalTech_validated.csv into the data/ folder and re-run.")
        raise SystemExit(1)

    build_companies(csv_path, output_path)
