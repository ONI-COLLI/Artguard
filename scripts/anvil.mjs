import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
export function anvilPath() {
  const platform = process.platform;
  const arch = process.arch === 'x64' ? 'amd64' : process.arch;
  const name = `@foundry-rs/anvil-${platform}-${arch}`;
  try {
    return join(
      dirname(require.resolve(`${name}/package.json`)),
      'bin',
      platform === 'win32' ? 'anvil.exe' : 'anvil',
    );
  } catch {
    throw new Error(
      `Anvil binary unavailable for ${platform}/${arch}. Run npm ci with optional dependencies enabled.`,
    );
  }
}
