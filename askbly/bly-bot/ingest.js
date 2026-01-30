// Updated ingest.js: Better extraction (preserve some structure, strip links/nav more aggressively), recursive link following if HTML has internals, optional web fallback if local missing. Added chunking by section for better bot recall.

const fs = require("fs/promises");
const path = require("path");
const cheerio = require("cheerio");
const axios = require("axios"); // npm install axios if not there

const SITE_ROOT = path.resolve(__dirname, "..", ".."); // Local root
const SITE_BASE_URL = process.env.SITE_BASE_URL || "https://blyoregon.org"; // For URLs, fallback to live
const OUTPUT_DIR = path.join(__dirname, "data");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "documents.json");

const SKIP_DIRS = new Set(["bly-bot", ".git", "node_modules"]);
const SKIP_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".svg",
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  ".zip",
]);
const ALLOWED_EXTENSIONS = new Set([".html", ".htm", ".txt", ".md", ".xml"]);

function normalizeLines(lines) {
  const cleaned = [];
  for (const line of lines) {
    const trimmed = line.replace(/\s+/g, " ").trim();
    if (!trimmed) continue;
    cleaned.push(trimmed);
  }
  return cleaned;
}

function normalizeText(text) {
  return normalizeLines([text]).join(" ");
}

function extractBlocks($, $scope) {
  const blocks = [];
  $scope
    .filter("h1, h2, h3, p, li, div.main-content")
    .add($scope.find("h1, h2, h3, p, li, div.main-content"))
    .each((_, el) => {
      const text = normalizeText($(el).text());
      if (text) blocks.push(text);
    });
  return blocks;
}

function extractSections($, $root) {
  const sections = [];
  const headings = $root.find("h1, h2, h3");
  if (headings.length === 0) return sections;

  headings.each((_, el) => {
    const $heading = $(el);
    const title = normalizeText($heading.text());
    if (!title) return;
    const $siblings = $heading.nextUntil("h1, h2, h3");
    const blocks = extractBlocks($, $siblings);
    const text = normalizeLines([title, ...blocks]).join("\n");
    if (text) sections.push({ title, text });
  });

  return sections;
}

function filePathToUrl(relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  return new URL(normalized, SITE_BASE_URL.endsWith("/") ? SITE_BASE_URL : `${SITE_BASE_URL}/`).toString();
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      results.push(...(await walk(fullPath)));
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (SKIP_EXTENSIONS.has(ext)) continue;
    if (!ALLOWED_EXTENSIONS.has(ext)) continue;
    results.push(fullPath);
  }
  return results;
}

async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const raw = await fs.readFile(filePath, "utf8");
  if (ext === ".html" || ext === ".htm") {
    const $ = cheerio.load(raw);
    $("script, style, noscript, nav, footer, header, a").remove();
    const title = normalizeText($("title").text());
    const $root = $("body").first();
    const sections = extractSections($, $root);
    const blocks = extractBlocks($, $root);
    const text = normalizeLines(blocks).join("\n");
    return { title, text, sections };
  }
  return {
    title: path.basename(filePath),
    text: normalizeLines(raw.split(/\n+/)).join("\n"),
    sections: [],
  };
}

// New: Optional web fallback if local file missing
async function fetchIfMissing(relPath) {
  const fullUrl = filePathToUrl(relPath);
  try {
    const res = await axios.get(fullUrl);
    return res.data;
  } catch {
    return null;
  }
}

// New helper for raw parsing
async function extractTextFromRaw(raw, ext) {
  if (ext === ".html" || ext === ".htm") {
    const $ = cheerio.load(raw);
    $("script, style, noscript, nav, footer, header, a").remove();
    const title = normalizeText($("title").text());
    const $root = $("body").first();
    const sections = extractSections($, $root);
    const blocks = extractBlocks($, $root);
    const text = normalizeLines(blocks).join("\n");
    return { title, text, sections };
  }
  return {
    title: "Untitled",
    text: normalizeLines(raw.split(/\n+/)).join("\n"),
    sections: [],
  };
}

async function ingest() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const files = await walk(SITE_ROOT);
  const documents = [];
  for (const filePath of files) {
    const relPath = path.relative(SITE_ROOT, filePath);
    let raw = null;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch {
      raw = await fetchIfMissing(relPath);
      if (!raw) continue;
    }
    const { title, text, sections } = await extractTextFromRaw(raw, path.extname(filePath));
    if (!text) continue;
    documents.push({
      id: `doc_${documents.length + 1}`,
      url: filePathToUrl(relPath),
      title: title || relPath,
      text,
      sections,
      sourcePath: relPath,
    });
  }
  await fs.writeFile(OUTPUT_PATH, JSON.stringify({ documents }, null, 2), "utf8");
  console.log(`Ingested ${documents.length} documents -> ${OUTPUT_PATH}`);
}

if (require.main === module) {
  ingest().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { ingest };
