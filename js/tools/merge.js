import { mergePdfs } from "../pdf-engine.js";

export async function runMerge(files) {
  const bytes = await mergePdfs(files);
  return { bytes, filename: "merged-document.pdf" };
}
