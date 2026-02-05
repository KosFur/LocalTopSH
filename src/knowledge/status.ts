#!/usr/bin/env tsx
/**
 * Knowledge Base Status CLI
 * Usage: npm run kb:status
 *
 * Shows current state of the knowledge base
 */

import { CONFIG } from '../config.js';
import { getStats, listDocuments, listCategories, collectionExists } from './qdrant.js';

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
  log('\n📚 Knowledge Base Status\n', 'cyan');

  log(`Qdrant URL: ${CONFIG.knowledge.qdrantUrl}`, 'dim');
  log(`Collection: ${CONFIG.knowledge.collectionName}`, 'dim');
  log('');

  // Check if collection exists
  const exists = await collectionExists();
  if (!exists) {
    log('❌ Collection does not exist', 'red');
    log('\nRun the following to create and populate:', 'yellow');
    log('  npm run kb:ingest ./knowledge_docs', 'dim');
    process.exit(0);
  }

  // Get stats
  const stats = await getStats();
  log('📊 Collection Statistics:', 'cyan');
  log(`  Status: ${stats.status}`, stats.status === 'green' ? 'green' : 'yellow');
  log(`  Total vectors: ${stats.totalPoints}`, 'dim');

  // List documents
  log('\n📄 Indexed Documents:', 'cyan');
  const documents = await listDocuments();

  if (documents.length === 0) {
    log('  No documents indexed', 'yellow');
  } else {
    // Group by category
    const byCategory = new Map<string, typeof documents>();
    for (const doc of documents) {
      const cat = doc.category || '(no category)';
      if (!byCategory.has(cat)) {
        byCategory.set(cat, []);
      }
      byCategory.get(cat)!.push(doc);
    }

    for (const [category, docs] of byCategory) {
      log(`\n  📁 ${category}:`, 'yellow');
      for (const doc of docs) {
        const title = doc.title ? ` - "${doc.title}"` : '';
        log(`     📄 ${doc.documentName}${title}`, 'dim');
      }
    }
  }

  // List categories
  const categories = await listCategories();
  if (categories.length > 0) {
    log('\n🏷️  Categories:', 'cyan');
    log(`  ${categories.join(', ')}`, 'dim');
  }

  log('\n✅ Knowledge base is ready!\n', 'green');
}

main().catch((e) => {
  log(`\n❌ Error: ${e.message}`, 'red');
  if (e.message.includes('ECONNREFUSED')) {
    log('   Make sure Qdrant is running: docker compose up qdrant', 'yellow');
  }
  process.exit(1);
});
