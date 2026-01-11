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

  // Lightly blend selected sentences into a natural paragraph without adding words/facts.
  const blended = selected.join(" And you know, ");
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
  "I don’t have that in my trail notes yet. If you can point me to a page, place, or time period, I’ll take another look.",
  "I’m not seeing that in the pages I have. Tell me a person, place, or era and I’ll track it down.",
  "That detail isn’t in my records yet. Give me a clue—people, places, or events—and I’ll dig in.",
  "I don’t know that from the site pages so far. If you narrow the topic, I’ll try again.",
  "I’m missing that piece in the current pages. If you can point me to a section, I’ll do my best to help.",
];

function pickFallback() {
  return FALLBACK_RESPONSES[Math.floor(Math.random() * FALLBACK_RESPONSES.length)];
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
  const raw = await fs.readFile(DATA_PATH, "utf8");
  const { chunks } = JSON.parse(raw);
  return chunks;
}

async function askBly(question) {
  const chunks = await loadChunks();
  if (!chunks || chunks.length === 0) {
    return pickFallback();
  }
  if (isGreeting(question)) {
    return pickGreeting();
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

  const answer = extractiveAnswer(question, ranked);
  if (!answer) return pickFallback();

  const folksyPrefix = [
    "Well now, let me recall...",
    "Shoot, the way it's told...",
    "You know, back in the day...",
    "Folks 'round here say...",
  ];
  const folksySuffix = [
    "That's the straight scoop from the records.",
    "Ain't that somethin'? Pulled right from the pages.",
    "And that's how it went, far as the stories go.",
  ];
  const prefix = folksyPrefix[Math.floor(Math.random() * folksyPrefix.length)];
  const suffix = folksySuffix[Math.floor(Math.random() * folksySuffix.length)];
  return `${prefix} ${answer} ${suffix}`;
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
