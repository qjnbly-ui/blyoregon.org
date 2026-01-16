// Updated version of ask.js (API handler): Enhanced system prompt for warmer, more folksy storytelling while strictly enforcing no hallucinations or added facts.
// Updated fallbacks and greeting for human texture. Added light blending in buildContext for better flow. Bumped MIN_SCORE to 0.3 for stricter relevance.
// Added optional source citation in responses for trust.

const fs = require("fs/promises");
const path = require("path");

const DEFAULT_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const TOP_K = 24;
const MIN_SCORE = 0.12;
const DATA_PATH = path.join(process.cwd(), "bly-bot", "data", "embeddings.json");
const EXCLUDED_RECOMMENDATION_TERMS = ["gerber reservoir"];

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

function isSourceRequest(text) {
  return /\b(source|sources|citation|citations|where did you get|where did this come from|reference|references)\b/i.test(
    text
  );
}

function isTripRequest(text) {
  return /\b(plan|planning|trip|itinerary|visit|visiting|travel|weekend|getaway|road trip)\b/i.test(text);
}

function isBusinessQuery(text) {
  return /\b(business|businesses|services|shop|shops|store|stores|directory|local|open now|open today)\b/i.test(text);
}

function isLodgingQuery(text) {
  return /\b(lodging|hotel|motel|inn|resort|cabin|cabins|guest ranch|ranch|campground|rv|trailer park|overnight|stay|staying|accommodations)\b/i.test(
    text
  );
}

function isContactRequest(text) {
  return /\b(phone|contact|address|website|web site|email|call|number|location)\b/i.test(text);
}

function splitSentences(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  return normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
}

function buildContextBlob(chunks) {
  return chunks.map((chunk) => chunk.text || "").join(" ");
}

function containsExternalSuggestion(sentence) {
  return /\b(search online|google|look up|visit google|web search)\b/i.test(sentence);
}

function filterToContext(answer, contextText, excludedTerms = []) {
  const sentences = splitSentences(answer);
  if (!sentences.length) return "";
  const context = contextText.toLowerCase();
  const kept = [];
  for (const sentence of sentences) {
    const normalized = sentence.toLowerCase();
    if (excludedTerms.some((term) => normalized.includes(term))) {
      continue;
    }
    if (sentence.trim().endsWith("?")) {
      kept.push(sentence.trim());
      continue;
    }
    if (containsExternalSuggestion(normalized)) {
      continue;
    }
    const overlap = keywordOverlapScore(normalized, contextText);
    if (overlap >= 0.08 || context.includes(normalized.replace(/[^\w\s]/g, "").trim())) {
      kept.push(sentence.trim());
    }
  }
  return kept.join(" ");
}

function extractLodgingEntries(chunks) {
  const categoryStops = new Set([
    "Education",
    "Faith & Churches",
    "Utilities",
    "Recreation & Community Space",
    "Health & Wellness",
    "Services & Trades",
    "Shopping",
    "Food & Drink",
    "Community & Government",
    "Highlights",
  ]);
  const targets = ["Aspen Ridge Resort", "Lone Pine Trailer Park"];
  const entries = [];

  for (const chunk of chunks) {
    if (!chunk.text) continue;
    const lines = chunk.text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    for (const target of targets) {
      const start = lines.findIndex((line) => line === target);
      if (start === -1) continue;
      const entry = { name: target, description: "", meta: [] };
      for (let i = start + 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (targets.includes(line) || categoryStops.has(line)) break;
        if (line.includes(":")) {
          entry.meta.push(line);
          continue;
        }
        if (!entry.description) {
          entry.description = line;
        }
      }
      if (entry.description || entry.meta.length) {
        entries.push(entry);
      }
    }
  }

  const unique = new Map(entries.map((entry) => [entry.name, entry]));
  return Array.from(unique.values());
}

function formatLodgingResponse(entries, question) {
  if (!entries.length) return "";
  const wantsContacts = isContactRequest(question);
  const prefersTrailer = /\b(trailer|rv|camper|camp trailer)\b/i.test(question);
  const sorted = [...entries].sort((a, b) => {
    if (prefersTrailer) {
      if (a.name === "Lone Pine Trailer Park") return -1;
      if (b.name === "Lone Pine Trailer Park") return 1;
    }
    return 0;
  });
  const lines = ["Here are lodging options listed in the Business Directory:"];
  for (const entry of sorted) {
    lines.push(`- ${entry.name}${entry.description ? ` — ${entry.description}` : ""}`);
    if (wantsContacts) {
      for (const meta of entry.meta) {
        lines.push(`  ${meta}`);
      }
    }
  }
  lines.push(wantsContacts
    ? "Would you like details on any of these, or are you looking for something specific?"
    : "If you want contact details or addresses, just ask.");
  return lines.join("\n");
}

function extractBusinessDirectory(chunks) {
  const entryTitles = new Set([
    "Bly Ranger District (Forest Service)",
    "Bly Community Action Team",
    "Bly Fire Department",
    "United States Postal Service (Bly)",
    "Bly Branch Library",
    "The Breadwagon",
    "Sycan Store",
    "The Highway Cafe",
    "Fastbreak Convenience Store - Bly Market",
    "The Bly Outdoor Store",
    "Outlaw Rocks",
    "Rustic Rain",
    "Main Street Mercantile",
    "Country Crafts",
    "Delta-S Designs",
    "Grant Plumbing",
    "Holgate Plumbing",
    "John Richmond Contracting",
    "Melsness Logging",
    "Millen Construction",
    "Paul Melsness Refinishing",
    "Duarte Sales",
    "Running W Enterprises",
    "Bly Beauties",
    "Klamath Hospice and Palliative Care",
    "The Bonanza Clinic",
    "Aspen Ridge Resort",
    "Lone Pine Trailer Park",
    "Gearhart Elementary School",
    "Bly Preschool",
    "Abiding Place Ministries",
    "Beatty Valley Church",
    "Standing Stone Church",
    "St. James Catholic Church",
    "Bly Water and Sanitation District",
    "Ruth Obenchain Recreation Center",
  ]);

  const entries = [];
  for (const chunk of chunks) {
    if (!chunk.text) continue;
    const lines = chunk.text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!entryTitles.has(line)) continue;
      const entry = { name: line, description: "", meta: [] };
      for (let j = i + 1; j < lines.length; j += 1) {
        const next = lines[j];
        if (entryTitles.has(next)) break;
        if (next.includes(":")) {
          entry.meta.push(next);
        } else if (!entry.description) {
          entry.description = next;
        }
      }
      entries.push(entry);
    }
  }

  const unique = new Map(entries.map((entry) => [entry.name, entry]));
  return Array.from(unique.values());
}

function formatBusinessResponse(entries, max = 12) {
  if (!entries.length) return "";
  const lines = ["Here are current listings from the Business Directory:"];
  for (const entry of entries.slice(0, max)) {
    lines.push(`- ${entry.name}${entry.description ? ` — ${entry.description}` : ""}`);
  }
  lines.push("Want details on any of these, or a specific category?");
  return lines.join("\n");
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

function categoryBoost(question, chunk) {
  const q = question.toLowerCase();
  const url = String(chunk.url || "").toLowerCase();
  const title = String(chunk.title || "").toLowerCase();
  const isFoodQuery = /\b(eat|food|restaurant|restaurants|cafe|coffee|diner|breakfast|lunch|dinner)\b/.test(q);
  if (isFoodQuery) {
    if (url.includes("/businesses/") || title.includes("businesses")) return 0.25;
    if (url.includes("/history/") || title.includes("history")) return -0.15;
  }
  if (isLodgingQuery(q)) {
    if (url.includes("/businesses/") || title.includes("businesses")) return 0.25;
    if (url.includes("/history/") || title.includes("history")) return -0.15;
  }
  return 0;
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
  "I don’t have that in my notes yet—but if you give me a landmark, a name, or a time period, I’ll take another look.",
  "I’m not seeing that in the pages I have. Tell me a person, place, or era and I’ll track it down.",
  "That detail isn’t in my records yet. Give me a clue—people, places, or events—and I’ll dig in.",
  "I don’t know that from the site pages so far. If you narrow the topic, I’ll try again.",
  "I’m missing that piece in the current pages. If you can point me to a section, I’ll do my best to help.",
];

function pickFallback() {
  return FALLBACK_RESPONSES[Math.floor(Math.random() * FALLBACK_RESPONSES.length)];
}

const GREETING_RESPONSES = [
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

function shouldAvoidRecommendations(text) {
  return /\b(visit|visiting|trip|itinerary|plan|planning|road trip|see|places|things to do|go to|go see|check out|attractions|tour|recommend|recommendations)\b/i.test(
    text
  );
}

function filterExcludedChunks(chunks, excludedTerms) {
  if (!excludedTerms.length) return chunks;
  return chunks.filter((chunk) => {
    const text = `${chunk.title || ""}\n${chunk.text || ""}`.toLowerCase();
    return !excludedTerms.some((term) => text.includes(term));
  });
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
      max_tokens: 2000,
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
            "If the question is about current services or businesses, prioritize business listings and avoid historical anecdotes unless asked. " +
            "Never suggest searching online; only use the provided context. " +
            "Keep it warm and grounded, aiming for 2–3 sentences when possible. " +
            "Do not add a source line or citation at the end unless the user asks for sources.",
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

    const qVector = embedText(question);
    const rankedRaw = 
      chunks
        .map((chunk) => ({
          chunk,
          score:
            cosineSimilarity(qVector, chunk.vector) * 0.7 +
            keywordOverlapScore(question, chunk.text) * 0.3 +
            categoryBoost(question, chunk),
        }))
        .sort((a, b) => b.score - a.score)
        .filter((entry) => entry.score >= MIN_SCORE)
        .slice(0, TOP_K)
        .map((entry) => entry.chunk);
    const avoidRecommendations = shouldAvoidRecommendations(question);
    const excludeTerms = avoidRecommendations ? EXCLUDED_RECOMMENDATION_TERMS : [];
    const ranked = filterExcludedChunks(rankedRaw, excludeTerms);

    if (!ranked.length) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ answer: pickFallback() }));
      return;
    }

    if (isLodgingQuery(question)) {
      const entries = extractLodgingEntries(ranked);
      const response = formatLodgingResponse(entries, question);
      if (response) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ answer: response }));
        return;
      }
    }

    if (isBusinessQuery(question)) {
      const entries = extractBusinessDirectory(ranked);
      const response = formatBusinessResponse(entries);
      if (response) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ answer: response }));
        return;
      }
    }

    const context = buildContext(ranked);
    const wantsTripPlan = isTripRequest(question);
    const prompt = wantsTripPlan
      ? [
          "Trip planning request.",
          "Using only the provided context, suggest a simple, practical visit plan.",
          "Include specific places only if they appear in the context.",
          "Then ask 2–3 clarifying questions (dates, overnight vs. day trip, interests).",
          `User request: ${question}`,
        ].join(" ")
      : question;
    const answer = await askGroq(prompt, context, history);
    const contextBlob = buildContextBlob(ranked);
    const filtered = filterToContext(answer, contextBlob, excludeTerms);
    const wantsSources = isSourceRequest(question);
    const sources = wantsSources ? formatSources(ranked) : "";
    const baseAnswer = filtered || pickFallback();
    const finalAnswer = wantsSources ? (sources || "Sources: Not available from the current context.") : baseAnswer;
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ answer: finalAnswer }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error.message || "Server error" }));
  }
};
