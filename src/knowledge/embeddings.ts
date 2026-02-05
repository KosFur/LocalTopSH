/**
 * Embeddings Module
 * Creates vector embeddings using OpenAI-compatible API (via proxy)
 */

import { CONFIG } from '../config.js';

// Proxy URL for embedding requests
let proxyUrl = process.env.PROXY_URL || 'http://localhost:3200';

export function setProxyUrl(url: string) {
  proxyUrl = url;
}

/**
 * Create embeddings for a single text
 */
export async function createEmbedding(text: string): Promise<number[]> {
  const response = await fetch(`${proxyUrl}/v1/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: CONFIG.knowledge.embeddingModel,
      input: text,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Embedding API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

/**
 * Create embeddings for multiple texts (batched)
 */
export async function createEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  // Process in batches of 100 (OpenAI limit)
  const batchSize = 100;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    const response = await fetch(`${proxyUrl}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CONFIG.knowledge.embeddingModel,
        input: batch,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Embedding API error: ${response.status} - ${error}`);
    }

    const data = await response.json();

    // Sort by index to maintain order
    const sortedData = data.data.sort((a: any, b: any) => a.index - b.index);
    allEmbeddings.push(...sortedData.map((d: any) => d.embedding));

    // Progress logging for large batches
    if (texts.length > batchSize) {
      console.log(`[embeddings] Processed ${Math.min(i + batchSize, texts.length)}/${texts.length} texts`);
    }
  }

  return allEmbeddings;
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
