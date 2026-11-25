import { splitPdf } from "../pdf-engine.js";

export async function runSplit(file, pagesPerFile) {
  const bytes = await splitPdf(file, pagesPerFile);
  return { bytes, filename: `${file.name.replace(/\.pdf$/i, "")}-split.zip`, type: "application/zip" };
}
