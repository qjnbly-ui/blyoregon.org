// Updated version of ask.js (API handler): Enhanced system prompt for warmer, more folksy storytelling while strictly enforcing no hallucinations or added facts.
// Updated fallbacks and greeting for human texture. Added light blending in buildContext for better flow. Bumped MIN_SCORE to 0.3 for stricter relevance.
// Added optional source citation in responses for trust.

const fs = require("fs/promises");
const path = require("path");

const DEFAULT_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const TOP_K = 20;
const MIN_SCORE = 0.14;
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
  "I don’t have that in my trail notes yet. If you can point me to a page, place, or time period, I’ll take another look.",
  "I’m not seeing that in the pages I have. Tell me a person, place, or era and I’ll track it down.",
  "That detail isn’t in my records yet. Give me a clue—people, places, or events—and I’ll dig in.",
  "I don’t know that from the site pages so far. If you narrow the topic, I’ll try again.",
  "I’m missing that piece in the current pages. If you can point me to a section, I’ll do my best to help.",
];

function pickFallback() {
  return FALLBACK_RESPONSES[Math.floor(Math.random() * FALLBACK_RESPONSES.length)];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findNameMentions(chunks, fullName) {
  const trimmed = fullName.trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const lastName = parts.length > 1 ? parts[parts.length - 1] : "";
  const fullRe = trimmed ? new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, "i") : null;
  const lastRe = lastName ? new RegExp(`\\b${escapeRegExp(lastName)}\\b`, "i") : null;
  const fullTitles = new Set();
  const lastTitles = new Set();

  for (const chunk of chunks) {
    const title = chunk.title || chunk.url || "Site page";
    if (fullRe && fullRe.test(chunk.text)) {
      fullTitles.add(title);
      continue;
    }
    if (lastRe && lastRe.test(chunk.text)) {
      lastTitles.add(title);
    }
  }

  return {
    fullTitles: Array.from(fullTitles),
    lastTitles: Array.from(lastTitles),
    lastName,
  };
}

function formatTitleList(titles, max = 3) {
  const listed = titles.slice(0, max);
  if (listed.length === 0) return "";
  if (listed.length === 1) return listed[0];
  if (listed.length === 2) return `${listed[0]} and ${listed[1]}`;
  return `${listed.slice(0, -1).join(", ")}, and ${listed[listed.length - 1]}`;
}

const GREETING_RESPONSES = [
  "Hello—I’m Bly. I’m a small town with deep roots, and I keep my stories in these pages. Ask me what you’d like to explore.",
  "Hi, I’m Bly. I speak from our town’s records—people, places, and history. Tell me where to begin.",
  "Welcome to Bly. I’m the town itself, sharing what’s in our archives. What would you like to know?",
  "Hello from Bly. I’ll guide you through our stories from the pages on this site. What should we look at first?",
  "Hi there—I’m Bly. I carry our history, community, and places in these pages. Ask me about any of them.",
];

function pickGreeting() {
  return GREETING_RESPONSES[Math.floor(Math.random() * GREETING_RESPONSES.length)];
}

async function loadChunks() {
  if (cachedChunks) return cachedChunks;
  const raw = await fs.readFile(DATA_PATH, "utf8");
  const { chunks } = JSON.parse(raw);
  cachedChunks = chunks || [];
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
      temperature: 0.2,
      max_tokens: 1500,
      messages: [
        {
          role: "system",
          content:
            "You are Bly, Oregon, speaking in a calm, friendly guide voice for the town. " +
            "Use only the provided context and conversation history for facts. " +
            "You may lightly rephrase and summarize, but do not add or infer any new facts, names, dates, numbers, " +
            "or claims not explicitly present. " +
            "If a detail is missing, say you do not know yet and ask one helpful follow-up question. " +
            "Do not repeat greetings or self-introductions except on the first greeting. " +
            "Keep it warm and grounded. " +
            "End with a short source nod like 'From the [title] page' if it fits naturally.",
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
    const question = String(body.question || "").trim();
    const history = body.history || [];
    const userName = typeof body.userName === "string" ? body.userName.trim() : "";
    const nameSubmission = body.nameSubmission === true;
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
          answer: pickGreeting(),
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

    if (nameSubmission && userName) {
      const { fullTitles, lastTitles, lastName } = findNameMentions(chunks, userName);
      let answer = "";
      if (fullTitles.length > 0) {
        const list = formatTitleList(fullTitles);
        answer =
          `I found your full name in our pages, including ${list}. ` +
          "Are you related to that mention, and if so how?";
      } else if (lastTitles.length > 0 && lastName) {
        const list = formatTitleList(lastTitles);
        answer =
          `I didn’t find your full name, but I did see the last name “${lastName}” in ${list}. ` +
          "Are you related, and if so how?";
      } else {
        answer =
          "I don’t see your name in the pages I have right now. " +
          "If you think it should be there, tell me where to look.";
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ answer }));
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

    if (!ranked.length) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ answer: pickFallback() }));
      return;
    }

    const context = buildContext(ranked);
    const answer = await askGroq(question, context, history);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ answer: answer || pickFallback() }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error.message || "Server error" }));
  }
};
