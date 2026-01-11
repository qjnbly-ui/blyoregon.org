// Chunk + store vectors (simple hashed bag-of-words).
const fs = require("fs/promises");
const path = require("path");

const INPUT_PATH = path.join(__dirname, "data", "documents.json");
const OUTPUT_PATH = path.join(__dirname, "data", "embeddings.json");

const VECTOR_SIZE = 256;
const CHUNK_SIZE = 900;
const CHUNK_OVERLAP = 140;

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
  const vector = new Array(VECTOR_SIZE).fill(0);
  const tokens = tokenize(text);
  for (const token of tokens) {
    const idx = hashToken(token) % VECTOR_SIZE;
    vector[idx] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}

function chunkText(text) {
  const paragraphs = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return [];
  const chunks = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n${paragraph}` : paragraph;
    if (next.length <= CHUNK_SIZE) {
      current = next;
      continue;
    }
    if (current) chunks.push(current);
    if (paragraph.length > CHUNK_SIZE) {
      let start = 0;
      while (start < paragraph.length) {
        const end = Math.min(paragraph.length, start + CHUNK_SIZE);
        chunks.push(paragraph.slice(start, end).trim());
        start += CHUNK_SIZE - CHUNK_OVERLAP;
      }
      current = "";
    } else {
      current = paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function embed() {
  const raw = await fs.readFile(INPUT_PATH, "utf8");
  const { documents } = JSON.parse(raw);
  const chunks = [];

  for (const doc of documents) {
    const sections = Array.isArray(doc.sections) && doc.sections.length > 0 ? doc.sections : [{ title: doc.title, text: doc.text }];
    for (const section of sections) {
      const docChunks = chunkText(section.text);
      for (const chunk of docChunks) {
        chunks.push({
          id: `chunk_${chunks.length + 1}`,
          docId: doc.id,
          url: doc.url,
          title: section.title || doc.title,
          text: chunk,
          vector: embedText(chunk),
        });
      }
    }
  }

  await fs.writeFile(OUTPUT_PATH, JSON.stringify({ chunks }, null, 2), "utf8");
  console.log(`Embedded ${chunks.length} chunks -> ${OUTPUT_PATH}`);
}

if (require.main === module) {
  embed().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { embed, embedText };
