import assert from 'node:assert/strict';
import test from 'node:test';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  parseConfigDocument,
  parseToolCall,
  resolveConfigEnvironment,
  selectServerConfigs,
} from '../src/mcp/config';
import { createMCPTransport } from '../src/mcp/transport';
import { generateSkillMd, skillNameFromServerName } from '../src/generator/skill-md';

test('validates direct and wrapped configurations', () => {
  const direct = parseConfigDocument({
    name: 'local',
    command: 'node',
    args: ['server.js'],
  });
  assert.equal(direct.servers.local.name, 'local');

  const wrapped = parseConfigDocument({
    mcpServers: {
      one: { command: 'one' },
      two: { type: 'http', url: 'https://example.com/mcp' },
    },
  });
  assert.deepEqual(Object.keys(wrapped.servers), ['one', 'two']);
  assert.throws(
    () => selectServerConfigs(wrapped, {}),
    /Select one with --server <name> or generate all with --all/
  );
  assert.equal(selectServerConfigs(wrapped, { server: 'two' })[0].name, 'two');
  assert.equal(selectServerConfigs(wrapped, { all: true }).length, 2);
});

test('rejects malformed configuration and tool calls at the boundary', () => {
  assert.throws(
    () => parseConfigDocument({ name: 'broken', type: 'http' }),
    /Invalid MCP configuration/
  );
  assert.throws(() => parseToolCall('{'), /Invalid --call JSON/);
  assert.throws(
    () => parseToolCall('{"arguments":{}}'),
    /Invalid --call value/
  );
});

test('resolves secret references without persisting resolved values', () => {
  const parsed = parseConfigDocument({
    name: 'remote',
    type: 'http',
    url: 'https://example.com/mcp',
    headers: { 'X-Key': '${API_KEY}' },
    auth: {
      type: 'oauth-client-credentials',
      clientId: '${CLIENT_ID}',
      clientSecret: '${CLIENT_SECRET}',
    },
  }).servers.remote;

  const resolved = resolveConfigEnvironment(parsed, {
    API_KEY: 'header-secret',
    CLIENT_ID: 'client-id',
    CLIENT_SECRET: 'client-secret',
  });
  assert.equal(resolved.type, 'http');
  if (resolved.type !== 'http') assert.fail('expected HTTP config');
  assert.equal(resolved.headers?.['X-Key'], 'header-secret');
  assert.equal(resolved.auth?.type, 'oauth-client-credentials');
  if (resolved.auth?.type !== 'oauth-client-credentials') {
    assert.fail('expected OAuth client credentials');
  }
  assert.equal(resolved.auth.clientSecret, 'client-secret');
  assert.equal(parsed.auth?.type, 'oauth-client-credentials');
  if (parsed.auth?.type === 'oauth-client-credentials') {
    assert.equal(parsed.auth.clientSecret, '${CLIENT_SECRET}');
  }
  assert.throws(
    () => resolveConfigEnvironment(parsed, {}),
    /Required environment variable (API_KEY|CLIENT_ID|CLIENT_SECRET) is not set/
  );
});

test('selects modern HTTP and legacy SSE transports', () => {
  const http = createMCPTransport({
    name: 'http',
    type: 'http',
    url: 'https://example.com/mcp',
  });
  const sse = createMCPTransport({
    name: 'sse',
    type: 'sse',
    url: 'https://example.com/sse',
  });
  assert.ok(http instanceof StreamableHTTPClientTransport);
  assert.ok(sse instanceof SSEClientTransport);
});

test('creates safe, deterministic Agent Skill names', () => {
  assert.equal(skillNameFromServerName('Alpha Server'), 'alpha-server');
  assert.equal(skillNameFromServerName('Café !!!'), 'cafe');
  assert.equal(skillNameFromServerName('../../target'), 'target');
  assert.throws(() => skillNameFromServerName('!!!'), /valid skill name/);

  const longName = 'A very long MCP server name '.repeat(5);
  const slug = skillNameFromServerName(longName);
  assert.ok(slug.length <= 64);
  assert.match(slug, /-[a-f0-9]{8}$/);
  assert.equal(slug, skillNameFromServerName(longName));
});

test('generates shell-safe call-file instructions and quoted config paths', () => {
  const markdown = generateSkillMd(
    'Example Server',
    [{
      name: 'echo',
      description: 'Echo values',
      inputSchema: { type: 'object' },
    }],
    '0.3.0'
  );
  assert.match(markdown, /name: "example-server"/);
  assert.match(markdown, /--config "\$SKILL_DIR\/mcp-config\.json" --call-file/);
  assert.doesNotMatch(markdown, /--call '\{/);
});
