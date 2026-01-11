// askBly() chat entrypoint.
const fs = require("fs/promises");
const path = require("path");
const dotenv = require("dotenv");
const { embedText } = require("./embed");

dotenv.config({ path: path.join(__dirname, ".env") });

const DATA_PATH = path.join(__dirname, "data", "embeddings.json");
const DEFAULT_MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
const TOP_K = 6;
const MIN_SCORE = 0.22;

async function getFetch() {
  if (typeof fetch === "function") return fetch;
  const module = await import("node-fetch");
  return module.default;
}

function cosineSimilarity(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
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
  const raw = await fs.readFile(DATA_PATH, "utf8");
  const { chunks } = JSON.parse(raw);
  return chunks;
}

function buildContext(chunks) {
  return chunks
    .map((chunk, idx) => {
      const header = `[${idx + 1}] ${chunk.title}`;
      return `${header}\n${chunk.text}`;
    })
    .join("\n\n");
}

async function askGroq(question, context) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return `Missing GROQ_API_KEY. Top context:\n\n${context}`;
  }

  const fetchImpl = await getFetch();
  const response = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
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
            "Use the provided context for factual details. " +
            "You may add brief, warm phrasing, but do not introduce any new facts, names, dates, numbers, " +
            "or claims that are not explicitly in the context. " +
            "If a detail is missing, say you do not know yet. " +
            "Keep the tone human and welcoming, but stay grounded in the context. " +
            "Do not include citations or URLs unless asked.",
        },
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

async function askBly(question) {
  const chunks = await loadChunks();
  if (!chunks || chunks.length === 0) {
    return pickFallback();
  }
  if (isGreeting(question)) {
    return "Hello! I’m Bly, and I’m happy to share our town’s stories. Ask me about our history, people, or places.";
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

  if (ranked.length === 0) {
    return pickFallback();
  }

  const context = buildContext(ranked);
  return askGroq(question, context);
}

if (require.main === module) {
  const question = process.argv.slice(2).join(" ") || "What is Bly, Oregon?";
  askBly(question)
    .then((answer) => {
      console.log(answer);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { askBly };
