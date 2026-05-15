import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { stripTypeScriptTypes } from "node:module";

const root = process.cwd();
const srcDir = join(root, "src");
const distDir = join(root, "dist");

async function collectTypescriptFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTypescriptFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push(path);
    }
  }

  return files;
}

await rm(distDir, { recursive: true, force: true });

const files = await collectTypescriptFiles(srcDir);
for (const file of files) {
  const source = await readFile(file, "utf8");
  const js = stripTypeScriptTypes(source, { mode: "strip" });
  const cleanedJs = js.replace(/[ \t]+$/gm, "");
  const outFile = join(distDir, relative(srcDir, file)).replace(/\.ts$/, ".js");
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, `${cleanedJs}\n`);
}

console.log(`Built ${files.length} TypeScript files into dist/.`);
