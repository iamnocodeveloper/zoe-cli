import { createRequire } from 'node:module';

export interface ZoePackageMetadata {
  readonly name: string;
  readonly version: string;
}

let cached: ZoePackageMetadata | null = null;

export function getZoePackageMetadata(): ZoePackageMetadata {
  if (cached) return cached;
  let value: ZoePackageMetadata = { name: '@nocodeveloper/zoe-cli', version: 'unknown' };
  try {
    const pkg = createRequire(import.meta.url)('../../package.json') as Partial<ZoePackageMetadata>;
    value = {
      name: typeof pkg.name === 'string' ? pkg.name : value.name,
      version: typeof pkg.version === 'string' ? pkg.version : value.version,
    };
  } catch {
    // Installed and source builds both normally include package.json.
  }
  cached = Object.freeze(value);
  return cached;
}
