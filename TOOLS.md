# Tool Reference — Polish Data Protection MCP

All tools use the `pl_dp_` prefix. Tools return structured JSON with a `_meta` field on every response and `_citation` fields on individual record responses.

---

## pl_dp_search_decisions

**Description:** Full-text search across UODO decisions (sanctions, administrative decisions, and orders).

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query in Polish or English |
| `type` | string | No | Filter: `sanction`, `decision`, `order`, `opinion` |
| `topic` | string | No | Filter by topic ID (e.g. `consent`, `cookies`) |
| `limit` | number | No | Max results (default 20, max 100) |

**Output:** `{ results: Decision[], count: number, _meta: ResponseMeta }`

Each `Decision` includes a `_citation` field for entity linking.

---

## pl_dp_get_decision

**Description:** Get a specific UODO decision by reference number.

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `reference` | string | Yes | UODO reference (e.g. `ZSPR.421.1.2019`, `DKN.5112.1.2019`) |

**Output:** Full decision record with `_citation` and `_meta` fields.

---

## pl_dp_search_guidelines

**Description:** Search UODO guidance documents: guidelines, opinions, recommendations, and FAQs.

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query in Polish or English |
| `type` | string | No | Filter: `guideline`, `opinion`, `recommendation`, `FAQ` |
| `topic` | string | No | Filter by topic ID |
| `limit` | number | No | Max results (default 20, max 100) |

**Output:** `{ results: Guideline[], count: number, _meta: ResponseMeta }`

Each `Guideline` includes a `_citation` field for entity linking.

---

## pl_dp_get_guideline

**Description:** Get a specific UODO guidance document by its database ID.

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | number | Yes | Guideline database ID (from search results) |

**Output:** Full guideline record with `_citation` and `_meta` fields.

---

## pl_dp_list_topics

**Description:** List all covered data protection topics with Polish and English names.

**Input:** None

**Output:** `{ topics: Topic[], count: number, _meta: ResponseMeta }`

Use topic IDs to filter decisions and guidelines.

---

## pl_dp_list_sources

**Description:** List all data sources used by this MCP server.

**Input:** None

**Output:** `{ sources: Source[], count: number, _meta: ResponseMeta }`

Each source includes `id`, `name`, `authority`, `url`, `description`, `language`, and `coverage` fields.

---

## pl_dp_check_data_freshness

**Description:** Check when the database was last updated and whether data may be stale.

**Input:** None

**Output:**

| Field | Type | Description |
|-------|------|-------------|
| `last_run` | string \| null | ISO 8601 timestamp of last successful ingest |
| `decisions_ingested` | number | Count of decisions in last ingest run |
| `guidelines_ingested` | number | Count of guidelines in last ingest run |
| `age_days` | number \| null | Days since last ingest |
| `is_stale` | boolean | True if data is older than 7 days or never ingested |
| `errors` | string[] | Errors from last ingest run |

---

## pl_dp_about

**Description:** Return metadata about this MCP server: version, data source, coverage, and tool list.

**Input:** None

**Output:** Server metadata including name, version, description, data_source, coverage summary, and tool list.

---

## Response Metadata (_meta)

Every tool response includes a `_meta` object:

```json
{
  "_meta": {
    "disclaimer": "This data is provided for research and informational purposes only...",
    "data_age": "2026-03-23T16:57:24.892Z",
    "copyright": "UODO (uodo.gov.pl) — public regulatory data",
    "source_url": "https://uodo.gov.pl/"
  }
}
```

## Citation Metadata (_citation)

Individual record responses (`pl_dp_get_decision`, `pl_dp_get_guideline`) and search result items include a `_citation` object for the platform entity linker:

```json
{
  "_citation": {
    "canonical_ref": "ZSPR.421.1.2019",
    "display_text": "ZSPR.421.1.2019",
    "source_url": null,
    "lookup": {
      "tool": "pl_dp_get_decision",
      "args": { "reference": "ZSPR.421.1.2019" }
    }
  }
}
```

## Error Responses

Errors return JSON with `_error_type` and `_meta`:

```json
{
  "error": "Decision not found: UNKNOWN-REF",
  "_error_type": "not_found",
  "_meta": { ... }
}
```

`_error_type` values: `not_found`, `unknown_tool`, `execution_error`, `tool_error`.
