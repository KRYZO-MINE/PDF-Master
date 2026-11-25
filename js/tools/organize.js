import {
  duplicatePdfPages, parsePageSelection, reorderPdf, rotatePdf, selectPdfPages
} from "../pdf-engine.js";

export async function runOrganizeTool(id, file, options) {
  const documentPages = Number(options.pageCount);
  if (id === "extract") {
    const selected = parsePageSelection(options.pages, documentPages);
    return { bytes: await selectPdfPages(file, selected), filename: `${file.name.replace(/\.pdf$/i, "")}-extracted.pdf` };
  }
  if (id === "delete") {
    const removed = new Set(parsePageSelection(options.pages, documentPages));
    const remaining = Array.from({ length: documentPages }, (_, index) => index).filter((index) => !removed.has(index));
    return { bytes: await selectPdfPages(file, remaining), filename: `${file.name.replace(/\.pdf$/i, "")}-edited.pdf` };
  }
  if (id === "rotate") {
    const selected = options.pages ? parsePageSelection(options.pages, documentPages) : Array.from({ length: documentPages }, (_, index) => index);
    const angle = Number(options.angle);
    return { bytes: await rotatePdf(file, selected, angle), filename: `${file.name.replace(/\.pdf$/i, "")}-rotated.pdf` };
  }
  if (id === "duplicate") {
    const selected = parsePageSelection(options.pages, documentPages);
    return { bytes: await duplicatePdfPages(file, selected), filename: `${file.name.replace(/\.pdf$/i, "")}-duplicated.pdf` };
  }
  if (id === "reorder") {
    const order = options.order.split(",").map((value) => Number(value.trim()) - 1);
    if (order.length !== documentPages || order.some((page) => !Number.isInteger(page))) {
      throw new Error(`Enter all ${documentPages} page numbers once, in the order you want (for example: 3,1,2).`);
    }
    return { bytes: await reorderPdf(file, order), filename: `${file.name.replace(/\.pdf$/i, "")}-reordered.pdf` };
  }
  throw new Error("This organize operation is not available.");
}
