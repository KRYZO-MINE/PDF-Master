import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { safeName } from "./file-manager.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export async function renderPdfPage(pdf, pageNumber, scale = 1.4) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: context, canvas, viewport }).promise;
  return { canvas, page, viewport };
}

export async function openPdfForRendering(file) {
  const buffer = await file.arrayBuffer();
  return pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    cMapUrl: "/libraries/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/libraries/pdfjs/standard_fonts/"
  }).promise;
}

export async function pdfToImages(file, format = "image/png", scale = 1.5) {
  const document = await openPdfForRendering(file);
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const extension = format === "image/jpeg" ? "jpg" : "png";
  const base = safeName(file.name.replace(/\.pdf$/i, "") || "document");
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const { canvas } = await renderPdfPage(document, pageNumber, scale);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, format, 0.92));
    if (!blob) throw new Error(`Could not encode page ${pageNumber} as an image.`);
    zip.file(`${base}-page-${pageNumber}.${extension}`, blob);
    canvas.width = 0;
    canvas.height = 0;
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export async function getPdfInformation(file) {
  const document = await openPdfForRendering(file);
  const metadata = await document.getMetadata();
  const firstPage = await document.getPage(1);
  const size = firstPage.getViewport({ scale: 1 });
  return {
    pages: document.numPages,
    width: size.width,
    height: size.height,
    title: metadata.info.Title || "Not set",
    author: metadata.info.Author || "Not set",
    subject: metadata.info.Subject || "Not set",
    creator: metadata.info.Creator || "Not set",
    producer: metadata.info.Producer || "Not set",
    creationDate: metadata.info.CreationDate || "Not available",
    modificationDate: metadata.info.ModDate || "Not available",
    version: metadata.info.PDFFormatVersion || "Unknown"
  };
}
