/** Execute only authored Engine modules, preserving controlled external owners. */
import { readFileSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Script, createContext } from "node:vm";
import ts from "typescript";
const root = fileURLToPath(new URL("../src/", import.meta.url));
const compiled = new Map();
export function sourceWorld(entry, dependencies, globals, meta) {
  const context = createContext(globals), cache = new Map();
  const load = file => {
    const inside = relative(root, file);
    if (inside.startsWith("..") || inside.startsWith("/")) throw new Error(`source world escaped Engine: ${file}`);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    if (file.endsWith(".json")) { module.exports = JSON.parse(readFileSync(file, "utf8")); return module.exports; }
    let code = compiled.get(file);
    if (code === undefined) {
      code = ts.transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      }).outputText;
      compiled.set(file, code);
    }
    const require = name => {
      // Stubs are declared relative to the source root, never an implicit runtime fallback.
      const key = name.startsWith(".") ? "./" + relative(root, resolve(dirname(file), name)).split("\\").join("/") : name;
      if (Object.hasOwn(dependencies, key)) return dependencies[key];
      if (!name.startsWith(".")) throw new Error(`unexpected controlled dependency ${name}`);
      return load(resolve(dirname(file), name.replace(/\.js$/, ".ts")));
    };
    const factory = new Script(`(function(module,exports,require){${code.replaceAll('import.meta.url', JSON.stringify(meta))}\n})`, { filename: file }).runInContext(context);
    factory(module, module.exports, require);
    return module.exports;
  };
  return load(resolve(root, entry));
}
