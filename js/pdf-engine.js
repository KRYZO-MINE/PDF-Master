import { PDFDocument, degrees } from "pdf-lib";
import { safeName } from "./file-manager.js";

export function parsePageSelection(value, pageCount) {
  const pages = new Set();
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) throw new Error("Enter at least one page number or range.");

  for (const part of parts) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!match) throw new Error(`"${part}" is not a valid page number or range.`);
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    if (start < 1 || end < 1 || start > pageCount || end > pageCount) {
      throw new Error(`Page numbers must be between 1 and ${pageCount}.`);
    }
    if (end < start) throw new Error(`Use an ascending range for "${part}".`);
    for (let page = start; page <= end; page += 1) pages.add(page - 1);
  }
  return [...pages].sort((a, b) => a - b);
}

function normalizedBytes(bytes) {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

export async function mergePdfs(files) {
  if (files.length < 2) throw new Error("Choose at least two PDF files to merge.");
  const output = await PDFDocument.create();
  for (const file of files) {
    const source = await PDFDocument.load(await file.arrayBuffer());
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach((page) => output.addPage(page));
  }
  return output.save();
}

export async function selectPdfPages(file, indices) {
  if (!indices.length) throw new Error("The selected operation would create an empty PDF.");
  const source = await PDFDocument.load(await file.arrayBuffer());
  const output = await PDFDocument.create();
  const pages = await output.copyPages(source, indices);
  pages.forEach((page) => output.addPage(page));
  return output.save();
}

export async function splitPdf(file, pagesPerFile = 1) {
  if (!Number.isInteger(pagesPerFile) || pagesPerFile < 1) {
    throw new Error("Pages per output must be a positive whole number.");
  }
  const source = await PDFDocument.load(await file.arrayBuffer());
  const pageCount = source.getPageCount();
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const base = safeName(file.name.replace(/\.pdf$/i, "") || "document");
  for (let start = 0; start < pageCount; start += pagesPerFile) {
    const indices = Array.from({ length: Math.min(pagesPerFile, pageCount - start) }, (_, index) => start + index);
    const output = await PDFDocument.create();
    const pages = await output.copyPages(source, indices);
    pages.forEach((page) => output.addPage(page));
    const bytes = await output.save();
    zip.file(`${base}-pages-${start + 1}-${start + indices.length}.pdf`, bytes);
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export async function rotatePdf(file, indices, angle) {
  const document = await PDFDocument.load(await file.arrayBuffer());
  const pages = document.getPages();
  for (const index of indices) {
    const current = pages[index].getRotation().angle;
    pages[index].setRotation(degrees((current + angle + 360) % 360));
  }
  return document.save();
}

export async function reorderPdf(file, order) {
  const source = await PDFDocument.load(await file.arrayBuffer());
  if (order.length !== source.getPageCount() || new Set(order).size !== order.length || order.some((page) => page < 0 || page >= source.getPageCount())) {
    throw new Error("The page order is invalid. Refresh and try again.");
  }
  const output = await PDFDocument.create();
  const pages = await output.copyPages(source, order);
  pages.forEach((page) => output.addPage(page));
  return output.save();
}

export async function duplicatePdfPages(file, indices) {
  const source = await PDFDocument.load(await file.arrayBuffer());
  const output = await PDFDocument.create();
  const allPages = [...source.getPageIndices()];
  const wanted = new Set(indices);
  const order = allPages.flatMap((index) => wanted.has(index) ? [index, index] : [index]);
  const pages = await output.copyPages(source, order);
  pages.forEach((page) => output.addPage(page));
  return output.save();
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read image "${file.name}".`));
    };
    image.src = url;
  });
}

export async function imagesToPdf(files) {
  if (!files.length) throw new Error("Choose one or more JPG, PNG, or WEBP images.");
  const output = await PDFDocument.create();
  for (const file of files) {
    const image = await loadImage(file);
    let imageBytes = normalizedBytes(new Uint8Array(await file.arrayBuffer()));
    let embedded;
    const mime = file.type.toLowerCase();
    if (mime === "image/jpeg" || /\.jpe?g$/i.test(file.name)) {
      embedded = await output.embedJpg(imageBytes);
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d").drawImage(image, 0, 0);
      const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!pngBlob) throw new Error(`Could not convert "${file.name}" to PNG.`);
      imageBytes = new Uint8Array(await pngBlob.arrayBuffer());
      embedded = await output.embedPng(imageBytes);
      canvas.width = 0;
      canvas.height = 0;
    }
    const maxWidth = 595.28;
    const maxHeight = 841.89;
    const scale = Math.min(maxWidth / embedded.width, maxHeight / embedded.height, 1);
    const width = embedded.width * scale;
    const height = embedded.height * scale;
    const page = output.addPage([maxWidth, maxHeight]);
    page.drawImage(embedded, { x: (maxWidth - width) / 2, y: (maxHeight - height) / 2, width, height });
  }
  return output.save();
}
