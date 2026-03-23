/**
 * Ingestion crawler for the UODO (Urząd Ochrony Danych Osobowych) MCP server.
 *
 * Scrapes GDPR enforcement decisions, sanctions, and guidance documents from
 * uodo.gov.pl and populates the SQLite database.
 *
 * Data sources:
 *   - https://uodo.gov.pl/pl/p/decyzje         — all UODO decisions (~530)
 *   - https://uodo.gov.pl/pl/598                — guidance (2025+)
 *   - https://uodo.gov.pl/pl/383                — guidance (2018–2020)
 *   - https://uodo.gov.pl/pl/138                — news/aktualności (for additional guidance)
 *
 * Individual decision pages (e.g. /decyzje/DKN.5131.8.2021) contain:
 *   - Running text with embedded metadata (no structured sidebar)
 *   - Polish-format dates ("19 marca 2025 r.")
 *   - Fine amounts in Polish numeral format ("47.160,- PLN")
 *   - GDPR article citations ("art. 5 ust. 1 lit. f)")
 *
 * Usage:
 *   npx tsx scripts/ingest-uodo.ts
 *   npx tsx scripts/ingest-uodo.ts --dry-run     # parse without writing to DB
 *   npx tsx scripts/ingest-uodo.ts --resume       # skip already-ingested URLs
 *   npx tsx scripts/ingest-uodo.ts --force        # drop DB and rebuild
 *   npx tsx scripts/ingest-uodo.ts --max-pages 5  # limit guidance listing pages
 */

import Database from "better-sqlite3";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import * as cheerio from "cheerio";
import { SCHEMA_SQL } from "../src/db.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DB_PATH = process.env["UODO_DB_PATH"] ?? "data/uodo.db";
const STATE_FILE = join(dirname(DB_PATH), "ingest-state.json");
const BASE_URL = "https://uodo.gov.pl";
const RATE_LIMIT_MS = 1500;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;
const USER_AGENT =
  "AnsvarUODOCrawler/1.0 (+https://github.com/Ansvar-Systems/polish-data-protection-mcp)";

/**
 * Guidance listing sections on uodo.gov.pl.
 *
 * Each section path contains guidance documents as linked entries.
 * The 2018–2020 archive is a flat list; the 2025+ section may grow.
 */
const GUIDANCE_SECTIONS = [
  { id: "guidance-2025", path: "/pl/598", maxPages: 10 },
  { id: "guidance-2018-2020", path: "/pl/383", maxPages: 10 },
] as const;

// CLI flags
const dryRun = process.argv.includes("--dry-run");
const resume = process.argv.includes("--resume");
const force = process.argv.includes("--force");
const maxPagesArg = process.argv.find((_, i, a) => a[i - 1] === "--max-pages");
const maxPagesOverride = maxPagesArg ? parseInt(maxPagesArg, 10) : null;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IngestState {
  processedUrls: string[];
  lastRun: string;
  decisionsIngested: number;
  guidelinesIngested: number;
  errors: string[];
}

interface ParsedDecision {
  reference: string;
  title: string;
  date: string | null;
  type: string | null;
  entity_name: string | null;
  fine_amount: number | null;
  summary: string | null;
  full_text: string;
  topics: string | null;
  gdpr_articles: string | null;
  status: string;
}

interface ParsedGuideline {
  reference: string | null;
  title: string;
  date: string | null;
  type: string;
  summary: string | null;
  full_text: string;
  topics: string | null;
  language: string;
}

interface DecisionListEntry {
  reference: string;
  url: string;
  date: string | null;
  title: string;
  tags: string[];
}

// ---------------------------------------------------------------------------
// HTTP fetching with rate limiting and retries
// ---------------------------------------------------------------------------

let lastRequestTime = 0;

async function rateLimitedFetch(url: string): Promise<string | null> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await sleep(RATE_LIMIT_MS - elapsed);
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      lastRequestTime = Date.now();
      const response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "pl,en;q=0.5",
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (response.status === 403 || response.status === 429) {
        console.warn(
          `  [WARN] HTTP ${response.status} for ${url} (attempt ${attempt}/${MAX_RETRIES})`,
        );
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS * attempt);
          continue;
        }
        return null;
      }

      if (!response.ok) {
        console.warn(`  [WARN] HTTP ${response.status} for ${url}`);
        return null;
      }

      return await response.text();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `  [WARN] Fetch error for ${url} (attempt ${attempt}/${MAX_RETRIES}): ${message}`,
      );
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// State management (for --resume)
// ---------------------------------------------------------------------------

function loadState(): IngestState {
  if (resume && existsSync(STATE_FILE)) {
    try {
      const raw = readFileSync(STATE_FILE, "utf-8");
      return JSON.parse(raw) as IngestState;
    } catch {
      console.warn("[WARN] Could not read state file, starting fresh.");
    }
  }
  return {
    processedUrls: [],
    lastRun: new Date().toISOString(),
    decisionsIngested: 0,
    guidelinesIngested: 0,
    errors: [],
  };
}

function saveState(state: IngestState): void {
  state.lastRun = new Date().toISOString();
  const dir = dirname(STATE_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Polish date parsing
// ---------------------------------------------------------------------------

const POLISH_MONTHS: Record<string, string> = {
  stycznia: "01",
  lutego: "02",
  marca: "03",
  kwietnia: "04",
  maja: "05",
  czerwca: "06",
  lipca: "07",
  sierpnia: "08",
  września: "09",
  października: "10",
  listopada: "11",
  grudnia: "12",
  // nominative forms (sometimes used in headers)
  styczeń: "01",
  luty: "02",
  marzec: "03",
  kwiecień: "04",
  maj: "05",
  czerwiec: "06",
  lipiec: "07",
  sierpień: "08",
  wrzesień: "09",
  październik: "10",
  listopad: "11",
  grudzień: "12",
};

/**
 * Parse a Polish date string to ISO format (yyyy-MM-dd).
 *
 * Handles:
 *   - "19 marca 2025 r."   (listing cards)
 *   - "dnia 31 maja 2023 r." (decision body)
 *   - "04.10.2018"          (guidance metadata)
 *   - "2024-01-15"          (already ISO)
 */
function parsePolishDate(raw: string): string | null {
  if (!raw) return null;

  const cleaned = raw.trim();

  // Already ISO: yyyy-MM-dd
  const isoMatch = cleaned.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return isoMatch[0];

  // Polish textual: "19 marca 2025 r." or "dnia 31 maja 2023 r."
  const textMatch = cleaned.match(
    /(\d{1,2})\s+([a-ząćęłńóśźż]+)\s+(\d{4})/i,
  );
  if (textMatch) {
    const [, day, monthName, year] = textMatch;
    const monthNum = POLISH_MONTHS[monthName!.toLowerCase()];
    if (monthNum) {
      return `${year}-${monthNum}-${day!.padStart(2, "0")}`;
    }
  }

  // Dot-separated: "04.10.2018" (dd.MM.yyyy)
  const dotMatch = cleaned.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (dotMatch) {
    const [, day, month, year] = dotMatch;
    return `${year}-${month}-${day}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// GDPR article extraction
// ---------------------------------------------------------------------------

/**
 * Extract GDPR article numbers cited in Polish legal text.
 *
 * Polish citations use: "art. 5 ust. 1 lit. f)", "art. 33 ust. 1",
 * "art. 83 ust. 4 lit. a) RODO". We extract the primary article numbers.
 */
function extractGdprArticles(text: string): string[] {
  const articles = new Set<string>();

  // Match "art. NN" patterns — capture the article number
  const regex = /art\.\s*(\d+)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    articles.add(match[1]!);
  }

  // Filter to valid GDPR article range (1–99)
  return [...articles]
    .filter((n) => {
      const num = parseInt(n, 10);
      return num >= 1 && num <= 99;
    })
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
}

// ---------------------------------------------------------------------------
// Fine amount extraction
// ---------------------------------------------------------------------------

/**
 * Extract fine/penalty amount from Polish legal text.
 *
 * Handles Polish number formatting:
 *   - "47.160,- PLN"
 *   - "2 830 410 zł"
 *   - "1.069.850 zł"
 *   - "100 000 PLN"
 *   - "karę pieniężną w wysokości 943 470 zł"
 */
function extractFineAmount(text: string): number | null {
  // Pattern 1: "karę pieniężną w wysokości NNN zł/PLN" or "karę w wysokości NNN"
  const finePatterns = [
    /kar[ęa]\s+(?:pieniężn[aąą]\s+)?w\s+wysokości\s+([\d\s.,]+)\s*(?:zł|PLN)/i,
    /nałoży[łć]\s+.*?kar[ęa].*?([\d\s.,]+)\s*(?:zł|PLN)/i,
    /administracyjn[aąą]\s+kar[ęa]\s+pieniężn[aąą]\s+w\s+wysokości\s+([\d\s.,]+)\s*(?:zł|PLN)/i,
    /([\d\s.,]+)\s*(?:zł|PLN)\s*\(/i, // amount followed by "(słownie:" or parenthetical
  ];

  for (const pattern of finePatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const amount = parsePolishNumber(match[1]);
      if (amount !== null && amount > 0) return amount;
    }
  }

  return null;
}

/**
 * Parse a Polish-formatted number string to a numeric value.
 *
 * Polish uses:
 *   - Dots or spaces as thousand separators: "2.830.410" or "2 830 410"
 *   - Comma as decimal separator: "47.160,50"
 *   - Hyphen for zero decimals: "47.160,-"
 */
function parsePolishNumber(raw: string): number | null {
  let cleaned = raw.trim();

  // Remove trailing hyphen after comma (e.g. "47.160,-")
  cleaned = cleaned.replace(/,-\s*$/, "");

  // Remove spaces (thousand separators)
  cleaned = cleaned.replace(/\s/g, "");

  // Handle comma as decimal separator: replace dots (thousand sep) then comma
  if (cleaned.includes(",")) {
    cleaned = cleaned.replace(/\./g, ""); // remove thousand dots
    cleaned = cleaned.replace(",", "."); // comma → decimal point
  } else {
    // No comma — dots could be thousand separators
    // If multiple dots, they are thousand separators
    const dotCount = (cleaned.match(/\./g) || []).length;
    if (dotCount > 1) {
      cleaned = cleaned.replace(/\./g, "");
    } else if (dotCount === 1) {
      // Single dot — ambiguous. If there are exactly 3 digits after, it is a thousand sep.
      const afterDot = cleaned.split(".")[1];
      if (afterDot && afterDot.length === 3) {
        cleaned = cleaned.replace(".", "");
      }
    }
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// ---------------------------------------------------------------------------
// Topic classification
// ---------------------------------------------------------------------------

/**
 * Topic keywords mapped to topic IDs matching the topics table.
 *
 * Each entry lists Polish keywords that, when found in a decision's text or
 * title, indicate the decision relates to that topic.
 */
const TOPIC_KEYWORDS: Record<string, string[]> = {
  consent: [
    "zgod",
    "zgody",
    "zgodę",
    "wyrażenie zgody",
    "wycofanie zgody",
    "art. 7",
    "art. 6",
    "podstaw prawna",
    "podstawy prawnej",
  ],
  cookies: [
    "cookies",
    "pliki cookie",
    "śledzeni",
    "tracker",
    "baner",
    "cookie wall",
  ],
  transfers: [
    "przekazywanie danych",
    "państw trzecich",
    "transfer",
    "art. 44",
    "art. 45",
    "art. 46",
    "art. 49",
  ],
  dpia: [
    "ocena skutków",
    "DPIA",
    "OSOD",
    "art. 35",
    "oceny skutków",
  ],
  breach_notification: [
    "naruszeni",
    "naruszenia ochrony",
    "zgłoszeni",
    "art. 33",
    "art. 34",
    "72 godzin",
    "wyciek",
    "incydent",
  ],
  privacy_by_design: [
    "środki techniczne",
    "środki organizacyjne",
    "art. 25",
    "art. 32",
    "zabezpiecz",
    "szyfrowanie",
    "uwierzytelni",
  ],
  employee_monitoring: [
    "monitoring",
    "pracownik",
    "pracodawc",
    "miejsce pracy",
    "monitoring wizyjny",
    "GPS",
    "poczta elektroniczna",
  ],
  health_data: [
    "dane dotyczące zdrowia",
    "dane medyczne",
    "dokumentacja medyczna",
    "art. 9",
    "szczególna kategoria",
    "podmiot leczniczy",
    "pacjent",
  ],
  children: [
    "dziec",
    "dzieci",
    "małoletni",
    "art. 8",
    "władza rodzicielska",
    "szkoł",
    "uczeń",
    "uczen",
  ],
};

/**
 * Classify a document by matching topic keywords against its text.
 * Returns a JSON array of matched topic IDs.
 */
function classifyTopics(text: string): string {
  const lower = text.toLowerCase();
  const matched: string[] = [];

  for (const [topicId, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) {
        matched.push(topicId);
        break;
      }
    }
  }

  return JSON.stringify(matched);
}

// ---------------------------------------------------------------------------
// Decision type classification
// ---------------------------------------------------------------------------

/**
 * Classify a decision based on its text content and tags.
 *
 * Types: sanction (fine imposed), reprimand (upomnienie), decision (other).
 */
function classifyDecisionType(
  text: string,
  tags: string[],
): string {
  const lower = text.toLowerCase();
  const tagsLower = tags.map((t) => t.toLowerCase());

  if (
    tagsLower.some((t) => t.includes("kara pieniężna")) ||
    lower.includes("nakłada administracyjną karę pieniężną") ||
    lower.includes("nałożył karę") ||
    lower.includes("nałożył administracyjną karę")
  ) {
    return "sanction";
  }

  if (
    tagsLower.some((t) => t.includes("upomnienie")) ||
    lower.includes("udziela upomnienia")
  ) {
    return "reprimand";
  }

  return "decision";
}

// ---------------------------------------------------------------------------
// Entity name extraction
// ---------------------------------------------------------------------------

/**
 * Extract the entity name from a UODO decision text.
 *
 * UODO decisions often anonymise entity names, using patterns like:
 *   - "S. sp. z o.o. z siedzibą w W."
 *   - Full names: "Morele.net sp. z o.o."
 *   - "[nazwa podmiotu]"
 *
 * We look for common Polish legal entity suffixes.
 */
function extractEntityName(text: string): string | null {
  // Pattern: entity name followed by corporate form
  const patterns = [
    // "wobec [Entity Name] sp. z o.o." or "wobec [Entity Name] S.A."
    /wobec\s+(.{3,80}?)\s*(?:sp\.\s*z\s*o\.?\s*o\.?|S\.?\s*A\.?|sp\.\s*j\.|sp\.\s*k\.)/i,
    // "na [Entity] sp. z o.o." (nałożył karę na ...)
    /(?:karę|kary)\s+na\s+(.{3,80}?)\s*(?:sp\.\s*z\s*o\.?\s*o\.?|S\.?\s*A\.?)/i,
    // "administrator — [Entity]"
    /administrator[a-z]*\s*[-–—]\s*(.{3,80}?)\s*(?:sp\.\s*z\s*o\.?\s*o\.?|S\.?\s*A\.?|z\s+siedzibą)/i,
    // Fallback: entity with "z siedzibą w"
    /(.{3,80}?)\s+z\s+siedzibą\s+w\s+/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      let name = match[1].trim();
      // Include the corporate suffix if present right after
      const suffixMatch = text
        .substring(text.indexOf(name) + name.length)
        .match(/^\s*(sp\.\s*z\s*o\.?\s*o\.?|S\.?\s*A\.?|sp\.\s*j\.|sp\.\s*k\.)/i);
      if (suffixMatch) {
        name += " " + suffixMatch[1];
      }
      // Clean up
      name = name.replace(/^\s*[-–—]\s*/, "").trim();
      if (name.length > 3) return name;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Decision listing page — discover all decision URLs
// ---------------------------------------------------------------------------

/**
 * Scrape the main decisions listing page to discover all decision URLs.
 *
 * UODO loads all ~530 decisions on a single page at /pl/p/decyzje.
 * Each decision card links to /decyzje/{REFERENCE} and contains
 * the reference, date, a brief title, and category tags.
 */
async function discoverDecisionUrls(): Promise<DecisionListEntry[]> {
  console.log("\n--- Discovering decision URLs from listing page ---");

  const html = await rateLimitedFetch(`${BASE_URL}/pl/p/decyzje`);
  if (!html) {
    console.error("[ERROR] Could not fetch decisions listing page");
    return [];
  }

  const $ = cheerio.load(html);
  const entries: DecisionListEntry[] = [];

  // Decision cards link to /decyzje/{REFERENCE}
  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    // Match links pointing to individual decisions: /decyzje/XXX.NNNN.N.YYYY
    const decisionMatch = href.match(
      /^\/decyzje\/([A-Z]+[\.\d]+\.\d+\.\d{4})$/,
    );
    if (!decisionMatch) return;

    const reference = decisionMatch[1]!;
    const fullUrl = `${BASE_URL}${href}`;

    // Avoid duplicates
    if (entries.some((e) => e.reference === reference)) return;

    // Extract card content — date and title are in the card text
    const cardText = $(el).text().trim();
    const tags: string[] = [];

    // Extract tags from span/badge elements within the card
    $(el)
      .find("span, .tag, .badge, .label")
      .each((_j, tagEl) => {
        const tagText = $(tagEl).text().trim();
        if (tagText) tags.push(tagText);
      });

    // Extract date from card text — pattern like "19 marca 2025 r."
    const dateMatch = cardText.match(
      /(\d{1,2}\s+[a-ząćęłńóśźż]+\s+\d{4})\s*r?\./i,
    );
    const date = dateMatch ? parsePolishDate(dateMatch[1]!) : null;

    // Title: remove the reference and date from card text
    let title = cardText;
    if (dateMatch) {
      title = title.replace(dateMatch[0], "").trim();
    }
    title = title.replace(reference, "").trim();
    // Collapse whitespace
    title = title.replace(/\s+/g, " ").trim();
    // Trim to reasonable length for the title field
    if (title.length > 300) {
      title = title.substring(0, 297) + "...";
    }

    entries.push({ reference, url: fullUrl, date, title, tags });
  });

  console.log(`  Discovered ${entries.length} decisions`);
  return entries;
}

// ---------------------------------------------------------------------------
// Individual decision page parsing
// ---------------------------------------------------------------------------

/**
 * Parse a single UODO decision page into a structured record.
 */
function parseDecisionPage(
  html: string,
  entry: DecisionListEntry,
): ParsedDecision | null {
  const $ = cheerio.load(html);

  // Extract full text from the main content area
  // UODO decision pages render content in the main article/content block
  let fullText = "";

  // Try several selectors for the main content area
  const contentSelectors = [
    "article",
    ".decision-content",
    ".content",
    "main .container",
    "main",
    "#content",
  ];

  for (const selector of contentSelectors) {
    const el = $(selector);
    if (el.length > 0) {
      fullText = el.text().trim();
      if (fullText.length > 200) break;
    }
  }

  // Fallback: use body text minus nav/footer
  if (fullText.length < 200) {
    $("nav, footer, header, .menu, .sidebar, .breadcrumb").remove();
    fullText = $("body").text().trim();
  }

  if (fullText.length < 50) {
    console.warn(`  [WARN] Very short content for ${entry.reference}`);
    return null;
  }

  // Collapse excessive whitespace while preserving paragraph breaks
  fullText = fullText.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  // Extract date from the decision body if not already known
  let date = entry.date;
  if (!date) {
    const dateMatch = fullText.match(
      /(?:Warszawa,?\s+)?dnia\s+(\d{1,2}\s+[a-ząćęłńóśźż]+\s+\d{4})\s*r?\./i,
    );
    if (dateMatch) {
      date = parsePolishDate(dateMatch[1]!);
    }
  }

  // Extract entity name
  const entityName = extractEntityName(fullText);

  // Extract fine amount
  const fineAmount = extractFineAmount(fullText);

  // Extract GDPR articles
  const gdprArticles = extractGdprArticles(fullText);

  // Classify type based on content and tags
  const type = classifyDecisionType(fullText, entry.tags);

  // Classify topics
  const topics = classifyTopics(fullText);

  // Build summary from the first substantive paragraph (after formalities)
  let summary = buildSummary(fullText, entry.reference);

  // Build title — prefer the listing title, fall back to a generated one
  let title = entry.title;
  if (!title || title.length < 10) {
    title = `Decyzja Prezesa UODO — ${entry.reference}`;
    if (entityName) {
      title += ` (${entityName})`;
    }
  }

  return {
    reference: entry.reference,
    title,
    date,
    type,
    entity_name: entityName,
    fine_amount: fineAmount,
    summary,
    full_text: fullText,
    topics,
    gdpr_articles: gdprArticles.length > 0 ? JSON.stringify(gdprArticles) : null,
    status: "final",
  };
}

/**
 * Build a summary from the decision full text.
 *
 * Strategy: look for the "Uzasadnienie" section start and grab the first
 * 2–3 sentences, or fall back to the first substantive paragraph.
 */
function buildSummary(text: string, reference: string): string | null {
  // Look for "Uzasadnienie" marker
  const uzasadnienieIdx = text.indexOf("Uzasadnienie");
  let summarySource = uzasadnienieIdx > 0
    ? text.substring(uzasadnienieIdx + "Uzasadnienie".length)
    : text;

  // Skip very short preambles and find substantive content
  // Remove leading whitespace and numbering
  summarySource = summarySource.replace(/^\s*[\d.)\s]+/, "").trim();

  // Take the first ~500 characters, breaking at a sentence boundary
  if (summarySource.length > 500) {
    const cutoff = summarySource.substring(0, 600);
    const sentenceEnd = cutoff.lastIndexOf(".");
    if (sentenceEnd > 200) {
      summarySource = cutoff.substring(0, sentenceEnd + 1);
    } else {
      summarySource = cutoff.substring(0, 500) + "...";
    }
  }

  return summarySource.length > 20 ? summarySource.trim() : null;
}

// ---------------------------------------------------------------------------
// Guidance listing page — discover guidance document URLs
// ---------------------------------------------------------------------------

/**
 * Discover guidance document URLs from UODO guidance listing pages.
 */
async function discoverGuidelineUrls(): Promise<
  Array<{ url: string; title: string; sectionId: string }>
> {
  const entries: Array<{ url: string; title: string; sectionId: string }> = [];

  for (const section of GUIDANCE_SECTIONS) {
    const effectiveMax = maxPagesOverride
      ? Math.min(maxPagesOverride, section.maxPages)
      : section.maxPages;

    console.log(
      `\n--- Discovering guidance URLs from ${section.id} (up to ${effectiveMax} pages) ---`,
    );

    for (let page = 1; page <= effectiveMax; page++) {
      const listUrl =
        page === 1
          ? `${BASE_URL}${section.path}`
          : `${BASE_URL}${section.path}?page=${page}`;

      const html = await rateLimitedFetch(listUrl);
      if (!html) {
        console.warn(`  [WARN] Could not fetch guidance page ${page}`);
        continue;
      }

      const $ = cheerio.load(html);
      let pageEntries = 0;

      // Guidance pages list documents as linked items
      // Links follow /pl/{section_number}/{doc_id} pattern
      $("a[href]").each((_i, el) => {
        const href = $(el).attr("href");
        if (!href) return;

        // Match guidance document links: /pl/NNN/NNNN or /pl/NNN/NNNN
        const guidanceMatch = href.match(
          /^\/pl\/(\d{3})\/(\d+)$/,
        );
        if (!guidanceMatch) return;

        const sectionNum = guidanceMatch[1]!;
        // Only include links belonging to known guidance sections
        if (!section.path.includes(sectionNum)) return;

        const fullUrl = `${BASE_URL}${href}`;
        if (entries.some((e) => e.url === fullUrl)) return;

        const title = $(el).text().trim();
        if (title.length < 5) return;

        entries.push({ url: fullUrl, title, sectionId: section.id });
        pageEntries++;
      });

      if (pageEntries === 0 && page > 1) {
        console.log(
          `  No new URLs on page ${page} — stopping pagination for ${section.id}`,
        );
        break;
      }
    }
  }

  console.log(`  Discovered ${entries.length} guidance documents total`);
  return entries;
}

// ---------------------------------------------------------------------------
// Individual guidance page parsing
// ---------------------------------------------------------------------------

/**
 * Parse a single UODO guidance page into a structured record.
 */
function parseGuidelinePage(
  html: string,
  entry: { url: string; title: string; sectionId: string },
): ParsedGuideline | null {
  const $ = cheerio.load(html);

  // Extract page title
  let title = $("h1, h2").first().text().trim() || entry.title;
  if (title.length < 5) title = entry.title;

  // Extract full text
  let fullText = "";

  const contentSelectors = [
    "article",
    ".content",
    "main .container",
    "main",
    "#content",
  ];

  for (const selector of contentSelectors) {
    const el = $(selector);
    if (el.length > 0) {
      fullText = el.text().trim();
      if (fullText.length > 100) break;
    }
  }

  if (fullText.length < 100) {
    $("nav, footer, header, .menu, .sidebar, .breadcrumb").remove();
    fullText = $("body").text().trim();
  }

  if (fullText.length < 50) {
    console.warn(`  [WARN] Very short content for guidance: ${entry.url}`);
    return null;
  }

  fullText = fullText.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  // Extract date from metadata or content
  let date: string | null = null;

  // Look for date patterns in the page
  const datePatterns = [
    /(?:Stan prawny na|Data|Opublikowano|Data publikacji)[:\s]+(\d{2}\.\d{2}\.\d{4})/i,
    /(?:Stan prawny na|Data|Opublikowano)[:\s]+(\d{1,2}\s+[a-ząćęłńóśźż]+\s+\d{4})/i,
    /(\d{2}\.\d{2}\.\d{4})/,
    /(\d{1,2}\s+[a-ząćęłńóśźż]+\s+\d{4})\s*r?\./i,
  ];

  for (const pattern of datePatterns) {
    const match = fullText.match(pattern);
    if (match?.[1]) {
      date = parsePolishDate(match[1]);
      if (date) break;
    }
  }

  // Generate a reference from the URL
  const urlParts = entry.url.split("/");
  const docId = urlParts[urlParts.length - 1];
  const sectionNum = urlParts[urlParts.length - 2];
  const reference = `UODO-GUIDE-${sectionNum}-${docId}`;

  // Build summary from first paragraph
  let summary: string | null = null;
  const firstPara = fullText.substring(0, 600);
  const sentenceEnd = firstPara.lastIndexOf(".");
  if (sentenceEnd > 50) {
    summary = firstPara.substring(0, sentenceEnd + 1).trim();
  }

  // Classify topics
  const topics = classifyTopics(fullText);

  return {
    reference,
    title,
    date,
    type: "guideline",
    summary,
    full_text: fullText,
    topics,
    language: "pl",
  };
}

// ---------------------------------------------------------------------------
// Topics seeding
// ---------------------------------------------------------------------------

const TOPICS = [
  {
    id: "consent",
    name_pl: "Zgoda",
    name_en: "Consent",
    description:
      "Zbieranie, ważność i wycofanie zgody na przetwarzanie danych osobowych (art. 7 RODO).",
  },
  {
    id: "cookies",
    name_pl: "Pliki cookies i śledzenie",
    name_en: "Cookies and trackers",
    description:
      "Umieszczanie i odczytywanie plików cookies i śledzących na urządzeniach użytkowników.",
  },
  {
    id: "transfers",
    name_pl: "Przekazywanie danych do państw trzecich",
    name_en: "International transfers",
    description:
      "Przekazywanie danych osobowych do państw trzecich lub organizacji międzynarodowych (art. 44–49 RODO).",
  },
  {
    id: "dpia",
    name_pl: "Ocena skutków dla ochrony danych (DPIA)",
    name_en: "Data Protection Impact Assessment (DPIA)",
    description:
      "Ocena ryzyka dla praw i wolności osób przy przetwarzaniu wysokiego ryzyka (art. 35 RODO).",
  },
  {
    id: "breach_notification",
    name_pl: "Naruszenie ochrony danych",
    name_en: "Data breach notification",
    description:
      "Zgłaszanie naruszeń ochrony danych do UODO i osób, których dane dotyczą (art. 33–34 RODO).",
  },
  {
    id: "privacy_by_design",
    name_pl: "Ochrona danych w fazie projektowania",
    name_en: "Privacy by design",
    description:
      "Uwzględnianie ochrony danych w fazie projektowania i domyślna ochrona danych (art. 25 RODO).",
  },
  {
    id: "employee_monitoring",
    name_pl: "Monitoring pracowników",
    name_en: "Employee monitoring",
    description:
      "Monitorowanie pracowników w miejscu pracy, w tym monitoring wizyjny i poczty elektronicznej.",
  },
  {
    id: "health_data",
    name_pl: "Dane dotyczące zdrowia",
    name_en: "Health data",
    description:
      "Przetwarzanie danych dotyczących zdrowia — szczególna kategoria danych (art. 9 RODO).",
  },
  {
    id: "children",
    name_pl: "Dane dzieci",
    name_en: "Children's data",
    description:
      "Ochrona danych osobowych dzieci, w szczególności w usługach internetowych (art. 8 RODO).",
  },
];

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------

function initDatabase(): Database.Database {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (force && existsSync(DB_PATH)) {
    unlinkSync(DB_PATH);
    console.log(`Deleted existing database at ${DB_PATH}`);
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);

  return db;
}

function seedTopics(db: Database.Database): void {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO topics (id, name_pl, name_en, description) VALUES (?, ?, ?, ?)",
  );

  const insertAll = db.transaction(() => {
    for (const t of TOPICS) {
      insert.run(t.id, t.name_pl, t.name_en, t.description);
    }
  });

  insertAll();
  console.log(`Seeded ${TOPICS.length} topics`);
}

function insertDecision(
  db: Database.Database,
  d: ParsedDecision,
): boolean {
  try {
    db.prepare(
      `INSERT OR IGNORE INTO decisions
        (reference, title, date, type, entity_name, fine_amount, summary, full_text, topics, gdpr_articles, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      d.reference,
      d.title,
      d.date,
      d.type,
      d.entity_name,
      d.fine_amount,
      d.summary,
      d.full_text,
      d.topics,
      d.gdpr_articles,
      d.status,
    );
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`  [WARN] DB insert failed for ${d.reference}: ${message}`);
    return false;
  }
}

function insertGuideline(
  db: Database.Database,
  g: ParsedGuideline,
): boolean {
  try {
    db.prepare(
      `INSERT INTO guidelines
        (reference, title, date, type, summary, full_text, topics, language)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      g.reference,
      g.title,
      g.date,
      g.type,
      g.summary,
      g.full_text,
      g.topics,
      g.language,
    );
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`  [WARN] DB insert failed for guideline "${g.title}": ${message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== UODO Ingestion Crawler ===");
  console.log(`Database: ${DB_PATH}`);
  console.log(`Mode: ${dryRun ? "DRY RUN" : force ? "FORCE (rebuild)" : resume ? "RESUME" : "NORMAL"}`);

  const state = loadState();
  const processedSet = new Set(state.processedUrls);

  let db: Database.Database | null = null;
  if (!dryRun) {
    db = initDatabase();
    seedTopics(db);
  }

  // -----------------------------------------------------------------------
  // Phase 1: Decisions
  // -----------------------------------------------------------------------

  const decisionEntries = await discoverDecisionUrls();
  let decisionsIngested = 0;
  let decisionsSkipped = 0;
  let decisionErrors = 0;

  console.log(`\n--- Ingesting ${decisionEntries.length} decisions ---`);

  for (let i = 0; i < decisionEntries.length; i++) {
    const entry = decisionEntries[i]!;
    const progress = `[${i + 1}/${decisionEntries.length}]`;

    if (resume && processedSet.has(entry.url)) {
      decisionsSkipped++;
      continue;
    }

    if ((i + 1) % 25 === 0 || i === 0) {
      console.log(
        `  ${progress} Fetching ${entry.reference}... (${decisionsIngested} ingested, ${decisionsSkipped} skipped)`,
      );
    }

    const html = await rateLimitedFetch(entry.url);
    if (!html) {
      console.warn(`  ${progress} [ERROR] Could not fetch ${entry.url}`);
      state.errors.push(`${new Date().toISOString()} - fetch failed: ${entry.url}`);
      decisionErrors++;
      continue;
    }

    const parsed = parseDecisionPage(html, entry);
    if (!parsed) {
      console.warn(`  ${progress} [ERROR] Could not parse ${entry.reference}`);
      state.errors.push(
        `${new Date().toISOString()} - parse failed: ${entry.reference}`,
      );
      decisionErrors++;
      continue;
    }

    if (dryRun) {
      console.log(
        `  ${progress} [DRY] ${parsed.reference} | ${parsed.type} | fine=${parsed.fine_amount ?? "none"} | entity=${parsed.entity_name ?? "unknown"} | arts=${parsed.gdpr_articles ?? "none"}`,
      );
    } else {
      if (insertDecision(db!, parsed)) {
        decisionsIngested++;
      }
    }

    processedSet.add(entry.url);
    state.processedUrls = [...processedSet];
    state.decisionsIngested = decisionsIngested;

    // Save state periodically (every 50 decisions)
    if (!dryRun && (decisionsIngested + decisionsSkipped) % 50 === 0) {
      saveState(state);
    }
  }

  console.log(
    `\n  Decisions: ${decisionsIngested} ingested, ${decisionsSkipped} skipped, ${decisionErrors} errors`,
  );

  // -----------------------------------------------------------------------
  // Phase 2: Guidelines
  // -----------------------------------------------------------------------

  const guidelineEntries = await discoverGuidelineUrls();
  let guidelinesIngested = 0;
  let guidelinesSkipped = 0;
  let guidelineErrors = 0;

  console.log(`\n--- Ingesting ${guidelineEntries.length} guidelines ---`);

  for (let i = 0; i < guidelineEntries.length; i++) {
    const entry = guidelineEntries[i]!;
    const progress = `[${i + 1}/${guidelineEntries.length}]`;

    if (resume && processedSet.has(entry.url)) {
      guidelinesSkipped++;
      continue;
    }

    console.log(`  ${progress} Fetching: ${entry.title.substring(0, 60)}...`);

    const html = await rateLimitedFetch(entry.url);
    if (!html) {
      console.warn(`  ${progress} [ERROR] Could not fetch ${entry.url}`);
      state.errors.push(`${new Date().toISOString()} - fetch failed: ${entry.url}`);
      guidelineErrors++;
      continue;
    }

    const parsed = parseGuidelinePage(html, entry);
    if (!parsed) {
      console.warn(`  ${progress} [ERROR] Could not parse guideline`);
      state.errors.push(
        `${new Date().toISOString()} - parse failed: ${entry.url}`,
      );
      guidelineErrors++;
      continue;
    }

    if (dryRun) {
      console.log(
        `  ${progress} [DRY] ${parsed.reference} | ${parsed.title.substring(0, 50)} | date=${parsed.date ?? "unknown"}`,
      );
    } else {
      if (insertGuideline(db!, parsed)) {
        guidelinesIngested++;
      }
    }

    processedSet.add(entry.url);
    state.processedUrls = [...processedSet];
    state.guidelinesIngested = guidelinesIngested;
  }

  console.log(
    `\n  Guidelines: ${guidelinesIngested} ingested, ${guidelinesSkipped} skipped, ${guidelineErrors} errors`,
  );

  // -----------------------------------------------------------------------
  // Final summary
  // -----------------------------------------------------------------------

  state.processedUrls = [...processedSet];
  state.decisionsIngested = decisionsIngested;
  state.guidelinesIngested = guidelinesIngested;
  saveState(state);

  if (db) {
    const decisionCount = (
      db.prepare("SELECT count(*) as cnt FROM decisions").get() as {
        cnt: number;
      }
    ).cnt;
    const guidelineCount = (
      db.prepare("SELECT count(*) as cnt FROM guidelines").get() as {
        cnt: number;
      }
    ).cnt;
    const decisionFtsCount = (
      db.prepare("SELECT count(*) as cnt FROM decisions_fts").get() as {
        cnt: number;
      }
    ).cnt;
    const guidelineFtsCount = (
      db.prepare("SELECT count(*) as cnt FROM guidelines_fts").get() as {
        cnt: number;
      }
    ).cnt;
    const topicCount = (
      db.prepare("SELECT count(*) as cnt FROM topics").get() as {
        cnt: number;
      }
    ).cnt;

    console.log(`\n=== Database summary ===`);
    console.log(`  Topics:         ${topicCount}`);
    console.log(`  Decisions:      ${decisionCount} (FTS entries: ${decisionFtsCount})`);
    console.log(`  Guidelines:     ${guidelineCount} (FTS entries: ${guidelineFtsCount})`);
    console.log(`  State file:     ${STATE_FILE}`);

    db.close();
  }

  console.log(`\nDone.`);

  if (decisionErrors + guidelineErrors > 0) {
    console.log(
      `\n[WARN] ${decisionErrors + guidelineErrors} total errors — check state file for details.`,
    );
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
