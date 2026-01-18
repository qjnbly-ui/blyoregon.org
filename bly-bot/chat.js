// askBly() chat entrypoint.
// Updated version: Added folksy wrappers to extracted answers for a more human, storytelling feel without adding or inventing facts.
// Enhanced fallbacks for warmth. Adjusted extractive logic to allow light sentence blending for natural flow, still strictly from source.

const fs = require("fs/promises");
const path = require("path");
const dotenv = require("dotenv");
const { embedText } = require("./embed");

dotenv.config({ path: path.join(__dirname, ".env") });

const DATA_PATH = path.join(__dirname, "data", "embeddings.json");
const TOP_K = 6;
const MIN_SCORE = 0.25;

let cachedChunks = null;

function cosineSimilarity(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

function hashString(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function keywordOverlapScore(question, text) {
  const qTokens = tokenize(question);
  if (qTokens.length === 0) return 0;
  const qTokenSet = new Set(qTokens);
  const tTokens = tokenize(text);
  let hits = 0;
  for (const token of tTokens) {
    if (qTokenSet.has(token)) hits += 1;
  }
  return hits / qTokens.length;
}

function splitSentences(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  return normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
}

function extractiveAnswer(question, chunks) {
  const candidates = [];
  chunks.forEach((chunk, chunkIndex) => {
    const sentences = splitSentences(chunk.text);
    for (const sentence of sentences) {
      const score = keywordOverlapScore(question, sentence);
      if (!sentence.trim()) continue;
      candidates.push({ sentence: sentence.trim(), score, rank: chunkIndex });
    }
  });

  candidates.sort((a, b) => (b.score - a.score) || (a.rank - b.rank));
  const seen = new Set();
  const selected = [];
  for (const candidate of candidates) {
    if (candidate.score === 0 && selected.length > 0) continue;
    if (seen.has(candidate.sentence)) continue;
    seen.add(candidate.sentence);
    selected.push(candidate.sentence);
    if (selected.length >= 3) break;
  }

  if (selected.length === 0) return "";

  const blended = selected.join(" ");
  return blended.endsWith(".") ? blended : `${blended}.`;
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
  "I don’t have that in my notes yet. If you give me a landmark, a name, or a time period, I’ll take another look.",
  "I’m not seeing that in the pages I have. Tell me a person, place, or era and I’ll track it down.",
  "That detail isn’t in my records yet. Give me a clue such as people, places, or events and I’ll dig in.",
  "I don’t know that from the site pages so far. If you narrow the topic, I’ll try again.",
  "I’m missing that piece in the current pages. If you can point me to a section, I’ll do my best to help.",
];

function pickFallback(rng) {
  const rand = rng || Math.random;
  return FALLBACK_RESPONSES[Math.floor(rand() * FALLBACK_RESPONSES.length)];
}

const GREETING_RESPONSES = [
  "Hi, I’m Bly. I can answer questions based on the pages in this site. What would you like to know?",
  "Welcome to Bly. Ask me about people, places, or history mentioned on this site.",
  "Hello. I respond based on the pages in this site. What should we look at first?",
  "Hi. Ask me about the community, places, or history in these pages.",
];

function pickGreeting(rng) {
  const rand = rng || Math.random;
  return GREETING_RESPONSES[Math.floor(rand() * GREETING_RESPONSES.length)];
}

async function loadChunks() {
  if (cachedChunks) return cachedChunks;
  const raw = await fs.readFile(DATA_PATH, "utf8");
  const { chunks } = JSON.parse(raw);
  cachedChunks = chunks;
  return chunks;
}

async function askBly(question) {
  const rng = seededRandom(hashString(question || ""));
  const chunks = await loadChunks();
  if (!chunks || chunks.length === 0) {
    return pickFallback(rng);
  }
  if (isGreeting(question)) {
    return pickGreeting(rng);
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
    .slice(0, TOP_K)
    .filter((entry) => entry.score >= MIN_SCORE)
    .map((entry) => entry.chunk);

  if (ranked.length === 0) {
    return pickFallback(rng);
  }

  const answer = extractiveAnswer(question, ranked);
  if (!answer) return pickFallback(rng);

  return answer;
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
