const fs = require("fs/promises");
const path = require("path");

const DEFAULT_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const TOP_K = 36;
const MIN_SCORE = 0.1;
const DATA_DIR = path.join(__dirname, "..", "askbly", "site_text_data");
const MAX_CHUNK_CHARS = 1400;

let cachedChunks = null;

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function hashToken(token) {
  let hash = 0;
  for (let i = 0; i < token.length; i += 1) {
    hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function embedText(text) {
  const vectorSize = 256;
  const vector = new Array(vectorSize).fill(0);
  const tokens = tokenize(text);
  for (const token of tokens) {
    const idx = hashToken(token) % vectorSize;
    vector[idx] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}

function cosineSimilarity(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

function buildChunk({ title, text, url, date, source }) {
  return {
    title,
    text,
    url,
    date,
    source,
    vector: embedText(`${title || ""} ${text || ""}`.trim()),
  };
}

function splitMarkdownIntoChunks({ title, body, url, date, source }) {
  if (!body) return [];
  const paragraphs = body.split(/\n\s*\n/).map((para) => para.trim()).filter(Boolean);
  const chunks = [];
  let buffer = "";
  let part = 1;

  for (const para of paragraphs) {
    const next = buffer ? `${buffer}\n\n${para}` : para;
    if (next.length > MAX_CHUNK_CHARS && buffer) {
      chunks.push(buildChunk({ title: part === 1 ? title : `${title} — Part ${part}`, text: buffer, url, date, source }));
      part += 1;
      buffer = para;
      continue;
    }
    buffer = next;
  }

  if (buffer) {
    chunks.push(buildChunk({ title: part === 1 ? title : `${title} — Part ${part}`, text: buffer, url, date, source }));
  }

  return chunks;
}

function parseMarkdownFile(content, filename) {
  const lines = content.split(/\r?\n/);
  let title = "";
  let url = "";
  let date = "";
  let idx = 0;

  if (lines[0] && /^#\s+/.test(lines[0])) {
    title = lines[0].replace(/^#+\s*/, "").trim();
    idx = 1;
  }

  for (; idx < lines.length; idx += 1) {
    const line = lines[idx].trim();
    if (!line) {
      idx += 1;
      break;
    }
    if (/^date:/i.test(line)) {
      date = line.replace(/^date:\s*/i, "").trim();
      continue;
    }
    if (/^url:/i.test(line)) {
      url = line.replace(/^url:\s*/i, "").trim();
      continue;
    }
    break;
  }

  const body = lines.slice(idx).join("\n").trim();
  const fallbackTitle = title || filename.replace(/\.md$/i, "");
  return splitMarkdownIntoChunks({
    title: fallbackTitle,
    body,
    url,
    date,
    source: filename,
  });
}

function keywordOverlapScore(question, text) {
  const qTokens = new Set(tokenize(question));
  if (qTokens.size === 0) return 0;
  const tTokens = tokenize(text);
  let hits = 0;
  for (const token of tTokens) {
    if (qTokens.has(token)) hits += 1;
  }
  return hits / Math.max(tTokens.length, 1);
}

function isSourceRequest(text) {
  return /\b(source|sources|citation|citations|where did you get|where did this come from|reference|references)\b/i.test(
    text
  );
}

function formatSources(chunks, max = 3) {
  const seen = new Set();
  const list = [];
  for (const chunk of chunks) {
    const title = chunk.title || chunk.url || "Site page";
    if (seen.has(title)) continue;
    seen.add(title);
    list.push(`${title}${chunk.url ? ` — ${chunk.url}` : ""}`);
    if (list.length >= max) break;
  }
  if (!list.length) return "";
  return `Sources: ${list.join(" | ")}`;
}

const FALLBACK_RESPONSES = [
  "I don’t have that in my notes yet—but if you give me a landmark, a name, or a time period, I’ll take another look.",
  "I’m not seeing that in the pages I have. Tell me a person, place, or era and I’ll track it down.",
  "That detail isn’t in my records yet. Give me a clue—people, places, or events—and I’ll dig in.",
  "I don’t know that from the site pages so far. If you narrow the topic, I’ll try again.",
  "I’m missing that piece in the current pages. If you can point me to a section, I’ll do my best to help.",
];

function pickFallback() {
  return FALLBACK_RESPONSES[Math.floor(Math.random() * FALLBACK_RESPONSES.length)];
}

async function loadChunks() {
  if (cachedChunks) return cachedChunks;
  let entries = [];
  try {
    entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  } catch (error) {
    cachedChunks = [];
    return cachedChunks;
  }
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md"));
  const chunks = [];
  for (const file of files) {
    const filePath = path.join(DATA_DIR, file.name);
    const content = await fs.readFile(filePath, "utf8");
    chunks.push(...parseMarkdownFile(content, file.name));
  }
  cachedChunks = chunks;
  return cachedChunks;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const buffers = [];
  for await (const chunk of req) buffers.push(chunk);
  if (buffers.length === 0) return {};
  return JSON.parse(Buffer.concat(buffers).toString("utf8"));
}

function buildContext(chunks) {
  return chunks
    .map((chunk, idx) => {
      const header = `[${idx + 1}] ${chunk.title}`;
      return `${header}\n${chunk.text}`;
    })
    .join("\n\n");
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((entry) => entry && typeof entry.content === "string")
    .map((entry) => ({
      role: entry.role === "user" ? "user" : "assistant",
      content: entry.content.slice(0, 800),
    }))
    .slice(-6);
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((entry) => entry && typeof entry.content === "string")
    .map((entry) => ({
      role: entry.role === "user" ? "user" : "assistant",
      content: entry.content.slice(0, 1200),
    }))
    .slice(-12);
}

function injectContextIntoMessages(messages, context, fallbackQuestion) {
  const hydrated = messages.length ? [...messages] : [];
  let lastUserIndex = -1;
  for (let i = hydrated.length - 1; i >= 0; i -= 1) {
    if (hydrated[i].role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  if (lastUserIndex === -1) {
    hydrated.push({
      role: "user",
      content: `Question: ${fallbackQuestion}\n\nContext:\n${context}`,
    });
    return hydrated;
  }
  const lastUser = hydrated[lastUserIndex];
  hydrated[lastUserIndex] = {
    role: "user",
    content: `Question: ${lastUser.content}\n\nContext:\n${context}`,
  };
  return hydrated;
}

async function askGroq(messages) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY");
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      temperature: 0.2,
      max_tokens: 2000,
      messages,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Groq API error: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  try {
    const body = await readJsonBody(req);
    const rawMessages = sanitizeMessages(body.messages);
    const questionFromMessages = rawMessages
      .slice()
      .reverse()
      .find((entry) => entry.role === "user")?.content;
    const question = String(questionFromMessages || body.question || "").trim();
    const history = body.history || [];
  if (!question) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Missing question" }));
    return;
  }

    const chunks = await loadChunks();
    if (!chunks.length) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ answer: pickFallback() }));
      return;
    }

    const qVector = embedText(question);
    const rankedRaw = 
      chunks
        .map((chunk) => {
          const keywordSource = `${chunk.title || ""} ${chunk.text || ""}`.trim();
          return {
            chunk,
            score:
              cosineSimilarity(qVector, chunk.vector) * 0.7 +
              keywordOverlapScore(question, keywordSource) * 0.3,
          };
        })
        .sort((a, b) => b.score - a.score)
        .filter((entry) => entry.score >= MIN_SCORE)
        .slice(0, TOP_K)
        .map((entry) => entry.chunk);
    const ranked = rankedRaw;

    if (!ranked.length) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ answer: pickFallback() }));
      return;
    }

    const context = buildContext(ranked);
    const systemMessage = {
      role: "system",
      content:
        "You are a friendly guide for Bly, Oregon. " +
        "Use the provided context for facts. " +
        "If the context doesn't cover something, say so plainly and ask one helpful follow-up question.",
    };
    const safeHistory = sanitizeHistory(history);
    const conversation = rawMessages.length
      ? injectContextIntoMessages(rawMessages, context, question)
      : [
          ...safeHistory,
          {
            role: "user",
            content: `Question: ${question}\n\nContext:\n${context}`,
          },
        ];
    const answer = await askGroq([systemMessage, ...conversation]);
    const wantsSources = isSourceRequest(question);
    const sources = wantsSources ? formatSources(ranked) : "";
    const baseAnswer = answer || pickFallback();
    const finalAnswer = sources ? `${baseAnswer}\n\n${sources}` : baseAnswer;
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ answer: finalAnswer }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error.message || "Server error" }));
  }
};
