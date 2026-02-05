/**
 * Document Parser for Knowledge Base
 * Parses Word (.docx) and PDF files into text chunks
 */

import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import { CONFIG } from '../config.js';

export interface DocumentChunk {
  id: string;
  content: string;
  metadata: {
    documentId: string;
    documentName: string;
    documentPath: string;
    chunkIndex: number;
    totalChunks: number;
    category?: string;
    title?: string;
  };
}

export interface ParsedDocument {
  id: string;
  name: string;
  path: string;
  content: string;
  category?: string;
  title?: string;
}

/**
 * Parse a Word document (.docx) to text
 */
export async function parseWordDocument(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

/**
 * Parse a PDF document to text
 */
export async function parsePdfDocument(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  const result = await pdfParse(buffer);
  return result.text;
}

/**
 * Parse any supported document
 */
export async function parseDocument(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.docx':
    case '.doc':
      return parseWordDocument(filePath);
    case '.pdf':
      return parsePdfDocument(filePath);
    case '.txt':
    case '.md':
      return fs.readFileSync(filePath, 'utf-8');
    default:
      throw new Error(`Unsupported file format: ${ext}`);
  }
}

/**
 * Extract title from document content (first non-empty line or heading)
 */
function extractTitle(content: string, fileName: string): string {
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length > 0) {
    // Take first line, limit to 100 chars
    const firstLine = lines[0].trim();
    if (firstLine.length <= 100) {
      return firstLine;
    }
    return firstLine.slice(0, 97) + '...';
  }
  return fileName;
}

/**
 * Split text into overlapping chunks
 */
export function splitIntoChunks(
  text: string,
  chunkSize: number = CONFIG.knowledge.chunkSize,
  overlap: number = CONFIG.knowledge.chunkOverlap
): string[] {
  const chunks: string[] = [];

  // Clean up text
  const cleanText = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (cleanText.length <= chunkSize) {
    return [cleanText];
  }

  let start = 0;
  while (start < cleanText.length) {
    let end = start + chunkSize;

    // Try to end at a sentence or paragraph boundary
    if (end < cleanText.length) {
      // Look for paragraph break
      const paragraphEnd = cleanText.lastIndexOf('\n\n', end);
      if (paragraphEnd > start + chunkSize / 2) {
        end = paragraphEnd;
      } else {
        // Look for sentence end
        const sentenceEnd = cleanText.lastIndexOf('. ', end);
        if (sentenceEnd > start + chunkSize / 2) {
          end = sentenceEnd + 1;
        }
      }
    }

    const chunk = cleanText.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }

    // Move start with overlap
    start = end - overlap;
    if (start >= cleanText.length - overlap) {
      break;
    }
  }

  return chunks;
}

/**
 * Generate a unique document ID from file path
 */
function generateDocumentId(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const hash = Buffer.from(normalized).toString('base64url').slice(0, 12);
  const name = path.basename(filePath, path.extname(filePath))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .slice(0, 30);
  return `${name}-${hash}`;
}

/**
 * Extract category from file path (parent folder name)
 */
function extractCategory(filePath: string, basePath: string): string | undefined {
  const relativePath = path.relative(basePath, filePath);
  const parts = relativePath.split(path.sep);
  if (parts.length > 1) {
    return parts[0];
  }
  return undefined;
}

/**
 * Parse a document and split into chunks with metadata
 */
export async function parseAndChunkDocument(
  filePath: string,
  basePath: string
): Promise<DocumentChunk[]> {
  const content = await parseDocument(filePath);
  const documentId = generateDocumentId(filePath);
  const documentName = path.basename(filePath);
  const category = extractCategory(filePath, basePath);
  const title = extractTitle(content, documentName);

  const textChunks = splitIntoChunks(content);

  return textChunks.map((chunk, index) => ({
    id: `${documentId}-chunk-${index}`,
    content: chunk,
    metadata: {
      documentId,
      documentName,
      documentPath: filePath,
      chunkIndex: index,
      totalChunks: textChunks.length,
      category,
      title,
    },
  }));
}

/**
 * Find all supported documents in a directory
 */
export function findDocuments(dirPath: string): string[] {
  const supportedExtensions = ['.docx', '.doc', '.pdf', '.txt', '.md'];
  const documents: string[] = [];

  function scanDir(currentPath: string) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        // Skip hidden directories
        if (!entry.name.startsWith('.')) {
          scanDir(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (supportedExtensions.includes(ext)) {
          documents.push(fullPath);
        }
      }
    }
  }

  if (fs.existsSync(dirPath)) {
    scanDir(dirPath);
  }

  return documents;
}

/**
 * Get document statistics
 */
export function getDocumentStats(chunks: DocumentChunk[]): {
  totalDocuments: number;
  totalChunks: number;
  categories: string[];
  documents: { name: string; chunks: number; category?: string }[];
} {
  const docMap = new Map<string, { name: string; chunks: number; category?: string }>();
  const categories = new Set<string>();

  for (const chunk of chunks) {
    const existing = docMap.get(chunk.metadata.documentId);
    if (existing) {
      existing.chunks++;
    } else {
      docMap.set(chunk.metadata.documentId, {
        name: chunk.metadata.documentName,
        chunks: 1,
        category: chunk.metadata.category,
      });
    }
    if (chunk.metadata.category) {
      categories.add(chunk.metadata.category);
    }
  }

  return {
    totalDocuments: docMap.size,
    totalChunks: chunks.length,
    categories: Array.from(categories).sort(),
    documents: Array.from(docMap.values()),
  };
}
