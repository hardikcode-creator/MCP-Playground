import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// The backend source uses NodeNext-style ".js" import specifiers that actually
// resolve to ".ts" files at build time. Vite/Vitest don't rewrite those, so map
// any relative ".js" import to its ".ts" sibling when one exists. Package
// (node_modules) imports are left untouched.
const resolveJsToTs: Plugin = {
  name: 'resolve-js-to-ts',
  enforce: 'pre',
  async resolveId(source, importer) {
    if (
      importer &&
      (source.startsWith('./') || source.startsWith('../')) &&
      source.endsWith('.js')
    ) {
      const resolved = await this.resolve(`${source.slice(0, -3)}.ts`, importer, {
        skipSelf: true,
      });
      if (resolved) return resolved;
    }
    return null;
  },
};

export default defineConfig({
  plugins: [resolveJsToTs],
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
