/**
 * tests/mock-ai-server.ts
 *
 * Lightweight HTTP mock server that implements the OpenAI-compatible
 * /v1/chat/completions and Claude /v1/messages endpoints for testing.
 *
 * Usage:
 *   import { startMockAIServer, stopMockAIServer } from './mock-ai-server';
 *
 *   const port = await startMockAIServer();
 *   // Point AI client baseUrl to http://localhost:${port}/v1
 *   // Make requests...
 *   stopMockAIServer();
 */

import * as http from 'http';

let server: http.Server | null = null;

function generateScores(bodyText: string): Record<string, number> {
  const text = bodyText.toLowerCase();
  if (text.includes('good')) return { quality: 90, aesthetic: 90, composition: 85, sharpness: 88, exposure: 92, faceEyes: 80 };
  if (text.includes('bad')) return { quality: 20, aesthetic: 15, composition: 10, sharpness: 12, exposure: 18, faceEyes: 25 };
  if (text.includes('landscape')) return { quality: 70, aesthetic: 65, composition: 60, sharpness: 50, exposure: 55, faceEyes: 50 };
  return { quality: 60, aesthetic: 55, composition: 50, sharpness: 58, exposure: 62, faceEyes: 55 };
}

export function startMockAIServer(port = 9999): Promise<number> {
  return new Promise((resolve, reject) => {
    if (server) { resolve(port); return; }

    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');

        const isClaude = req.url?.includes('/messages');
        const scores = generateScores(body);

        if (isClaude) {
          res.end(JSON.stringify({
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: JSON.stringify({ ...scores, reasoning: 'Mock response' }) }],
            usage: { input_tokens: 100, output_tokens: 50 },
          }));
        } else {
          // OpenAI-compatible
          res.end(JSON.stringify({
            id: 'chatcmpl_test',
            choices: [{ message: { content: JSON.stringify({ ...scores, reasoning: 'Mock response' }) } }],
            usage: { prompt_tokens: 200, completion_tokens: 50 },
          }));
        }
      });
    });

    server.listen(port, () => { resolve(port); });
    server.on('error', reject);
  });
}

export function stopMockAIServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) { resolve(); return; }
    server.close(() => {
      server = null;
      resolve();
    });
  });
}
