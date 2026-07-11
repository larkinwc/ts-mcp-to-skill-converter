import * as fs from 'node:fs/promises';
import { z } from 'zod';
import { isHttpConfig } from './types';
import type {
  MCPConfigDocument,
  MCPServerConfig,
  MCPTool,
  ToolSnapshot,
} from './types';

const stringMapSchema = z.record(z.string(), z.string());

const stdioConfigSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.literal('stdio').optional(),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: stringMapSchema.optional(),
  cwd: z.string().min(1).optional(),
}).strict();

const bearerAuthSchema = z.object({
  type: z.literal('bearer'),
  token: z.string().min(1),
}).strict();

const oauthClientCredentialsSchema = z.object({
  type: z.literal('oauth-client-credentials'),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  scope: z.string().min(1).optional(),
}).strict();

const httpConfigSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['http', 'sse']),
  url: z.url(),
  headers: stringMapSchema.optional(),
  auth: z.discriminatedUnion('type', [
    bearerAuthSchema,
    oauthClientCredentialsSchema,
  ]).optional(),
}).strict();

export const mcpServerConfigSchema = z.union([
  stdioConfigSchema,
  httpConfigSchema,
]);

const wrappedServerConfigSchema = z.union([
  stdioConfigSchema.omit({ name: true }),
  httpConfigSchema.omit({ name: true }),
]);

const claudeDesktopConfigSchema = z.object({
  mcpServers: z.record(z.string().min(1), wrappedServerConfigSchema),
}).strict();

export const mcpToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()),
}).strict();

export const toolSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  serverName: z.string().min(1),
  generatedAt: z.string(),
  tools: z.array(mcpToolSchema),
}).strict();

export const toolCallSchema = z.object({
  tool: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).optional(),
}).strict();

function describeValidationError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const location = issue.path.length > 0 ? issue.path.join('.') : 'config';
      return `${location}: ${issue.message}`;
    })
    .join('; ');
}

export function parseConfigDocument(rawConfig: unknown): MCPConfigDocument {
  const wrappedResult = claudeDesktopConfigSchema.safeParse(rawConfig);
  if (wrappedResult.success) {
    const entries = Object.entries(wrappedResult.data.mcpServers);
    if (entries.length === 0) {
      throw new Error('No MCP servers found in config');
    }

    return {
      wrapped: true,
      servers: Object.fromEntries(
        entries.map(([name, config]) => [name, { name, ...config }])
      ) as Record<string, MCPServerConfig>,
    };
  }

  const directResult = mcpServerConfigSchema.safeParse(rawConfig);
  if (directResult.success) {
    return {
      wrapped: false,
      servers: { [directResult.data.name]: directResult.data },
    };
  }

  throw new Error(
    `Invalid MCP configuration: ${describeValidationError(directResult.error)}`
  );
}

export async function loadConfigDocument(path: string): Promise<MCPConfigDocument> {
  let rawConfig: unknown;
  try {
    rawConfig = JSON.parse(await fs.readFile(path, 'utf-8'));
  } catch (error) {
    throw new Error(
      `Could not read MCP configuration ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return parseConfigDocument(rawConfig);
}

export function selectServerConfigs(
  document: MCPConfigDocument,
  options: { server?: string; all?: boolean }
): MCPServerConfig[] {
  if (options.server && options.all) {
    throw new Error('Use either --server or --all, not both');
  }

  if (options.server) {
    const selected = document.servers[options.server];
    if (!selected) {
      throw new Error(
        `MCP server "${options.server}" was not found. Available servers: ${Object.keys(document.servers).join(', ')}`
      );
    }
    return [selected];
  }

  const configs = Object.values(document.servers);
  if (options.all) return configs;
  if (configs.length === 1) return configs;

  throw new Error(
    `Configuration contains multiple MCP servers (${Object.keys(document.servers).join(', ')}). Select one with --server <name> or generate all with --all.`
  );
}

const environmentReferencePattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function resolveEnvironmentValue(
  value: string,
  environment: NodeJS.ProcessEnv = process.env
): string {
  return value.replace(environmentReferencePattern, (_match, variable: string) => {
    const resolved = environment[variable];
    if (resolved === undefined) {
      throw new Error(`Required environment variable ${variable} is not set`);
    }
    return resolved;
  });
}

function resolveStringMap(
  values: Record<string, string> | undefined,
  environment: NodeJS.ProcessEnv
): Record<string, string> | undefined {
  if (!values) return undefined;
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      resolveEnvironmentValue(value, environment),
    ])
  );
}

export function resolveConfigEnvironment(
  config: MCPServerConfig,
  environment: NodeJS.ProcessEnv = process.env
): MCPServerConfig {
  if (isHttpConfig(config)) {
    const auth = config.auth?.type === 'bearer'
      ? {
          ...config.auth,
          token: resolveEnvironmentValue(config.auth.token, environment),
        }
      : config.auth
        ? {
            ...config.auth,
            clientId: resolveEnvironmentValue(config.auth.clientId, environment),
            clientSecret: resolveEnvironmentValue(
              config.auth.clientSecret,
              environment
            ),
          }
        : undefined;

    return {
      ...config,
      headers: resolveStringMap(config.headers, environment),
      auth,
    };
  }

  return {
    ...config,
    env: resolveStringMap(config.env, environment),
    cwd: config.cwd
      ? resolveEnvironmentValue(config.cwd, environment)
      : undefined,
  };
}

function isEnvironmentReference(value: string): boolean {
  environmentReferencePattern.lastIndex = 0;
  return environmentReferencePattern.test(value);
}

export function makeConfigPortable(
  config: MCPServerConfig,
  environment: NodeJS.ProcessEnv = process.env
): MCPServerConfig {
  if (isHttpConfig(config) || !config.env) {
    return config;
  }

  return {
    ...config,
    env: Object.fromEntries(
      Object.entries(config.env).map(([key, value]) => [
        key,
        !isEnvironmentReference(value) && environment[key] === value
          ? `\${${key}}`
          : value,
      ])
    ),
  };
}

export function findLiteralSecretWarnings(config: MCPServerConfig): string[] {
  const warnings: string[] = [];
  const sensitiveName = /(token|secret|password|api[_-]?key|authorization)/i;

  if (isHttpConfig(config)) {
    for (const [name, value] of Object.entries(config.headers ?? {})) {
      if (sensitiveName.test(name) && !isEnvironmentReference(value)) {
        warnings.push(`header ${name}`);
      }
    }
    if (config.auth?.type === 'bearer' && !isEnvironmentReference(config.auth.token)) {
      warnings.push('bearer token');
    }
    if (
      config.auth?.type === 'oauth-client-credentials' &&
      !isEnvironmentReference(config.auth.clientSecret)
    ) {
      warnings.push('OAuth client secret');
    }
  } else {
    for (const [name, value] of Object.entries(config.env ?? {})) {
      if (sensitiveName.test(name) && !isEnvironmentReference(value)) {
        warnings.push(`environment value ${name}`);
      }
    }
  }

  return warnings;
}

export function parseToolCall(value: string): z.infer<typeof toolCallSchema> {
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch (error) {
    throw new Error(
      `Invalid --call JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const result = toolCallSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid --call value: ${describeValidationError(result.error)}`);
  }
  return result.data;
}

export async function loadToolSnapshot(path: string): Promise<ToolSnapshot> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(path, 'utf-8'));
  } catch (error) {
    throw new Error(
      `Could not read tool snapshot ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const snapshotResult = toolSnapshotSchema.safeParse(raw);
  if (snapshotResult.success) return snapshotResult.data;

  const toolsResult = z.array(mcpToolSchema).safeParse(raw);
  if (toolsResult.success) {
    return {
      schemaVersion: 1,
      serverName: 'unknown',
      generatedAt: new Date(0).toISOString(),
      tools: toolsResult.data as MCPTool[],
    };
  }

  throw new Error(
    `Invalid tool snapshot: ${describeValidationError(snapshotResult.error)}`
  );
}
