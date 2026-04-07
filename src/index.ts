#!/usr/bin/env node

/**
 * Polish Data Protection MCP — stdio entry point.
 *
 * Provides MCP tools for querying UODO decisions, sanctions, and
 * data protection guidance documents.
 *
 * Tool prefix: pl_dp_
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  searchDecisions,
  getDecision,
  searchGuidelines,
  getGuideline,
  listTopics,
} from "./db.js";
import { buildCitation } from "./citation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let pkgVersion = "0.1.0";
try {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, "..", "package.json"), "utf8"),
  ) as { version: string };
  pkgVersion = pkg.version;
} catch {
  // fallback to default
}

const SERVER_NAME = "polish-data-protection-mcp";

// --- Tool definitions ---------------------------------------------------------

const TOOLS = [
  {
    name: "pl_dp_search_decisions",
    description:
      "Full-text search across UODO decisions (sanctions, administrative decisions, and orders). Returns matching decisions with reference, entity name, fine amount, and GDPR articles cited.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query in Polish or English (e.g., 'Morele dane osobowe', 'przetwarzanie danych', 'consent')",
        },
        type: {
          type: "string",
          enum: ["sanction", "decision", "order", "opinion"],
          description: "Filter by decision type. Optional.",
        },
        topic: {
          type: "string",
          description: "Filter by topic ID (e.g., 'consent', 'cookies', 'transfers'). Optional.",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return. Defaults to 20.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "pl_dp_get_decision",
    description:
      "Get a specific UODO decision by reference number (e.g., 'ZSPR.421.1.2019', 'DKN.5112.1.2019').",
    inputSchema: {
      type: "object" as const,
      properties: {
        reference: {
          type: "string",
          description: "UODO decision reference (e.g., 'ZSPR.421.1.2019', 'DKN.5112.1.2019')",
        },
      },
      required: ["reference"],
    },
  },
  {
    name: "pl_dp_search_guidelines",
    description:
      "Search UODO guidance documents: guidelines, opinions, recommendations, and FAQs. Covers GDPR implementation, employee monitoring, cookies, DPIA methodology, and more.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query in Polish or English (e.g., 'monitoring pracowników', 'DPIA', 'cookies')",
        },
        type: {
          type: "string",
          enum: ["guideline", "opinion", "recommendation", "FAQ"],
          description: "Filter by guidance type. Optional.",
        },
        topic: {
          type: "string",
          description: "Filter by topic ID (e.g., 'dpia', 'cookies', 'employee_monitoring'). Optional.",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return. Defaults to 20.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "pl_dp_get_guideline",
    description:
      "Get a specific UODO guidance document by its database ID.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "number",
          description: "Guideline database ID (from pl_dp_search_guidelines results)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "pl_dp_list_topics",
    description:
      "List all covered data protection topics with Polish and English names. Use topic IDs to filter decisions and guidelines.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "pl_dp_about",
    description: "Return metadata about this MCP server: version, data source, coverage, and tool list.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

// --- Zod schemas for argument validation --------------------------------------

const SearchDecisionsArgs = z.object({
  query: z.string().min(1),
  type: z.enum(["sanction", "decision", "order", "opinion"]).optional(),
  topic: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const GetDecisionArgs = z.object({
  reference: z.string().min(1),
});

const SearchGuidelinesArgs = z.object({
  query: z.string().min(1),
  type: z.enum(["guideline", "opinion", "recommendation", "FAQ"]).optional(),
  topic: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const GetGuidelineArgs = z.object({
  id: z.number().int().positive(),
});

// --- Helper ------------------------------------------------------------------

function textContent(data: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(data, null, 2) },
    ],
  };
}

function errorContent(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

// --- Server setup ------------------------------------------------------------

const server = new Server(
  { name: SERVER_NAME, version: pkgVersion },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case "pl_dp_search_decisions": {
        const parsed = SearchDecisionsArgs.parse(args);
        const results = searchDecisions({
          query: parsed.query,
          type: parsed.type,
          topic: parsed.topic,
          limit: parsed.limit,
        });
        return textContent({ results, count: results.length });
      }

      case "pl_dp_get_decision": {
        const parsed = GetDecisionArgs.parse(args);
        const decision = getDecision(parsed.reference);
        if (!decision) {
          return errorContent(`Decision not found: ${parsed.reference}`);
        }
        const d = decision as Record<string, unknown>;
        return textContent({
          ...d,
          _citation: buildCitation(
            String(d.reference ?? parsed.reference),
            String(d.title ?? d.reference ?? parsed.reference),
            "pl_dp_get_decision",
            { reference: parsed.reference },
          ),
        });
      }

      case "pl_dp_search_guidelines": {
        const parsed = SearchGuidelinesArgs.parse(args);
        const results = searchGuidelines({
          query: parsed.query,
          type: parsed.type,
          topic: parsed.topic,
          limit: parsed.limit,
        });
        return textContent({ results, count: results.length });
      }

      case "pl_dp_get_guideline": {
        const parsed = GetGuidelineArgs.parse(args);
        const guideline = getGuideline(parsed.id);
        if (!guideline) {
          return errorContent(`Guideline not found: id=${parsed.id}`);
        }
        const g = guideline as Record<string, unknown>;
        return textContent({
          ...g,
          _citation: buildCitation(
            String(g.reference ?? g.title ?? `guideline-${parsed.id}`),
            String(g.title ?? `Guideline ${parsed.id}`),
            "pl_dp_get_guideline",
            { id: String(parsed.id) },
          ),
        });
      }

      case "pl_dp_list_topics": {
        const topics = listTopics();
        return textContent({ topics, count: topics.length });
      }

      case "pl_dp_about": {
        return textContent({
          name: SERVER_NAME,
          version: pkgVersion,
          description:
            "UODO (Urząd Ochrony Danych Osobowych — Polish Data Protection Authority) MCP server. Provides access to Polish data protection authority decisions, sanctions, administrative orders, and official guidance documents.",
          data_source: "UODO (https://uodo.gov.pl/)",
          coverage: {
            decisions: "UODO sanctions, administrative decisions, and orders",
            guidelines: "UODO guidelines, opinions, recommendations, and FAQs",
            topics: "Consent, cookies, transfers, DPIA, breach notification, privacy by design, employee monitoring, health data, children",
          },
          tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
        });
      }

      default:
        return errorContent(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorContent(`Error executing ${name}: ${message}`);
  }
});

// --- Main --------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`${SERVER_NAME} v${pkgVersion} running on stdio\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
