import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import {
  duplicatePdfPages, mergePdfs, parsePageSelection, reorderPdf, rotatePdf, selectPdfPages, splitPdf
} from "../js/pdf-engine.js";

async function sampleFile(widths, name = "sample.pdf") {
  const document = await PDFDocument.create();
  for (const [index, width] of widths.entries()) {
    const page = document.addPage([width, 100]);
    page.drawText(`page-${index + 1}`, { x: 10, y: 50 });
  }
  const bytes = await document.save();
  return {
    name,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.slice().buffer
  };
}

async function readDocument(bytes) {
  return PDFDocument.load(bytes);
}

test("page selection expands ranges, sorts and removes duplicates", () => {
  assert.deepEqual(parsePageSelection("4, 1-3, 2", 4), [0, 1, 2, 3]);
});

test("page selection rejects malformed and out-of-range values", () => {
  assert.throws(() => parsePageSelection("2-x", 4), /not a valid page/);
  assert.throws(() => parsePageSelection("1,5", 4), /between 1 and 4/);
  assert.throws(() => parsePageSelection("3-1", 4), /ascending range/);
});

test("merge and extraction create valid PDFs with expected page counts", async () => {
  const first = await sampleFile([100, 110], "first.pdf");
  const second = await sampleFile([120], "second.pdf");
  const merged = await readDocument(await mergePdfs([first, second]));
  assert.equal(merged.getPageCount(), 3);

  const extracted = await readDocument(await selectPdfPages(first, [1]));
  assert.equal(extracted.getPageCount(), 1);
  assert.equal(extracted.getPage(0).getWidth(), 110);
});

test("rotation, reordering and duplication preserve requested page sequence", async () => {
  const file = await sampleFile([100, 200, 300]);
  const rotated = await readDocument(await rotatePdf(file, [1], 90));
  assert.equal(rotated.getPage(1).getRotation().angle, 90);

  const reordered = await readDocument(await reorderPdf(file, [2, 0, 1]));
  assert.deepEqual(reordered.getPages().map((page) => page.getWidth()), [300, 100, 200]);

  const duplicated = await readDocument(await duplicatePdfPages(file, [1]));
  assert.deepEqual(duplicated.getPages().map((page) => page.getWidth()), [100, 200, 200, 300]);
});

test("split produces one valid PDF per requested page group", async () => {
  const file = await sampleFile([100, 200, 300], "report.pdf");
  const archive = await JSZip.loadAsync(await splitPdf(file, 1));
  const names = Object.keys(archive.files).filter((name) => name.endsWith(".pdf"));
  assert.equal(names.length, 3);
  for (const name of names) {
    const bytes = await archive.file(name).async("uint8array");
    const document = await readDocument(bytes);
    assert.equal(document.getPageCount(), 1);
  }
  await assert.rejects(splitPdf(file, 0), /positive whole number/);
});
