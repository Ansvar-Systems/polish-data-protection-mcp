/**
 * Response metadata helper for the UODO MCP server.
 *
 * Every tool response must include a _meta field with disclaimer,
 * data_age, copyright, and source_url per the fleet golden standard.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const INGEST_STATE_PATH = join(__dirname, "..", "data", "ingest-state.json");

interface IngestState {
  lastRun?: string;
  decisionsIngested?: number;
  guidelinesIngested?: number;
}

function readIngestState(): IngestState {
  try {
    return JSON.parse(readFileSync(INGEST_STATE_PATH, "utf8")) as IngestState;
  } catch {
    return {};
  }
}

export interface ResponseMeta {
  disclaimer: string;
  data_age: string | null;
  copyright: string;
  source_url: string;
}

/**
 * Build the _meta object to attach to every tool response.
 * Reads data/ingest-state.json for data_age.
 */
export function responseMeta(): ResponseMeta {
  const state = readIngestState();
  return {
    disclaimer:
      "This data is provided for research and informational purposes only. It is not legal or regulatory advice. Verify all references against official UODO publications before making compliance decisions.",
    data_age: state.lastRun ?? null,
    copyright: "UODO (uodo.gov.pl) — public regulatory data",
    source_url: "https://uodo.gov.pl/",
  };
}
