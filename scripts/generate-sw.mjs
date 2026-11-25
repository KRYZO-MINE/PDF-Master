import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist");
const publicCopies = [
  ["manifest.json", "manifest.json"],
  ["offline.html", "offline.html"],
  ["assets/icons/icon.svg", "assets/icons/icon.svg"]
];

for (const [source, destination] of publicCopies) {
  const target = path.join(output, destination);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(root, source), target);
}

const libraries = path.join(root, "node_modules");
const offlineLibraryRoot = path.join(output, "libraries", "pdfjs");
await cp(path.join(libraries, "pdfjs-dist", "cmaps"), path.join(offlineLibraryRoot, "cmaps"), { recursive: true });
await cp(path.join(libraries, "pdfjs-dist", "standard_fonts"), path.join(offlineLibraryRoot, "standard_fonts"), { recursive: true });
const licenseDirectory = path.join(output, "libraries", "licenses");
await mkdir(licenseDirectory, { recursive: true });
await copyFile(path.join(libraries, "pdfjs-dist", "LICENSE"), path.join(licenseDirectory, "pdfjs-dist-LICENSE"));
await copyFile(path.join(libraries, "pdf-lib", "LICENSE.md"), path.join(licenseDirectory, "pdf-lib-LICENSE.md"));
await copyFile(path.join(libraries, "jszip", "LICENSE.markdown"), path.join(licenseDirectory, "jszip-LICENSE.markdown"));

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(absolute));
    else files.push(absolute);
  }
  return files;
}

const files = (await listFiles(output))
  .filter((file) => {
    const relative = path.relative(output, file).split(path.sep).join("/");
    return !relative.startsWith(".vite/")
      && !["service-worker.js", "precache-manifest.json"].includes(path.basename(file));
  })
  .map((file) => `/${path.relative(output, file).split(path.sep).join("/")}`)
  .sort();
const worker = await readFile(path.join(root, "service-worker.js"), "utf8");
const revision = createHash("sha256").update(`${files.join("\n")}\n${worker}`).digest("hex").slice(0, 12);
const manifest = { revision, urls: files };
await writeFile(path.join(output, "precache-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(output, "service-worker.js"), worker.replaceAll("__PRECACHE_REVISION__", revision));
console.log(`Prepared offline cache manifest for ${files.length} assets (${revision}).`);
