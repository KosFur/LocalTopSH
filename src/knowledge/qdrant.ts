/**
 * Qdrant Client for Knowledge Base
 * Handles vector storage and semantic search
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { CONFIG } from '../config.js';
import { DocumentChunk } from './parser.js';
import { createEmbedding, createEmbeddings } from './embeddings.js';
import { v4 as uuidv4 } from 'uuid';

// Qdrant client singleton
let client: QdrantClient | null = null;

/**
 * Get or create Qdrant client
 */
export function getClient(): QdrantClient {
  if (!client) {
    client = new QdrantClient({
      url: CONFIG.knowledge.qdrantUrl,
    });
  }
  return client;
}

/**
 * Check if collection exists
 */
export async function collectionExists(): Promise<boolean> {
  try {
    const qdrant = getClient();
    const collections = await qdrant.getCollections();
    return collections.collections.some(
      (c) => c.name === CONFIG.knowledge.collectionName
    );
  } catch (e) {
    return false;
  }
}

/**
 * Create the knowledge base collection
 */
export async function createCollection(): Promise<void> {
  const qdrant = getClient();

  // Check if exists
  if (await collectionExists()) {
    console.log(`[qdrant] Collection '${CONFIG.knowledge.collectionName}' already exists`);
    return;
  }

  await qdrant.createCollection(CONFIG.knowledge.collectionName, {
    vectors: {
      size: CONFIG.knowledge.embeddingDimension,
      distance: 'Cosine',
    },
    optimizers_config: {
      default_segment_number: 2,
    },
    replication_factor: 1,
  });

  // Create payload indexes for filtering
  await qdrant.createPayloadIndex(CONFIG.knowledge.collectionName, {
    field_name: 'documentId',
    field_schema: 'keyword',
  });

  await qdrant.createPayloadIndex(CONFIG.knowledge.collectionName, {
    field_name: 'category',
    field_schema: 'keyword',
  });

  console.log(`[qdrant] Created collection '${CONFIG.knowledge.collectionName}'`);
}

/**
 * Delete the knowledge base collection
 */
export async function deleteCollection(): Promise<void> {
  const qdrant = getClient();

  if (await collectionExists()) {
    await qdrant.deleteCollection(CONFIG.knowledge.collectionName);
    console.log(`[qdrant] Deleted collection '${CONFIG.knowledge.collectionName}'`);
  }
}

/**
 * Index document chunks into Qdrant
 */
export async function indexChunks(chunks: DocumentChunk[]): Promise<void> {
  if (chunks.length === 0) return;

  const qdrant = getClient();

  // Create embeddings for all chunks
  console.log(`[qdrant] Creating embeddings for ${chunks.length} chunks...`);
  const texts = chunks.map((c) => c.content);
  const embeddings = await createEmbeddings(texts);

  // Prepare points for Qdrant
  const points = chunks.map((chunk, i) => ({
    id: uuidv4(),
    vector: embeddings[i],
    payload: {
      chunkId: chunk.id,
      content: chunk.content,
      documentId: chunk.metadata.documentId,
      documentName: chunk.metadata.documentName,
      documentPath: chunk.metadata.documentPath,
      chunkIndex: chunk.metadata.chunkIndex,
      totalChunks: chunk.metadata.totalChunks,
      category: chunk.metadata.category || null,
      title: chunk.metadata.title || null,
    },
  }));

  // Upsert in batches of 100
  const batchSize = 100;
  for (let i = 0; i < points.length; i += batchSize) {
    const batch = points.slice(i, i + batchSize);
    await qdrant.upsert(CONFIG.knowledge.collectionName, {
      points: batch,
    });
    console.log(`[qdrant] Indexed ${Math.min(i + batchSize, points.length)}/${points.length} chunks`);
  }
}

/**
 * Delete all chunks for a specific document
 */
export async function deleteDocumentChunks(documentId: string): Promise<void> {
  const qdrant = getClient();

  await qdrant.delete(CONFIG.knowledge.collectionName, {
    filter: {
      must: [
        {
          key: 'documentId',
          match: { value: documentId },
        },
      ],
    },
  });

  console.log(`[qdrant] Deleted chunks for document '${documentId}'`);
}

/**
 * Search result type
 */
export interface SearchResult {
  content: string;
  score: number;
  documentId: string;
  documentName: string;
  documentPath: string;
  chunkIndex: number;
  totalChunks: number;
  category?: string;
  title?: string;
}

/**
 * Search the knowledge base
 */
export async function search(
  query: string,
  options: {
    topK?: number;
    scoreThreshold?: number;
    category?: string;
  } = {}
): Promise<SearchResult[]> {
  const qdrant = getClient();

  const topK = options.topK ?? CONFIG.knowledge.topK;
  const scoreThreshold = options.scoreThreshold ?? CONFIG.knowledge.scoreThreshold;

  // Create embedding for query
  const queryEmbedding = await createEmbedding(query);

  // Build filter
  const filter: any = {};
  if (options.category) {
    filter.must = [
      {
        key: 'category',
        match: { value: options.category },
      },
    ];
  }

  // Search
  const results = await qdrant.search(CONFIG.knowledge.collectionName, {
    vector: queryEmbedding,
    limit: topK,
    score_threshold: scoreThreshold,
    filter: Object.keys(filter).length > 0 ? filter : undefined,
    with_payload: true,
  });

  return results.map((r) => ({
    content: r.payload?.content as string,
    score: r.score,
    documentId: r.payload?.documentId as string,
    documentName: r.payload?.documentName as string,
    documentPath: r.payload?.documentPath as string,
    chunkIndex: r.payload?.chunkIndex as number,
    totalChunks: r.payload?.totalChunks as number,
    category: r.payload?.category as string | undefined,
    title: r.payload?.title as string | undefined,
  }));
}

/**
 * Get all chunks for a specific document
 */
export async function getDocumentChunks(documentId: string): Promise<SearchResult[]> {
  const qdrant = getClient();

  const results = await qdrant.scroll(CONFIG.knowledge.collectionName, {
    filter: {
      must: [
        {
          key: 'documentId',
          match: { value: documentId },
        },
      ],
    },
    with_payload: true,
    limit: 1000,
  });

  const chunks = results.points.map((r) => ({
    content: r.payload?.content as string,
    score: 1.0,
    documentId: r.payload?.documentId as string,
    documentName: r.payload?.documentName as string,
    documentPath: r.payload?.documentPath as string,
    chunkIndex: r.payload?.chunkIndex as number,
    totalChunks: r.payload?.totalChunks as number,
    category: r.payload?.category as string | undefined,
    title: r.payload?.title as string | undefined,
  }));

  // Sort by chunk index
  return chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
}

/**
 * Get collection statistics
 */
export async function getStats(): Promise<{
  totalPoints: number;
  status: string;
}> {
  const qdrant = getClient();

  if (!(await collectionExists())) {
    return { totalPoints: 0, status: 'not_created' };
  }

  const info = await qdrant.getCollection(CONFIG.knowledge.collectionName);
  return {
    totalPoints: info.points_count || 0,
    status: info.status,
  };
}

/**
 * List all unique documents in the collection
 */
export async function listDocuments(): Promise<
  { documentId: string; documentName: string; category?: string; title?: string }[]
> {
  const qdrant = getClient();

  if (!(await collectionExists())) {
    return [];
  }

  // Scroll through all points to get unique documents
  const seen = new Map<string, { documentId: string; documentName: string; category?: string; title?: string }>();
  let offset: string | null = null;

  while (true) {
    const results = await qdrant.scroll(CONFIG.knowledge.collectionName, {
      with_payload: ['documentId', 'documentName', 'category', 'title'],
      limit: 100,
      offset: offset || undefined,
    });

    for (const point of results.points) {
      const docId = point.payload?.documentId as string;
      if (!seen.has(docId)) {
        seen.set(docId, {
          documentId: docId,
          documentName: point.payload?.documentName as string,
          category: point.payload?.category as string | undefined,
          title: point.payload?.title as string | undefined,
        });
      }
    }

    if (!results.next_page_offset) break;
    offset = results.next_page_offset as string;
  }

  return Array.from(seen.values());
}

/**
 * List all categories
 */
export async function listCategories(): Promise<string[]> {
  const docs = await listDocuments();
  const categories = new Set<string>();

  for (const doc of docs) {
    if (doc.category) {
      categories.add(doc.category);
    }
  }

  return Array.from(categories).sort();
}
