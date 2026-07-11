import { readFileSync } from 'node:fs';

interface PackageMetadata {
  version?: unknown;
}

const packageMetadata = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8')
) as PackageMetadata;

if (typeof packageMetadata.version !== 'string') {
  throw new Error('Package version is missing from package.json');
}

export const PACKAGE_VERSION = packageMetadata.version;
