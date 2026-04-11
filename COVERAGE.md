# Corpus Coverage — Polish Data Protection MCP

This document describes the completeness and scope of data ingested from UODO (Urząd Ochrony Danych Osobowych — Polish Data Protection Authority).

## Overview

| Corpus | Source | Language | Status |
|--------|--------|----------|--------|
| UODO Decisions | [uodo.gov.pl/pl/p/decyzje](https://uodo.gov.pl/pl/p/decyzje) | Polish | Partial |
| UODO Guidelines | [uodo.gov.pl/pl/p/wytyczne](https://uodo.gov.pl/pl/p/wytyczne) | Polish | Partial |
| UODO Topics | Controlled vocabulary | Polish/English | Seed data |

## Decisions

Covers administrative decisions, sanctions, reprimands, and orders issued by UODO since 2018 (GDPR enforcement era).

### Decision Types

| Type | Description | Coverage |
|------|-------------|----------|
| `sanction` | Financial penalties under GDPR Art. 83 | In scope |
| `decision` | Administrative decisions and rulings | In scope |
| `order` | Remediation and corrective orders | In scope |
| `opinion` | Non-binding opinions | In scope |

### Known Gaps

- Pre-2018 decisions (pre-GDPR era, GIODO predecessor) are not systematically ingested
- Anonymised decisions where the official record lacks a reference are excluded
- Ongoing proceedings not yet concluded

## Guidelines

Covers UODO guidance documents, opinions, recommendations, and FAQs.

### Guidance Types

| Type | Description | Coverage |
|------|-------------|----------|
| `guideline` | Formal UODO guidelines and methodologies | In scope |
| `opinion` | Sector-specific opinions | In scope |
| `recommendation` | Practical recommendations | In scope |
| `FAQ` | Frequently asked questions | In scope |

### Topic Coverage

| Topic ID | Polish Name | English Name |
|----------|-------------|--------------|
| `consent` | Zgoda | Consent |
| `cookies` | Pliki cookie | Cookies |
| `transfers` | Przekazywanie danych | International transfers |
| `dpia` | Ocena skutków | DPIA |
| `breach` | Naruszenia | Breach notification |
| `privacy_by_design` | Prywatność w fazie projektowania | Privacy by design |
| `employee_monitoring` | Monitoring pracowników | Employee monitoring |
| `health_data` | Dane dotyczące zdrowia | Health data |
| `children` | Dzieci | Children's data |

## Data Quality Notes

- Decision summaries are generated from official UODO documents
- Full text is extracted from PDF/HTML publications
- `gdpr_articles` field contains GDPR article references cited in the decision
- `fine_amount` is in PLN (Polish Złoty); some older records may lack this field
- All dates are in ISO 8601 format (YYYY-MM-DD)

## Freshness

Data ingestion runs weekly via GitHub Actions (`.github/workflows/ingest.yml`). Freshness is checked via `.github/workflows/check-freshness.yml`. The `pl_dp_check_data_freshness` tool exposes last-run timestamps at runtime.

## Completeness Estimate

Current ingest coverage is a sample/seed dataset. Full population of the UODO corpus requires running `npm run ingest` against the live UODO publication portal.

See `data/ingest-state.json` for current ingestion state.
