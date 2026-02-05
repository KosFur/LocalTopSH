/**
 * Entry point - starts bot or gateway based on mode
 * Reads secrets from Docker Secrets (/run/secrets/) or env fallback
 */

import { config as loadEnv } from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { createBot } from './bot/index.js';
import { createGateway } from './gateway/server.js';

// Load .env (fallback for local dev)
loadEnv();

/**
 * Read secret from Docker Secrets or env fallback
 */
function readSecret(name: string, envKey: string): string | undefined {
  // Try Docker Secrets first (both with and without extension)
  const secretPaths = [
    `/run/secrets/${name}`,
    `/run/secrets/${name}.txt`,
  ];
  
  for (const secretPath of secretPaths) {
    if (existsSync(secretPath)) {
      try {
        const value = readFileSync(secretPath, 'utf-8').trim();
        if (value) {
          console.log(`[config] Secret '${name}' loaded from Docker Secrets`);
          return value;
        }
      } catch (e) {
        // Try next path
      }
    }
  }
  
  // Fallback to env var
  if (process.env[envKey]) {
    console.log(`[config] ${envKey} loaded from env`);
    return process.env[envKey];
  }
  
  return undefined;
}

// Read secrets
const telegramToken = readSecret('telegram_token', 'TELEGRAM_TOKEN');

// Proxy URL (gateway uses this instead of direct API keys)
const proxyUrl = process.env.PROXY_URL;

// For backwards compatibility, also check direct env vars
const baseUrl = proxyUrl ? `${proxyUrl}/v1` : process.env.BASE_URL;
const apiKey = proxyUrl ? 'proxy' : process.env.API_KEY; // Proxy handles auth

// Validate required config
if (!telegramToken) {
  console.error('Missing: TELEGRAM_TOKEN (set via Docker Secret or env)');
  process.exit(1);
}

if (!baseUrl) {
  console.error('Missing: PROXY_URL or BASE_URL');
  process.exit(1);
}

// Parse exposed ports from env
const exposedPorts = process.env.EXPOSED_PORTS
  ? process.env.EXPOSED_PORTS.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
  : [];

const config = {
  baseUrl,
  apiKey: apiKey || 'none',
  model: process.env.MODEL_NAME || 'openai/gpt-oss-120b',
  telegramToken,
  proxyUrl, // New: proxy URL for ZAI requests
  zaiApiKey: process.env.ZAI_API_KEY, // Fallback for local dev
  tavilyApiKey: process.env.TAVILY_API_KEY,
  cwd: process.env.AGENT_CWD || process.cwd(),
  gatewayPort: parseInt(process.env.GATEWAY_PORT || '3100'),
  exposedPorts,
  maxConcurrentUsers: parseInt(process.env.MAX_CONCURRENT_USERS || '10'),
};

const mode = process.argv[2] || 'bot';

if (mode === 'gateway') {
  const gateway = createGateway({
    port: config.gatewayPort,
    cwd: config.cwd,
    zaiApiKey: config.zaiApiKey,
    tavilyApiKey: config.tavilyApiKey,
  });
  gateway.start();
} else {
  console.log('Starting Agent...');
  console.log(`Base workspace: ${config.cwd}`);
  console.log(`Model: ${config.model}`);
  console.log(`API: ${proxyUrl ? 'via Proxy' : 'direct'}`);
  console.log(`Search: ${proxyUrl ? 'via Proxy' : config.zaiApiKey ? 'Z.AI' : 'none'}`);
  console.log(`Ports: ${exposedPorts.length ? exposedPorts.join(', ') : 'none'}`);
  console.log(`Max concurrent users: ${config.maxConcurrentUsers}`);
  console.log('Access: Open to all users (per-user workspaces)');
  
  const bot = createBot(config);
  
  // Register commands in Telegram menu
  bot.telegram.setMyCommands([
    { command: 'help', description: '📚 Все команды' },
    { command: 'kb', description: '📖 Поиск по базе знаний' },
    { command: 'ticket', description: '🎫 Работа с тикетами' },
    { command: 'tickets', description: '📋 Список тикетов' },
    { command: 'customer', description: '👤 Поиск клиентов' },
    { command: 'stats', description: '📊 Статистика CRM' },
    { command: 'clear', description: '🗑 Очистить сессию' },
    { command: 'status', description: '⚙️ Статус бота' },
    { command: 'pending', description: '⏳ Ожидающие команды' },
  ]);
  
  bot.launch();
  
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
