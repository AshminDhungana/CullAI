/**
 * tests/mock-ai-server.ts
 *
 * Phase 17.10 — Mock AI Server for Integration Tests
 *
 * Lightweight HTTP mock server implementing OpenAI chat completions and
 * Anthropic Messages endpoints.  Accepts JSON payloads, extracts filenames
 * from prompt text, and returns deterministic AI responses based on simple
 * heuristic rules (e.g. filename contains "good" → high scores).
 *
 * Usage:
 *   const server = new MockAIServer();
 *   await server.start();
 *   // Pass server.getBaseUrl() as the AI provider baseUrl
 *   await server.stop();
 */

import http from 'http';
import { AddressInfo } from 'net';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MockRequestInfo {
  url: string;
  body: unknown;
}

// ---------------------------------------------------------------------------
// MockAIServer
// ---------------------------------------------------------------------------

export class MockAIServer {
  private server: http.Server | null = null;

  /** The port the server is listening on.  Set after `start()` resolves. */
  public port: number;

  /** All requests received since the last clear. */
  public receivedRequests: MockRequestInfo[] = [];

  /** When true, logs startup and routing info to console. */
  public logRequests = false;

  constructor(port = 0) {
    this.port = port;
  }

  /** Starts the server and resolves when listening. */
  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          console.error('[MockAI] Request handler error:', err);
          if (!res.writableEnded) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
        });
      });

      this.server.listen(this.port, () => {
        const addr = this.server!.address() as AddressInfo;
        this.port = addr.port;
        if (this.logRequests) {
          console.log(`[MockAI] Server started at ${this.getBaseUrl()}`);
        }
        resolve();
      });
    });
  }

  /** Stops the server and releases the port. */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
  }

  /** Full base URL, e.g. `http://localhost:49152`. */
  getBaseUrl(): string {
    return `http://localhost:${this.port}`;
  }

  // ---------------------------------------------------------------------------
  // Request routing
  // ---------------------------------------------------------------------------

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    let bodyStr = '';
    for await (const chunk of req) {
      bodyStr += chunk;
    }

    let body: unknown;
    try {
      body = JSON.parse(bodyStr);
    } catch {
      body = {};
    }

    this.receivedRequests.push({ url: req.url || '/', body });

    const url = req.url || '';

    if (url.includes('/chat/completions')) {
      this.respondOpenAI(res, body);
    } else if (url.endsWith('/messages')) {
      this.respondClaude(res, body);
    } else if (url.includes('/models')) {
      this.respondModels(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  }

  // ---------------------------------------------------------------------------
  // OpenAI-compatible response
  // ---------------------------------------------------------------------------

  private respondOpenAI(res: http.ServerResponse, body: unknown) {
    const content = this.generateResponseContent(body);
    const response = {
      id: `mock-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: (body as any)?.model || 'mock-model',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      },
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  }

  // ---------------------------------------------------------------------------
  // Claude (Anthropic) response
  // ---------------------------------------------------------------------------

  private respondClaude(res: http.ServerResponse, body: unknown) {
    const content = this.generateResponseContent(body);
    const response = {
      id: `mock-${Date.now()}`,
      type: 'message',
      role: 'assistant',
      model: (body as any)?.model || 'mock-model',
      content: [{ type: 'text', text: content }],
      usage: { input_tokens: 100, output_tokens: 50 },
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  }

  // ---------------------------------------------------------------------------
  // Models list (OpenAI-compatible)
  // ---------------------------------------------------------------------------

  private respondModels(res: http.ServerResponse) {
    const response = {
      data: [
        { id: 'gpt-4o', object: 'model' },
        { id: 'gpt-4o-mini', object: 'model' },
        { id: 'claude-sonnet-4-6', object: 'model' },
      ],
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  }

  // ---------------------------------------------------------------------------
  // Content generation — dispatch by call type
  // ---------------------------------------------------------------------------

  private generateResponseContent(body: unknown): string {
    const messages = (body as any)?.messages || [];
    const promptText = this.extractPromptText(messages);

    if (this.isTaggingCall(promptText)) {
      return this.generateTaggingContent(promptText);
    }

    if (this.isDiscoveryCall(promptText)) {
      return this.generateDiscoveryContent();
    }

    return this.generateScoringContent(promptText);
  }

  // ---------------------------------------------------------------------------
  // Prompt extraction from messages
  // ---------------------------------------------------------------------------

  private extractPromptText(messages: unknown[]): string {
    if (!Array.isArray(messages) || messages.length === 0) {
      return '';
    }

    const firstMessage = messages[0];
    const content = (firstMessage as any)?.content;
    if (!content) return '';

    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .filter((item: any) => item.type === 'text' && typeof item.text === 'string')
        .map((item: any) => item.text)
        .join(' ');
    }

    return '';
  }

  // ---------------------------------------------------------------------------
  // Call-type detection
  // ---------------------------------------------------------------------------

  private isTaggingCall(prompt: string): boolean {
    return (
      prompt.includes('keywording assistant') ||
      prompt.includes('descriptive keyword')
    );
  }

  private isDiscoveryCall(prompt: string): boolean {
    return (
      prompt.includes('analysing a batch') ||
      prompt.includes('What is the visual style') ||
      prompt.includes('What does "best" mean')
    );
  }

  // ---------------------------------------------------------------------------
  // Scoring response — deterministic by filename
  // ---------------------------------------------------------------------------

  private generateScoringContent(prompt: string): string {
    const match = prompt.match(/Image filename:?\s*([^\n]+)/i);
    const filename = match ? match[1].trim() : 'unknown.jpg';

    const scores = this.scoresForFilename(filename);
    const reasoning = `Scored based on image content of ${filename} using mock AI`;

    return JSON.stringify({
      ...scores,
      reasoning,
    });
  }

  private scoresForFilename(filename: string): Record<string, number> {
    const base = filename.toLowerCase();

    // "Good" images
    if (/good|great|excellent|amazing|perfect/.test(base)) {
      return {
        quality: 95,
        aesthetic: 93,
        composition: 90,
        sharpness: 92,
        exposure: 91,
        faceEyes: 96,
      };
    }

    // "Bad" images
    if (/bad|poor|blurry|reject|dark|underexposed/.test(base)) {
      return {
        quality: 25,
        aesthetic: 20,
        composition: 22,
        sharpness: 15,
        exposure: 10,
        faceEyes: 20,
      };
    }

    // Landscapes / scenic
    if (/landscape|scenic|nature|mountain/.test(base)) {
      return {
        quality: 62,
        aesthetic: 75,
        composition: 68,
        sharpness: 60,
        exposure: 65,
        faceEyes: 25,
      };
    }

    // Portraits / faces
    if (/portrait|face|person/.test(base)) {
      return {
        quality: 65,
        aesthetic: 60,
        composition: 62,
        sharpness: 58,
        exposure: 64,
        faceEyes: 85,
      };
    }

    // Default
    return {
      quality: 60,
      aesthetic: 60,
      composition: 60,
      sharpness: 60,
      exposure: 60,
      faceEyes: 60,
    };
  }

  // ---------------------------------------------------------------------------
  // Discovery response — plain text summary
  // ---------------------------------------------------------------------------

  private generateDiscoveryContent(): string {
    return (
      'Wedding shoot with natural golden-hour lighting and candid moments. ' +
      'The best shots feature emotional connections and soft, diffused light. ' +
      'Strong compositions with clean backgrounds and genuine expressions.'
    );
  }

  // ---------------------------------------------------------------------------
  // Tagging response — JSON { filename: string[] }
  // ---------------------------------------------------------------------------

  private generateTaggingContent(prompt: string): string {
    const keywords: Record<string, string[]> = {};

    // Extract quoted filenames
    const regex = /"([^"]+\.(?:jpg|jpeg|png|cr3|nef|arw|raf|dng|orf|pef|tiff?|gif|webp|heic|avif))"/gi;
    const matches = prompt.matchAll(regex);
    for (const match of matches) {
      const filename = match[1].toLowerCase();
      keywords[match[1]] = this.keywordsForFilename(filename);
    }

    return JSON.stringify(keywords);
  }

  private keywordsForFilename(filename: string): string[] {
    if (filename.includes('wedding')) {
      return ['wedding', 'bride', 'groom', 'ceremony', 'candid', 'emotional'];
    }
    if (filename.includes('portrait') || filename.includes('face')) {
      return ['portrait', 'natural light', 'smile', 'person', 'close-up'];
    }
    if (filename.includes('landscape') || filename.includes('nature')) {
      return ['landscape', 'nature', 'scenic', 'mountain', 'outdoor'];
    }
    return ['photography', 'image', 'photo', 'capture', 'session'];
  }
}
