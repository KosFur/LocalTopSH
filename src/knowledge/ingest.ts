#!/usr/bin/env tsx
/**
 * Knowledge Base Ingestion CLI
 * Usage: npm run kb:ingest [path-to-documents]
 *
 * Parses Word/PDF documents and indexes them into Qdrant
 */

import path from 'path';
import { CONFIG } from '../config.js';
import { findDocuments, parseAndChunkDocument, getDocumentStats } from './parser.js';
import { createCollection, indexChunks, deleteCollection, getStats } from './qdrant.js';
import { setProxyUrl } from './embeddings.js';

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function main() {
  log('\n📚 Knowledge Base Ingestion Tool\n', 'cyan');

  // Get documents path from args or config
  const docsPath = process.argv[2] || CONFIG.knowledge.documentsPath;
  const absolutePath = path.resolve(docsPath);

  log(`Documents path: ${absolutePath}`, 'dim');
  log(`Qdrant URL: ${CONFIG.knowledge.qdrantUrl}`, 'dim');
  log(`Collection: ${CONFIG.knowledge.collectionName}`, 'dim');
  log(`Chunk size: ${CONFIG.knowledge.chunkSize} chars (overlap: ${CONFIG.knowledge.chunkOverlap})`, 'dim');
  log('');

  // Set proxy URL for embeddings
  if (process.env.PROXY_URL) {
    setProxyUrl(process.env.PROXY_URL);
  }

  // Check for --reset flag
  const shouldReset = process.argv.includes('--reset');
  if (shouldReset) {
    log('⚠️  Resetting collection (--reset flag)...', 'yellow');
    await deleteCollection();
  }

  // Find documents
  log('🔍 Scanning for documents...', 'cyan');
  const documentPaths = findDocuments(absolutePath);

  if (documentPaths.length === 0) {
    log(`\n❌ No documents found in ${absolutePath}`, 'red');
    log('Supported formats: .docx, .doc, .pdf, .txt, .md', 'dim');
    log('\nCreate the folder and add your documents:', 'yellow');
    log(`  mkdir -p ${docsPath}`, 'dim');
    log(`  cp your-documents/* ${docsPath}/`, 'dim');
    process.exit(1);
  }

  log(`Found ${documentPaths.length} documents:\n`, 'green');
  for (const docPath of documentPaths) {
    const relativePath = path.relative(absolutePath, docPath);
    log(`  📄 ${relativePath}`, 'dim');
  }

  // Create collection if needed
  log('\n📦 Preparing Qdrant collection...', 'cyan');
  await createCollection();

  // Parse and chunk all documents
  log('\n📝 Parsing documents...', 'cyan');
  const allChunks = [];

  for (const docPath of documentPaths) {
    const relativePath = path.relative(absolutePath, docPath);
    try {
      log(`  Processing: ${relativePath}`, 'dim');
      const chunks = await parseAndChunkDocument(docPath, absolutePath);
      allChunks.push(...chunks);
      log(`    → ${chunks.length} chunks`, 'green');
    } catch (e: any) {
      log(`    ❌ Error: ${e.message}`, 'red');
    }
  }

  if (allChunks.length === 0) {
    log('\n❌ No chunks created. Check document formats.', 'red');
    process.exit(1);
  }

  // Show stats
  const stats = getDocumentStats(allChunks);
  log('\n📊 Statistics:', 'cyan');
  log(`  Documents: ${stats.totalDocuments}`, 'dim');
  log(`  Chunks: ${stats.totalChunks}`, 'dim');
  if (stats.categories.length > 0) {
    log(`  Categories: ${stats.categories.join(', ')}`, 'dim');
  }

  // Index into Qdrant
  log('\n🔄 Indexing into Qdrant (creating embeddings)...', 'cyan');
  log('   This may take a while for large document sets.', 'dim');

  try {
    await indexChunks(allChunks);
    log('\n✅ Indexing complete!', 'green');
  } catch (e: any) {
    log(`\n❌ Indexing failed: ${e.message}`, 'red');
    if (e.message.includes('401') || e.message.includes('403')) {
      log('   Check your API key for embeddings', 'yellow');
    }
    if (e.message.includes('ECONNREFUSED')) {
      log('   Make sure Qdrant is running: docker compose up qdrant', 'yellow');
    }
    process.exit(1);
  }

  // Final stats
  const qdrantStats = await getStats();
  log('\n📈 Qdrant Collection Status:', 'cyan');
  log(`  Total vectors: ${qdrantStats.totalPoints}`, 'dim');
  log(`  Status: ${qdrantStats.status}`, 'dim');

  log('\n🎉 Knowledge base is ready!', 'green');
  log('   Your agent can now use search_knowledge tool.\n', 'dim');
}

main().catch((e) => {
  log(`\n❌ Fatal error: ${e.message}`, 'red');
  console.error(e);
  process.exit(1);
});
