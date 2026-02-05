/**
 * API Proxy - isolates secrets from agent container
 * Reads secrets from /run/secrets/ (Docker Secrets)
 * Agent sees only http://proxy:3200, no API keys
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const { URL } = require('url');

const PORT = process.env.PROXY_PORT || 3200;

/**
 * Read secret from file (Docker Secrets mount at /run/secrets/)
 */
function readSecret(name) {
  const paths = [
    `/run/secrets/${name}`,
    `/run/secrets/${name}.txt`,
    `./secrets/${name}.txt`,
    `/app/secrets/${name}.txt`,
  ];
  
  for (const path of paths) {
    try {
      const value = fs.readFileSync(path, 'utf-8').trim();
      if (value) {
        console.log(`[proxy] Secret '${name}' loaded from ${path}`);
        return value;
      }
    } catch {
      // Try next path
    }
  }
  
  const envName = name.toUpperCase();
  if (process.env[envName]) {
    console.log(`[proxy] Secret '${name}' loaded from env (INSECURE)`);
    return process.env[envName];
  }
  
  console.warn(`[proxy] WARNING: Secret '${name}' not found!`);
  return null;
}

// Load secrets
const LLM_BASE_URL = readSecret('base_url');
const LLM_API_KEY = readSecret('api_key');
const ZAI_API_KEY = readSecret('zai_api_key');
const ANTHROPIC_API_KEY = readSecret('anthropic_api_key');
const GEMINI_API_KEY = readSecret('gemini_api_key');

// Detect provider from BASE_URL
function detectProvider(url) {
  if (!url) return 'unknown';
  if (url.includes('anthropic.com')) return 'anthropic';
  if (url.includes('generativelanguage.googleapis.com')) return 'gemini';
  if (url.includes('openrouter.ai')) return 'openrouter';
  return 'openai'; // OpenAI-compatible
}

const LLM_PROVIDER = detectProvider(LLM_BASE_URL);

console.log('[proxy] Starting API proxy...');
console.log('[proxy] LLM endpoint:', LLM_BASE_URL ? '✓ configured' : '✗ NOT SET');
console.log('[proxy] LLM provider:', LLM_PROVIDER);
console.log('[proxy] ZAI API:', ZAI_API_KEY ? '✓ configured' : '✗ NOT SET');
console.log('[proxy] Anthropic:', ANTHROPIC_API_KEY ? '✓ configured' : '(use BASE_URL)');
console.log('[proxy] Gemini:', GEMINI_API_KEY ? '✓ configured' : '(use BASE_URL)');

/**
 * Convert OpenAI format to Anthropic format
 */
function convertToAnthropic(openaiBody) {
  const messages = openaiBody.messages || [];
  const systemMessages = messages.filter(m => m.role === 'system');
  const otherMessages = messages.filter(m => m.role !== 'system');

  return {
    model: openaiBody.model || 'claude-3-5-sonnet-20241022',
    max_tokens: openaiBody.max_tokens || 4096,
    system: systemMessages.map(m => m.content).join('\n\n') || undefined,
    messages: otherMessages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
    tools: openaiBody.tools?.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    })),
  };
}

/**
 * Convert Anthropic response to OpenAI format
 */
function convertFromAnthropic(anthropicRes) {
  const content = anthropicRes.content || [];
  const textContent = content.filter(c => c.type === 'text').map(c => c.text).join('');
  const toolUses = content.filter(c => c.type === 'tool_use');

  const message = {
    role: 'assistant',
    content: textContent || null,
  };

  if (toolUses.length > 0) {
    message.tool_calls = toolUses.map(tu => ({
      id: tu.id,
      type: 'function',
      function: {
        name: tu.name,
        arguments: JSON.stringify(tu.input),
      },
    }));
  }

  return {
    id: anthropicRes.id,
    object: 'chat.completion',
    created: Date.now(),
    model: anthropicRes.model,
    choices: [{
      index: 0,
      message,
      finish_reason: anthropicRes.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
    }],
    usage: {
      prompt_tokens: anthropicRes.usage?.input_tokens || 0,
      completion_tokens: anthropicRes.usage?.output_tokens || 0,
      total_tokens: (anthropicRes.usage?.input_tokens || 0) + (anthropicRes.usage?.output_tokens || 0),
    },
  };
}

/**
 * Handle Anthropic API request
 */
function handleAnthropicRequest(req, res, body) {
  const anthropicBody = convertToAnthropic(body);
  const postData = JSON.stringify(anthropicBody);

  const apiKey = ANTHROPIC_API_KEY || LLM_API_KEY;

  const options = {
    hostname: 'api.anthropic.com',
    port: 443,
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
  };

  const proxyReq = https.request(options, (proxyRes) => {
    let data = '';
    proxyRes.on('data', chunk => data += chunk);
    proxyRes.on('end', () => {
      try {
        const anthropicRes = JSON.parse(data);
        if (proxyRes.statusCode !== 200) {
          res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(data);
          return;
        }
        const openaiRes = convertFromAnthropic(anthropicRes);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(openaiRes));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Parse error', message: e.message }));
      }
    });
  });

  proxyReq.on('error', (e) => {
    console.error('[proxy] Anthropic error:', e.message);
    res.writeHead(502);
    res.end(JSON.stringify({ error: 'Anthropic request failed', message: e.message }));
  });

  proxyReq.write(postData);
  proxyReq.end();
}

/**
 * Forward request to target with auth (for streaming/LLM)
 */
function proxyRequest(req, res, targetUrl, authHeader) {
  const url = new URL(targetUrl);
  const isHttps = url.protocol === 'https:';
  const client = isHttps ? https : http;
  
  const options = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    method: req.method,
    headers: {
      ...req.headers,
      host: url.host,
      ...authHeader,
    },
  };
  
  delete options.headers['connection'];
  
  const proxyReq = client.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  
  proxyReq.on('error', (e) => {
    console.error('[proxy] Request error:', e.message);
    res.writeHead(502);
    res.end(JSON.stringify({ error: 'Proxy error', message: e.message }));
  });
  
  req.pipe(proxyReq);
}

/**
 * Make POST request to Z.AI API
 */
function zaiRequest(endpoint, body, callback) {
  const postData = JSON.stringify(body);
  
  const options = {
    hostname: 'api.z.ai',
    port: 443,
    path: `/api/paas/v4/${endpoint}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
      'Authorization': `Bearer ${ZAI_API_KEY}`,
    },
  };
  
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        callback(null, res.statusCode, JSON.parse(data));
      } catch (e) {
        callback(null, res.statusCode, { raw: data });
      }
    });
  });
  
  req.on('error', (e) => callback(e));
  req.write(postData);
  req.end();
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  
  // Health check
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', llm: !!LLM_BASE_URL, zai: !!ZAI_API_KEY }));
    return;
  }
  
  // LLM API proxy: /v1/* -> BASE_URL/* (with Anthropic/Gemini conversion)
  if (url.pathname.startsWith('/v1/')) {
    // Check if Anthropic direct mode (no BASE_URL but ANTHROPIC_API_KEY)
    const useAnthropic = ANTHROPIC_API_KEY && (!LLM_BASE_URL || LLM_PROVIDER === 'anthropic');

    if (!LLM_BASE_URL && !useAnthropic) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'LLM not configured' }));
      return;
    }

    console.log(`[proxy] LLM: ${req.method} ${url.pathname} (${useAnthropic ? 'anthropic' : LLM_PROVIDER})`);

    // For Anthropic: convert format
    if (useAnthropic && url.pathname === '/v1/chat/completions') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          handleAnthropicRequest(req, res, parsed);
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid JSON', message: e.message }));
        }
      });
      return;
    }

    // Default: proxy to BASE_URL
    const targetPath = url.pathname;
    const targetUrl = LLM_BASE_URL.replace(/\/v1$/, '') + targetPath + url.search;

    proxyRequest(req, res, targetUrl, {
      'Authorization': `Bearer ${LLM_API_KEY}`,
    });
    return;
  }
  
  // Z.AI Web Search: /zai/search?q=...
  if (url.pathname === '/zai/search') {
    if (!ZAI_API_KEY) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'ZAI not configured' }));
      return;
    }
    
    const query = url.searchParams.get('q') || '';
    console.log(`[proxy] ZAI search: "${query.slice(0, 50)}..."`);
    
    zaiRequest('web_search', {
      search_engine: 'search-prime',
      search_query: query,
      count: 10,
    }, (err, status, data) => {
      if (err) {
        console.error('[proxy] ZAI error:', err.message);
        res.writeHead(502);
        res.end(JSON.stringify({ error: 'ZAI request failed', message: err.message }));
        return;
      }
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    });
    return;
  }
  
  // Z.AI Web Reader: /zai/read?url=...
  if (url.pathname === '/zai/read') {
    if (!ZAI_API_KEY) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'ZAI not configured' }));
      return;
    }
    
    const pageUrl = url.searchParams.get('url') || '';
    console.log(`[proxy] ZAI read: "${pageUrl.slice(0, 50)}..."`);
    
    zaiRequest('reader', {
      url: pageUrl,
      return_format: 'markdown',
      retain_images: false,
      timeout: 30,
    }, (err, status, data) => {
      if (err) {
        console.error('[proxy] ZAI error:', err.message);
        res.writeHead(502);
        res.end(JSON.stringify({ error: 'ZAI request failed', message: err.message }));
        return;
      }
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    });
    return;
  }
  
  // Unknown route
  res.writeHead(404);
  res.end(JSON.stringify({ 
    error: 'Not found',
    routes: ['/v1/*', '/zai/search?q=...', '/zai/read?url=...', '/health']
  }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[proxy] Listening on port ${PORT}`);
});
