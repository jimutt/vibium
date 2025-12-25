/**
 * MCP Server Tests
 * Tests the clicker mcp command via stdin/stdout JSON-RPC
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');

const CLICKER = path.join(__dirname, '../../clicker/bin/clicker');

/**
 * Helper to run MCP server and send/receive JSON-RPC messages
 */
class MCPClient {
  constructor() {
    this.proc = null;
    this.buffer = '';
    this.responses = [];
    this.resolvers = [];
  }

  start() {
    return new Promise((resolve, reject) => {
      this.proc = spawn(CLICKER, ['mcp'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.proc.stdout.on('data', (data) => {
        this.buffer += data.toString();
        // Process complete JSON lines
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop(); // Keep incomplete line in buffer
        for (const line of lines) {
          if (line.trim()) {
            try {
              const response = JSON.parse(line);
              if (this.resolvers.length > 0) {
                const resolver = this.resolvers.shift();
                resolver(response);
              } else {
                this.responses.push(response);
              }
            } catch (e) {
              // Ignore parse errors for non-JSON output
            }
          }
        }
      });

      this.proc.on('error', reject);

      // Give process a moment to start
      setTimeout(resolve, 100);
    });
  }

  send(method, params = {}, id = null) {
    const msg = {
      jsonrpc: '2.0',
      id: id ?? Date.now(),
      method,
      params,
    };
    this.proc.stdin.write(JSON.stringify(msg) + '\n');
    return msg.id;
  }

  receive(timeout = 60000) {
    return new Promise((resolve, reject) => {
      // Check if we already have a response buffered
      if (this.responses.length > 0) {
        resolve(this.responses.shift());
        return;
      }

      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for response after ${timeout}ms`));
      }, timeout);

      this.resolvers.push((response) => {
        clearTimeout(timer);
        resolve(response);
      });
    });
  }

  async call(method, params = {}) {
    const id = this.send(method, params);
    const response = await this.receive();
    assert.strictEqual(response.id, id, 'Response ID should match request ID');
    return response;
  }

  stop() {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }
}

describe('MCP Server: Protocol', () => {
  let client;

  before(async () => {
    client = new MCPClient();
    await client.start();
  });

  after(() => {
    client.stop();
  });

  test('initialize returns server info and capabilities', async () => {
    const response = await client.call('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0' },
    });

    assert.strictEqual(response.jsonrpc, '2.0');
    assert.ok(response.result, 'Should have result');
    assert.strictEqual(response.result.protocolVersion, '2024-11-05');
    assert.strictEqual(response.result.serverInfo.name, 'vibium');
    assert.ok(response.result.capabilities.tools, 'Should have tools capability');
  });

  test('tools/list returns all 8 browser tools', async () => {
    const response = await client.call('tools/list', {});

    assert.ok(response.result, 'Should have result');
    assert.ok(response.result.tools, 'Should have tools array');
    assert.strictEqual(response.result.tools.length, 8, 'Should have 8 tools');

    const toolNames = response.result.tools.map(t => t.name);
    assert.ok(toolNames.includes('browser_launch'), 'Should have browser_launch');
    assert.ok(toolNames.includes('browser_navigate'), 'Should have browser_navigate');
    assert.ok(toolNames.includes('browser_click'), 'Should have browser_click');
    assert.ok(toolNames.includes('browser_type'), 'Should have browser_type');
    assert.ok(toolNames.includes('browser_screenshot'), 'Should have browser_screenshot');
    assert.ok(toolNames.includes('browser_find'), 'Should have browser_find');
    assert.ok(toolNames.includes('browser_scroll'), 'Should have browser_scroll');
    assert.ok(toolNames.includes('browser_quit'), 'Should have browser_quit');
  });

  test('unknown method returns error', async () => {
    const response = await client.call('unknown/method', {});

    assert.ok(response.error, 'Should have error');
    assert.strictEqual(response.error.code, -32601, 'Should be method not found error');
  });

  test('invalid JSON returns parse error', async () => {
    client.proc.stdin.write('not valid json\n');
    const response = await client.receive();

    assert.ok(response.error, 'Should have error');
    assert.strictEqual(response.error.code, -32700, 'Should be parse error');
  });
});

describe('MCP Server: Browser Tools', () => {
  let client;

  before(async () => {
    client = new MCPClient();
    await client.start();

    // Initialize first
    await client.call('initialize', { capabilities: {} });
  });

  after(() => {
    client.stop();
  });

  test('browser_navigate without launch returns error', async () => {
    const response = await client.call('tools/call', {
      name: 'browser_navigate',
      arguments: { url: 'https://example.com' },
    });

    assert.ok(response.result, 'Should have result');
    assert.strictEqual(response.result.isError, true, 'Should be an error');
    assert.ok(
      response.result.content[0].text.includes('browser_launch'),
      'Error should mention browser_launch'
    );
  });

  test('browser_launch starts browser session', async () => {
    const response = await client.call('tools/call', {
      name: 'browser_launch',
      arguments: { headless: true },
    });

    assert.ok(response.result, 'Should have result');
    assert.ok(!response.result.isError, 'Should not be an error');
    assert.ok(
      response.result.content[0].text.includes('Browser launched'),
      'Should confirm launch'
    );
  });

  test('browser_navigate goes to URL', async () => {
    const response = await client.call('tools/call', {
      name: 'browser_navigate',
      arguments: { url: 'https://example.com' },
    });

    assert.ok(response.result, 'Should have result');
    assert.ok(!response.result.isError, 'Should not be an error');
    assert.ok(
      response.result.content[0].text.includes('example.com'),
      'Should confirm navigation'
    );
  });

  test('browser_find returns element info', async () => {
    const response = await client.call('tools/call', {
      name: 'browser_find',
      arguments: { selector: 'h1' },
    });

    assert.ok(response.result, 'Should have result');
    assert.ok(!response.result.isError, 'Should not be an error');
    assert.ok(
      response.result.content[0].text.includes('tag=h1'),
      'Should find h1 element'
    );
  });

  test('browser_screenshot returns image', async () => {
    const response = await client.call('tools/call', {
      name: 'browser_screenshot',
      arguments: {},
    });

    assert.ok(response.result, 'Should have result');
    assert.ok(!response.result.isError, 'Should not be an error');

    const content = response.result.content[0];
    assert.strictEqual(content.type, 'image', 'Should be image type');
    assert.strictEqual(content.mimeType, 'image/png', 'Should be PNG');
    assert.ok(content.data.length > 100, 'Should have base64 data');
  });

  test('browser_click clicks element', async () => {
    const response = await client.call('tools/call', {
      name: 'browser_click',
      arguments: { selector: 'a' },
    });

    assert.ok(response.result, 'Should have result');
    assert.ok(!response.result.isError, 'Should not be an error');
    assert.ok(
      response.result.content[0].text.includes('Clicked'),
      'Should confirm click'
    );
  });

  test('browser_scroll scrolls down by direction', async () => {
    // Navigate to a page first
    await client.call('tools/call', {
      name: 'browser_navigate',
      arguments: { url: 'https://example.com' },
    });

    const response = await client.call('tools/call', {
      name: 'browser_scroll',
      arguments: { direction: 'down' },
    });

    assert.ok(response.result, 'Should have result');
    assert.ok(!response.result.isError, 'Should not be an error');
    assert.ok(
      response.result.content[0].text.includes('Scrolled down'),
      'Should confirm scroll down'
    );
  });

  test('browser_scroll scrolls up by direction', async () => {
    const response = await client.call('tools/call', {
      name: 'browser_scroll',
      arguments: { direction: 'up', pixels: 100 },
    });

    assert.ok(response.result, 'Should have result');
    assert.ok(!response.result.isError, 'Should not be an error');
    assert.ok(
      response.result.content[0].text.includes('Scrolled up'),
      'Should confirm scroll up'
    );
  });

  test('browser_scroll scrolls to element by selector', async () => {
    const response = await client.call('tools/call', {
      name: 'browser_scroll',
      arguments: { selector: 'h1' },
    });

    assert.ok(response.result, 'Should have result');
    assert.ok(!response.result.isError, 'Should not be an error');
    assert.ok(
      response.result.content[0].text.includes('Scrolled to element'),
      'Should confirm scroll to element'
    );
  });

  test('browser_scroll without arguments returns error', async () => {
    const response = await client.call('tools/call', {
      name: 'browser_scroll',
      arguments: {},
    });

    assert.ok(response.result, 'Should have result');
    assert.strictEqual(response.result.isError, true, 'Should be an error');
  });

  test('browser_quit closes session', async () => {
    const response = await client.call('tools/call', {
      name: 'browser_quit',
      arguments: {},
    });

    assert.ok(response.result, 'Should have result');
    assert.ok(!response.result.isError, 'Should not be an error');
    assert.ok(
      response.result.content[0].text.includes('closed'),
      'Should confirm close'
    );
  });

  test('browser_quit when no session returns gracefully', async () => {
    const response = await client.call('tools/call', {
      name: 'browser_quit',
      arguments: {},
    });

    assert.ok(response.result, 'Should have result');
    assert.ok(!response.result.isError, 'Should not be an error');
  });
});
