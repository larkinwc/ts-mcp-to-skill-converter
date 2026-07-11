import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { MCPExecutor } from '../src/executor';

function createEchoServer(): McpServer {
  const server = new McpServer({ name: 'http-fixture', version: '1.0.0' });
  server.registerTool(
    'echo',
    {
      description: 'Echo text exactly',
      inputSchema: { text: z.string() },
    },
    async ({ text }) => ({ content: [{ type: 'text', text }] })
  );
  return server;
}

test('executes over Streamable HTTP with bearer and custom headers', { timeout: 10_000 }, async () => {
  const app = createMcpExpressApp();
  let observedAuthorization: string | undefined;
  let observedTenant: string | undefined;
  app.post('/mcp', async (request, response) => {
    observedAuthorization = request.header('authorization');
    observedTenant = request.header('x-tenant');
    const server = createEchoServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
    response.on('close', () => {
      void transport.close();
      void server.close();
    });
  });

  const httpServer = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => httpServer.once('listening', resolve));
  const port = (httpServer.address() as AddressInfo).port;
  const executor = new MCPExecutor({
    name: 'http-fixture',
    type: 'http',
    url: `http://127.0.0.1:${port}/mcp`,
    headers: { 'X-Tenant': '${TENANT}' },
    auth: { type: 'bearer', token: '${MCP_TOKEN}' },
  });

  try {
    process.env.TENANT = 'tenant-one';
    process.env.MCP_TOKEN = 'bearer-secret';
    const result = await executor.callTool('echo', { text: 'streamable' });
    assert.equal((result as Array<{ text: string }>)[0].text, 'streamable');
    assert.equal(observedAuthorization, 'Bearer bearer-secret');
    assert.equal(observedTenant, 'tenant-one');
  } finally {
    delete process.env.TENANT;
    delete process.env.MCP_TOKEN;
    await executor.close();
    await new Promise<void>((resolve, reject) =>
      httpServer.close((error) => error ? reject(error) : resolve())
    );
  }
});

test('executes over legacy SSE transport', { timeout: 10_000 }, async () => {
  const app = createMcpExpressApp();
  const transports = new Map<string, SSEServerTransport>();

  app.get('/sse', async (_request, response) => {
    const transport = new SSEServerTransport('/messages', response);
    transports.set(transport.sessionId, transport);
    transport.onclose = () => transports.delete(transport.sessionId);
    await createEchoServer().connect(transport);
  });
  app.post('/messages', async (request, response) => {
    const sessionId = String(request.query.sessionId ?? '');
    const transport = transports.get(sessionId);
    if (!transport) {
      response.status(404).send('Session not found');
      return;
    }
    await transport.handlePostMessage(request, response, request.body);
  });

  const httpServer = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => httpServer.once('listening', resolve));
  const port = (httpServer.address() as AddressInfo).port;
  const executor = new MCPExecutor({
    name: 'sse-fixture',
    type: 'sse',
    url: `http://127.0.0.1:${port}/sse`,
  });

  try {
    const result = await executor.callTool('echo', { text: 'legacy-sse' });
    assert.equal((result as Array<{ text: string }>)[0].text, 'legacy-sse');
  } finally {
    await executor.close();
    for (const transport of transports.values()) await transport.close();
    await new Promise<void>((resolve, reject) =>
      httpServer.close((error) => error ? reject(error) : resolve())
    );
  }
});

test('performs OAuth client-credentials discovery and token exchange', { timeout: 10_000 }, async () => {
  const app = createMcpExpressApp();
  let baseUrl = '';
  let tokenRequests = 0;
  let authenticatedRequests = 0;

  app.get('/.well-known/oauth-protected-resource', (_request, response) => {
    response.json({
      resource: `${baseUrl}/mcp`,
      authorization_servers: [baseUrl],
      scopes_supported: ['mcp:tools'],
    });
  });
  app.get('/.well-known/oauth-authorization-server', (_request, response) => {
    response.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/authorize`,
      response_types_supported: ['code'],
      token_endpoint: `${baseUrl}/token`,
      grant_types_supported: ['client_credentials'],
      token_endpoint_auth_methods_supported: ['client_secret_basic'],
    });
  });
  app.post('/token', async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = new URLSearchParams(Buffer.concat(chunks).toString('utf-8'));
    const basic = request.header('authorization') ?? '';
    assert.equal(
      Buffer.from(basic.replace(/^Basic /, ''), 'base64').toString('utf-8'),
      'test-client:test-secret'
    );
    assert.equal(body.get('grant_type'), 'client_credentials');
    tokenRequests += 1;
    response.json({
      access_token: 'oauth-access-token',
      token_type: 'Bearer',
      expires_in: 300,
      scope: 'mcp:tools',
    });
  });
  app.post('/mcp', async (request, response) => {
    if (request.header('authorization') !== 'Bearer oauth-access-token') {
      response
        .status(401)
        .set(
          'WWW-Authenticate',
          `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource", scope="mcp:tools"`
        )
        .send('Unauthorized');
      return;
    }
    authenticatedRequests += 1;
    const server = createEchoServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
    response.on('close', () => {
      void transport.close();
      void server.close();
    });
  });

  const httpServer = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => httpServer.once('listening', resolve));
  const port = (httpServer.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
  const executor = new MCPExecutor({
    name: 'oauth-fixture',
    type: 'http',
    url: `${baseUrl}/mcp`,
    auth: {
      type: 'oauth-client-credentials',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      scope: 'mcp:tools',
    },
  });

  try {
    const result = await executor.callTool('echo', { text: 'oauth' });
    assert.equal((result as Array<{ text: string }>)[0].text, 'oauth');
    assert.equal(tokenRequests, 1);
    assert.ok(authenticatedRequests >= 1);
  } finally {
    await executor.close();
    await new Promise<void>((resolve, reject) =>
      httpServer.close((error) => error ? reject(error) : resolve())
    );
  }
});
