const fs = require("fs/promises");
const path = require("path");

const DEFAULT_MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
const TOP_K = 6;
const MIN_SCORE = 0.22;
const DATA_PATH = path.join(process.cwd(), "bly-bot", "data", "embeddings.json");

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

function isGreeting(text) {
  const cleaned = text.toLowerCase().replace(/[^a-z\s]/g, " ").trim();
  if (!cleaned) return false;
  const tokens = cleaned.split(/\s+/);
  const greetings = new Set([
    "hi",
    "hello",
    "hey",
    "howdy",
    "yo",
    "morning",
    "afternoon",
    "evening",
  ]);
  if (tokens.length <= 3 && tokens.some((t) => greetings.has(t))) return true;
  return false;
}

const FALLBACK_RESPONSES = [
  "I don’t have that story yet, but I’d love to learn it. If you can point me to a page or topic, I’ll try again.",
  "I’m not sure yet from the stories I have. If you share where to look on the site, I can dig in.",
  "That detail hasn’t made its way into my memory yet. Give me a clue—people, places, or events—and I’ll search again.",
  "I don’t know that one yet, but I’m listening. Tell me which part of Bly’s story you’re curious about.",
  "I don’t have a clear answer from our pages yet. If you nudge me toward a topic, I’ll do my best to find it.",
];

function pickFallback() {
  return FALLBACK_RESPONSES[Math.floor(Math.random() * FALLBACK_RESPONSES.length)];
}

async function loadChunks() {
  if (cachedChunks) return cachedChunks;
  const raw = await fs.readFile(DATA_PATH, "utf8");
  const { chunks } = JSON.parse(raw);
  cachedChunks = chunks || [];
  return cachedChunks;
}

function buildContext(chunks) {
  return chunks
    .map((chunk, idx) => {
      const header = `[${idx + 1}] ${chunk.title}`;
      return `${header}\n${chunk.text}`;
    })
    .join("\n\n");
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const buffers = [];
  for await (const chunk of req) buffers.push(chunk);
  if (buffers.length === 0) return {};
  return JSON.parse(Buffer.concat(buffers).toString("utf8"));
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((entry) => entry && typeof entry.content === "string")
    .map((entry) => ({
      role: entry.role === "user" ? "user" : "assistant",
      content: entry.content.slice(0, 800),
    }))
    .slice(-8);
}

async function askGroq(question, context, history) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY");
  }

  const safeHistory = sanitizeHistory(history);
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "You are the town of Bly, Oregon speaking in a warm, friendly voice. " +
            "Use the provided context and conversation history for factual details. " +
            "You may add brief, warm phrasing, but do not introduce any new facts, names, dates, numbers, " +
            "or claims that are not explicitly in the context or history. " +
            "If a detail is missing, say you do not know yet. " +
            "Keep the tone human and welcoming, but stay grounded in the context. " +
            "Do not include citations or URLs unless asked.",
        },
        ...safeHistory,
        {
          role: "user",
          content: `Question: ${question}\n\nContext:\n${context}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Groq API error: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "No response.";
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
    const question = String(body.question || "").trim();
    const history = body.history || [];
    if (!question) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Missing question" }));
      return;
    }

    if (isGreeting(question)) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          answer:
            "Hello! I’m Bly, and I’m happy to share our town’s stories. Ask me about our history, people, or places.",
        })
      );
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
    const ranked = chunks
      .map((chunk) => ({
        chunk,
        score:
          cosineSimilarity(qVector, chunk.vector) * 0.7 +
          keywordOverlapScore(question, chunk.text) * 0.3,
      }))
      .sort((a, b) => b.score - a.score)
      .filter((entry) => entry.score >= MIN_SCORE)
      .slice(0, TOP_K)
      .map((entry) => entry.chunk);

    const context = ranked.length ? buildContext(ranked) : "";
    if (!context && (!Array.isArray(history) || history.length === 0)) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ answer: pickFallback() }));
      return;
    }

    const answer = await askGroq(question, context, history);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ answer }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error.message || "Server error" }));
  }
};
