/**
 * Google Drive Tools
 * 
 * Allows users to connect their Google Drive and access files.
 * Each user's tokens are stored in their isolated workspace.
 */

import { google } from 'googleapis';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// OAuth credentials (loaded from secrets)
let CLIENT_ID = '';
let CLIENT_SECRET = '';
const REDIRECT_URI = 'http://localhost';
const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

// Load credentials from Docker secrets or env
export function initGDriveCredentials(): void {
  try {
    if (existsSync('/run/secrets/gdrive_client_id')) {
      CLIENT_ID = readFileSync('/run/secrets/gdrive_client_id', 'utf-8').trim();
      CLIENT_SECRET = readFileSync('/run/secrets/gdrive_client_secret', 'utf-8').trim();
    } else if (process.env.GDRIVE_CLIENT_ID) {
      CLIENT_ID = process.env.GDRIVE_CLIENT_ID;
      CLIENT_SECRET = process.env.GDRIVE_CLIENT_SECRET || '';
    }
    
    if (CLIENT_ID) {
      console.log('[gdrive] Credentials loaded');
    } else {
      console.log('[gdrive] No credentials found, Google Drive disabled');
    }
  } catch (e) {
    console.log('[gdrive] Failed to load credentials');
  }
}

/**
 * Get token file path for user
 */
function getTokenPath(workspace: string): string {
  return join(workspace, 'gdrive_token.json');
}

/**
 * Check if user has Google Drive connected
 */
export function isGDriveConnected(workspace: string): boolean {
  return existsSync(getTokenPath(workspace));
}

/**
 * Get OAuth2 client for user
 */
function getOAuth2Client(workspace: string): any {
  const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  
  const tokenPath = getTokenPath(workspace);
  if (existsSync(tokenPath)) {
    const tokens = JSON.parse(readFileSync(tokenPath, 'utf-8'));
    oauth2Client.setCredentials(tokens);
  }
  
  return oauth2Client;
}

/**
 * Save tokens to workspace
 */
function saveTokens(workspace: string, tokens: any): void {
  writeFileSync(getTokenPath(workspace), JSON.stringify(tokens, null, 2));
}

// ============== TOOL DEFINITIONS ==============

export const definitions = [
  {
    type: "function" as const,
    function: {
      name: "gdrive_auth",
      description: "Connect Google Drive. Call without 'code' to get auth URL. Call with 'code' to complete authorization.",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "Authorization code from Google (user gets it after clicking auth URL)",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "gdrive_list",
      description: "List files in Google Drive sorted by last modified. Use 'page' for pagination.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query (e.g., 'name contains \"report\"'). Optional.",
          },
          limit: {
            type: "number",
            description: "Files per page (default: 5, max: 20)",
          },
          page: {
            type: "number",
            description: "Page number (default: 1). Use for pagination.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "gdrive_read",
      description: "Read content of a file from Google Drive. For Google Docs/Sheets/Slides - exports as text.",
      parameters: {
        type: "object",
        properties: {
          file_id: {
            type: "string",
            description: "File ID from gdrive_list",
          },
        },
        required: ["file_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "gdrive_search",
      description: "Search files in Google Drive by name or content.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search term (searches in file names)",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "gdrive_disconnect",
      description: "Disconnect Google Drive (remove saved tokens).",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
];

// ============== TOOL IMPLEMENTATIONS ==============

/**
 * gdrive_auth - Start or complete OAuth flow
 */
async function authTool(
  args: { code?: string },
  workspace: string
): Promise<{ success: boolean; output?: string; error?: string }> {
  if (!CLIENT_ID) {
    return { success: false, error: 'Google Drive not configured (missing credentials)' };
  }
  
  const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  
  // If no code - generate auth URL
  if (!args.code) {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
    });
    
    return {
      success: true,
      output: `🔗 Для подключения Google Drive:\n\n1. Перейди по ссылке:\n${authUrl}\n\n2. Авторизуйся и разреши доступ\n\n3. Google перенаправит на localhost — скопируй весь код после "code=" из адресной строки\n\n4. Отправь мне: "вот код: XXXXX"`,
    };
  }
  
  // Exchange code for tokens
  try {
    const { tokens } = await oauth2Client.getToken(args.code);
    saveTokens(workspace, tokens);
    
    return {
      success: true,
      output: '✅ Google Drive подключен!\n\nТеперь можешь:\n- "покажи файлы на диске"\n- "найди файл budget"\n- "прочитай документ [id]"',
    };
  } catch (e: any) {
    return {
      success: false,
      error: `Ошибка авторизации: ${e.message}. Попробуй получить новый код.`,
    };
  }
}

/**
 * gdrive_list - List files
 */
async function listTool(
  args: { query?: string; limit?: number; page?: number },
  workspace: string
): Promise<{ success: boolean; output?: string; error?: string }> {
  if (!isGDriveConnected(workspace)) {
    return { success: false, error: 'Google Drive не подключен. Используй gdrive_auth для подключения.' };
  }
  
  try {
    const auth = getOAuth2Client(workspace);
    const drive = google.drive({ version: 'v3', auth });
    
    const limit = Math.min(args.limit || 5, 20);
    const page = args.page || 1;
    const skip = (page - 1) * limit;
    
    // Request enough files for pagination
    const res = await drive.files.list({
      pageSize: skip + limit,
      q: args.query,
      fields: 'files(id, name, mimeType, modifiedTime)',
      orderBy: 'modifiedTime desc',
    });
    
    const allFiles = res.data.files || [];
    const files = allFiles.slice(skip, skip + limit);
    
    if (files.length === 0) {
      return { success: true, output: page > 1 ? 'Больше файлов нет' : 'Файлы не найдены' };
    }
    
    // Simple format: emoji, name, link
    const output = files.map((f: any) => {
      const type = f.mimeType?.includes('folder') ? '📁' :
                   f.mimeType?.includes('document') ? '📄' :
                   f.mimeType?.includes('spreadsheet') ? '📊' :
                   f.mimeType?.includes('presentation') ? '📽️' : '📎';
      const link = `https://drive.google.com/file/d/${f.id}/view`;
      return `${type} ${f.name}\n${link}`;
    }).join('\n\n');
    
    const hasMore = allFiles.length > skip + limit;
    const footer = hasMore ? `\n\n📄 Стр. ${page} | Ещё: gdrive_list(page=${page + 1})` : `\n\n📄 Стр. ${page}`;
    
    return { success: true, output: output + footer };
  } catch (e: any) {
    if (e.message?.includes('invalid_grant')) {
      return { success: false, error: 'Токен истёк. Переподключи Google Drive через gdrive_auth.' };
    }
    return { success: false, error: `Ошибка: ${e.message}` };
  }
}

/**
 * gdrive_read - Read file content
 */
async function readTool(
  args: { file_id: string },
  workspace: string
): Promise<{ success: boolean; output?: string; error?: string }> {
  if (!isGDriveConnected(workspace)) {
    return { success: false, error: 'Google Drive не подключен.' };
  }
  
  try {
    const auth = getOAuth2Client(workspace);
    const drive = google.drive({ version: 'v3', auth });
    
    // Get file metadata first
    const meta = await drive.files.get({
      fileId: args.file_id,
      fields: 'name, mimeType',
    });
    
    const mimeType = meta.data.mimeType || '';
    const name = meta.data.name || 'file';
    
    let content = '';
    
    // Export Google Workspace files
    if (mimeType.includes('google-apps.document')) {
      const res = await drive.files.export({
        fileId: args.file_id,
        mimeType: 'text/plain',
      });
      content = res.data as string;
    } else if (mimeType.includes('google-apps.spreadsheet')) {
      const res = await drive.files.export({
        fileId: args.file_id,
        mimeType: 'text/csv',
      });
      content = res.data as string;
    } else if (mimeType.includes('google-apps.presentation')) {
      const res = await drive.files.export({
        fileId: args.file_id,
        mimeType: 'text/plain',
      });
      content = res.data as string;
    } else {
      // Regular file - download
      const res = await drive.files.get({
        fileId: args.file_id,
        alt: 'media',
      }, { responseType: 'text' });
      content = res.data as string;
    }
    
    // Truncate if too long
    if (content.length > 10000) {
      content = content.slice(0, 10000) + '\n\n...(truncated)';
    }
    
    return { success: true, output: `📄 ${name}:\n\n${content}` };
  } catch (e: any) {
    return { success: false, error: `Ошибка чтения: ${e.message}` };
  }
}

/**
 * gdrive_search - Search files
 */
async function searchTool(
  args: { query: string },
  workspace: string
): Promise<{ success: boolean; output?: string; error?: string }> {
  if (!isGDriveConnected(workspace)) {
    return { success: false, error: 'Google Drive не подключен.' };
  }
  
  try {
    const auth = getOAuth2Client(workspace);
    const drive = google.drive({ version: 'v3', auth });
    
    const res = await drive.files.list({
      pageSize: 10,
      q: `name contains '${args.query.replace(/'/g, "\\'")}'`,
      fields: 'files(id, name, mimeType)',
    });
    
    const files = res.data.files || [];
    
    if (files.length === 0) {
      return { success: true, output: `Файлы по запросу "${args.query}" не найдены` };
    }
    
    const output = files.map((f: any) => {
      const type = f.mimeType?.includes('folder') ? '📁' :
                   f.mimeType?.includes('document') ? '📄' :
                   f.mimeType?.includes('spreadsheet') ? '📊' : '📎';
      const link = `https://drive.google.com/file/d/${f.id}/view`;
      return `${type} ${f.name}\n${link}`;
    }).join('\n\n');
    
    return { success: true, output: `Найдено по "${args.query}":\n\n${output}` };
  } catch (e: any) {
    return { success: false, error: `Ошибка поиска: ${e.message}` };
  }
}

/**
 * gdrive_disconnect - Remove tokens
 */
async function disconnectTool(
  args: {},
  workspace: string
): Promise<{ success: boolean; output?: string; error?: string }> {
  const tokenPath = getTokenPath(workspace);
  
  if (existsSync(tokenPath)) {
    const { unlinkSync } = await import('fs');
    unlinkSync(tokenPath);
    return { success: true, output: '✅ Google Drive отключен. Токены удалены.' };
  }
  
  return { success: true, output: 'Google Drive не был подключен.' };
}

// ============== EXECUTE ==============

export async function execute(
  name: string,
  args: any,
  workspace: string
): Promise<{ success: boolean; output?: string; error?: string }> {
  switch (name) {
    case 'gdrive_auth':
      return authTool(args, workspace);
    case 'gdrive_list':
      return listTool(args, workspace);
    case 'gdrive_read':
      return readTool(args, workspace);
    case 'gdrive_search':
      return searchTool(args, workspace);
    case 'gdrive_disconnect':
      return disconnectTool(args, workspace);
    default:
      return { success: false, error: `Unknown gdrive tool: ${name}` };
  }
}

/**
 * Check if Google Drive tools are available
 */
export function isGDriveAvailable(): boolean {
  return !!CLIENT_ID;
}

/**
 * Get tool definitions (only if user has connected or credentials available)
 */
export function getGDriveDefinitions(workspace: string): any[] {
  if (!CLIENT_ID) return [];
  
  // Always show gdrive_auth so user can connect
  // Show other tools only if connected
  if (isGDriveConnected(workspace)) {
    return definitions;
  } else {
    return [definitions[0]]; // Only gdrive_auth
  }
}
