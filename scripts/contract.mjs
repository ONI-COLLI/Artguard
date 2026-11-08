import { readFile } from 'node:fs/promises';
import solc from 'solc';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
export async function compileContract(name) {
  const source = await readFile(new URL(`../contracts/${name}.sol`, import.meta.url), 'utf8');
  const output = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: 'Solidity',
        sources: { [`${name}.sol`]: { content: source } },
        settings: {
          evmVersion: 'cancun',
          viaIR: true,
          optimizer: { enabled: true, runs: 200 },
          outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
        },
      }),
      {
        import: (path) => {
          if (!path.startsWith('@openzeppelin/contracts/')) return { error: 'Unsupported import' };
          try {
            return { contents: readFileSync(resolve('node_modules', path), 'utf8') };
          } catch {
            return { error: `Import not found: ${path}` };
          }
        },
      },
    ),
  );
  const errors = output.errors?.filter((e) => e.severity === 'error');
  if (errors?.length) throw new Error(errors.map((e) => e.formattedMessage).join('\n'));
  const contract = output.contracts[`${name}.sol`][name];
  return { abi: contract.abi, bytecode: '0x' + contract.evm.bytecode.object };
}
export const compileRegistry = () => compileContract('ArtworkRegistry');
export const compileMarketplace = () => compileContract('LicenseMarketplace');
