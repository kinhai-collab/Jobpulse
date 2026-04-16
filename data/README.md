# data/ — local source CSVs

This folder holds the source CSVs that get converted into `public/companies.json`
by `scripts/build_companies.py`. The CSVs are gitignored (they're personal data
you curate), but `public/companies.json` can be committed.

## Expected files

- `NorcalTech_validated.csv` — the master company list with ATS platform,
  slug, API URL, verification status, and job count columns.

## Updating the company list

1. Edit `NorcalTech_validated.csv` directly (add/remove rows, fix slugs, etc.)
2. Run `python3 scripts/build_companies.py` from the project root
3. Commit the updated `public/companies.json`
