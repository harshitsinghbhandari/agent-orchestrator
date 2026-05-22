import { readFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { builtinModules } from "node:module";
import type { Plugin, RollupOptions } from "rollup";
import typescript from "@rollup/plugin-typescript";

/**
 * Build one rollup entry point per published subpath export.
 *
 * `package.json` `exports` is the source of truth for the public API: each
 * `"./x": { import: "./dist/x.js" }` must have a real `dist/x.js` on disk.
 * With `preserveModules`, rollup tree-shakes any module that is a *pure
 * re-export barrel* (no runtime side effects) — index's `export *` gets
 * flattened straight to the underlying modules, so the barrel's own chunk is
 * never emitted. `tsc` still emits the `.d.ts`, so typecheck passes while the
 * runtime/bundler resolution of the subpath fails. Making every exported
 * entrypoint an explicit input prevents that: entry points are never
 * tree-shaken away. This keeps barrel entrypoints (e.g. `types.ts`) emitted.
 */
function exportEntryPoints(): Record<string, string> {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    exports: Record<string, { import?: string }>;
  };
  const input: Record<string, string> = {};
  for (const entry of Object.values(pkg.exports)) {
    if (!entry.import) continue;
    const key = entry.import.replace(/^\.\/dist\//, "").replace(/\.js$/, "");
    input[key] = `src/${key}.ts`;
  }
  return input;
}

const externalPackages = new Set(["yaml", "zod"]);
const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);

function getPackageName(importId: string): string | null {
  if (importId.startsWith(".") || importId.startsWith("/")) {
    return null;
  }

  const parts = importId.split("/");
  return importId.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function rawMarkdown(): Plugin {
  return {
    name: "raw-markdown",
    async load(id: string) {
      if (!id.endsWith(".md")) {
        return null;
      }

      return `export default ${JSON.stringify(await readFile(id, "utf8"))};`;
    },
  };
}

function cleanDist(): Plugin {
  return {
    name: "clean-dist",
    async buildStart() {
      await rm("dist", { force: true, recursive: true });
    },
  };
}

const config: RollupOptions = {
  input: exportEntryPoints(),
  output: {
    dir: "dist",
    format: "es",
    preserveModules: true,
    preserveModulesRoot: "src",
    sourcemap: true,
  },
  external(id: string) {
    if (nodeBuiltins.has(id) || id.startsWith("node:")) {
      return true;
    }

    const packageName = getPackageName(id);
    return packageName ? externalPackages.has(packageName) : false;
  },
  plugins: [
    cleanDist(),
    rawMarkdown(),
    typescript({
      compilerOptions: {
        declaration: true,
        declarationMap: true,
        module: "Node16",
      },
      tsconfig: "./tsconfig.build.json",
    }),
  ],
};

export default config;
