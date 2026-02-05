/**
 * Knowledge Base Tools
 * Tools for searching and retrieving information from the knowledge base
 */

import { ToolResult } from './index.js';
import * as qdrant from '../knowledge/qdrant.js';
import { setProxyUrl } from '../knowledge/embeddings.js';

// Initialize proxy URL from environment
if (process.env.PROXY_URL) {
  setProxyUrl(process.env.PROXY_URL);
}

/**
 * search_knowledge - Semantic search in the knowledge base
 */
export const searchKnowledgeDefinition = {
  type: 'function' as const,
  function: {
    name: 'search_knowledge',
    description: `Поиск по базе знаний компании (инструкции, регламенты, FAQ).
Используй для ответов на вопросы по процессам и процедурам.
Возвращает релевантные фрагменты документов с указанием источника.`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Поисковый запрос на естественном языке. Пример: "как оформить возврат товара"',
        },
        category: {
          type: 'string',
          description: 'Фильтр по категории (название папки). Опционально.',
        },
        limit: {
          type: 'number',
          description: 'Количество результатов (по умолчанию 5)',
        },
      },
      required: ['query'],
    },
  },
};

export async function executeSearchKnowledge(args: {
  query: string;
  category?: string;
  limit?: number;
}): Promise<ToolResult> {
  try {
    // Check if collection exists
    const exists = await qdrant.collectionExists();
    if (!exists) {
      return {
        success: false,
        error: 'База знаний не настроена. Запустите: npm run kb:ingest ./knowledge_docs',
      };
    }

    const results = await qdrant.search(args.query, {
      topK: args.limit || 5,
      category: args.category,
    });

    if (results.length === 0) {
      return {
        success: true,
        output: 'По запросу ничего не найдено. Попробуй переформулировать вопрос.',
      };
    }

    // Format results
    const formatted = results.map((r, i) => {
      const source = r.category
        ? `[${r.category}] ${r.documentName}`
        : r.documentName;
      const title = r.title ? `\n   Заголовок: ${r.title}` : '';
      const score = Math.round(r.score * 100);

      return `${i + 1}. **${source}** (релевантность: ${score}%)${title}
   Фрагмент ${r.chunkIndex + 1}/${r.totalChunks}:
   ${r.content.slice(0, 500)}${r.content.length > 500 ? '...' : ''}`;
    });

    return {
      success: true,
      output: `Найдено ${results.length} релевантных фрагментов:\n\n${formatted.join('\n\n---\n\n')}`,
    };
  } catch (e: any) {
    return {
      success: false,
      error: `Ошибка поиска: ${e.message}`,
    };
  }
}

/**
 * get_instruction - Get full document content
 */
export const getInstructionDefinition = {
  type: 'function' as const,
  function: {
    name: 'get_instruction',
    description: `Получить полный текст документа/инструкции по его ID.
Используй после search_knowledge, чтобы прочитать документ целиком.`,
    parameters: {
      type: 'object',
      properties: {
        document_id: {
          type: 'string',
          description: 'ID документа из результатов search_knowledge',
        },
      },
      required: ['document_id'],
    },
  },
};

export async function executeGetInstruction(args: {
  document_id: string;
}): Promise<ToolResult> {
  try {
    const chunks = await qdrant.getDocumentChunks(args.document_id);

    if (chunks.length === 0) {
      return {
        success: false,
        error: `Документ с ID "${args.document_id}" не найден`,
      };
    }

    // Combine all chunks
    const fullContent = chunks.map((c) => c.content).join('\n\n');
    const meta = chunks[0];

    const header = [
      `📄 **${meta.documentName}**`,
      meta.title ? `Заголовок: ${meta.title}` : '',
      meta.category ? `Категория: ${meta.category}` : '',
      `Частей: ${meta.totalChunks}`,
    ]
      .filter(Boolean)
      .join('\n');

    return {
      success: true,
      output: `${header}\n\n---\n\n${fullContent}`,
    };
  } catch (e: any) {
    return {
      success: false,
      error: `Ошибка получения документа: ${e.message}`,
    };
  }
}

/**
 * list_instructions - List all documents in knowledge base
 */
export const listInstructionsDefinition = {
  type: 'function' as const,
  function: {
    name: 'list_instructions',
    description: `Список всех документов в базе знаний.
Показывает доступные инструкции, сгруппированные по категориям.`,
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Фильтр по категории (опционально)',
        },
      },
    },
  },
};

export async function executeListInstructions(args: {
  category?: string;
}): Promise<ToolResult> {
  try {
    const exists = await qdrant.collectionExists();
    if (!exists) {
      return {
        success: false,
        error: 'База знаний не настроена. Запустите: npm run kb:ingest ./knowledge_docs',
      };
    }

    let documents = await qdrant.listDocuments();

    // Filter by category if specified
    if (args.category) {
      documents = documents.filter(
        (d) => d.category?.toLowerCase() === args.category?.toLowerCase()
      );
    }

    if (documents.length === 0) {
      return {
        success: true,
        output: args.category
          ? `В категории "${args.category}" документов не найдено`
          : 'База знаний пуста',
      };
    }

    // Group by category
    const byCategory = new Map<string, typeof documents>();
    for (const doc of documents) {
      const cat = doc.category || 'Без категории';
      if (!byCategory.has(cat)) {
        byCategory.set(cat, []);
      }
      byCategory.get(cat)!.push(doc);
    }

    // Format output
    const lines: string[] = [`📚 Документы в базе знаний (${documents.length}):\n`];

    for (const [category, docs] of byCategory) {
      lines.push(`\n📁 **${category}** (${docs.length}):`);
      for (const doc of docs) {
        const title = doc.title ? ` — "${doc.title}"` : '';
        lines.push(`   • ${doc.documentName}${title}`);
        lines.push(`     ID: \`${doc.documentId}\``);
      }
    }

    // Add categories list
    const categories = await qdrant.listCategories();
    if (categories.length > 0) {
      lines.push(`\n🏷️ Категории: ${categories.join(', ')}`);
    }

    return {
      success: true,
      output: lines.join('\n'),
    };
  } catch (e: any) {
    return {
      success: false,
      error: `Ошибка получения списка: ${e.message}`,
    };
  }
}

/**
 * draft_response - Help draft a response to a customer
 */
export const draftResponseDefinition = {
  type: 'function' as const,
  function: {
    name: 'draft_response',
    description: `Помочь сформулировать ответ клиенту на основе найденной информации.
Используй после search_knowledge, чтобы составить грамотный ответ.`,
    parameters: {
      type: 'object',
      properties: {
        customer_question: {
          type: 'string',
          description: 'Вопрос или проблема клиента',
        },
        context: {
          type: 'string',
          description: 'Контекст из базы знаний (результаты search_knowledge)',
        },
        tone: {
          type: 'string',
          enum: ['formal', 'friendly', 'neutral'],
          description: 'Тон ответа: formal (официальный), friendly (дружелюбный), neutral (нейтральный)',
        },
      },
      required: ['customer_question', 'context'],
    },
  },
};

export async function executeDraftResponse(args: {
  customer_question: string;
  context: string;
  tone?: string;
}): Promise<ToolResult> {
  // This is a helper tool - the actual response drafting will be done by the LLM
  // We just format the request properly

  const toneDescriptions: Record<string, string> = {
    formal: 'официальный, вежливый, с использованием "Вы"',
    friendly: 'дружелюбный, тёплый, с эмпатией',
    neutral: 'нейтральный, информативный',
  };

  const tone = args.tone || 'neutral';
  const toneDesc = toneDescriptions[tone] || toneDescriptions.neutral;

  return {
    success: true,
    output: `📝 Запрос на составление ответа клиенту:

**Вопрос клиента:**
${args.customer_question}

**Информация из базы знаний:**
${args.context}

**Требуемый тон:** ${toneDesc}

---
Сформулируй ответ клиенту, используя информацию выше. Ответ должен быть:
- Точным и основанным на документации
- В указанном тоне
- С ссылкой на источник (если уместно)
- Понятным для клиента`,
  };
}

// Export all definitions
export const definitions = [
  searchKnowledgeDefinition,
  getInstructionDefinition,
  listInstructionsDefinition,
  draftResponseDefinition,
];
