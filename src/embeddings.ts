import { GoogleGenAI } from '@google/genai';

import { GOOGLE_API_KEY } from './config.js';
import { logger } from './logger.js';

const EMBEDDING_MODEL = 'gemini-embedding-001';

// 768 dims instead of the model's 3072 default: ~4x smaller storage and
// ~4x faster similarity scans, with negligible retrieval quality loss (MRL).
const EMBEDDING_DIMS = 768;

// Tag stored alongside each vector so vectors from different models/dims
// are never compared against each other.
export const EMBEDDING_MODEL_TAG = `${EMBEDDING_MODEL}@${EMBEDDING_DIMS}`;

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (client) return client;
  if (!GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API_KEY is not set.');
  }
  client = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });
  return client;
}

/**
 * Generate an embedding vector for a text string.
 * Returns a float array (EMBEDDING_DIMS dimensions), L2-normalized.
 * Note: truncated MRL embeddings are not normalized by the API, so we
 * renormalize here to keep cosine similarity well-behaved.
 */
export async function embedText(text: string): Promise<number[]> {
  const ai = getClient();
  const result = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
    config: { outputDimensionality: EMBEDDING_DIMS },
  });
  const values = result.embeddings?.[0]?.values ?? [];
  return normalize(values);
}

/** L2-normalize a vector in place-safe fashion. Returns [] for empty/zero vectors. */
function normalize(v: number[]): number[] {
  if (v.length === 0) return v;
  let mag = 0;
  for (const x of v) mag += x * x;
  mag = Math.sqrt(mag);
  if (mag === 0) return v;
  return v.map((x) => x / mag);
}

/**
 * Cosine similarity between two vectors. Returns -1 to 1.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  return dot / denom;
}
