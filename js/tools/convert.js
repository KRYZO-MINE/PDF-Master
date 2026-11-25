import { imagesToPdf } from "../pdf-engine.js";

export async function runConvertTool(id, files, options) {
  if (id === "images-to-pdf") {
    return { bytes: await imagesToPdf(files), filename: "images-to-pdf.pdf" };
  }
  if (id === "pdf-to-images") {
    const { pdfToImages } = await import("../pdf-renderer.js");
    const bytes = await pdfToImages(files[0], options.format, Number(options.scale));
    return { bytes, filename: `${files[0].name.replace(/\.pdf$/i, "")}-images.zip`, type: "application/zip" };
  }
  throw new Error("This conversion is not available.");
}
