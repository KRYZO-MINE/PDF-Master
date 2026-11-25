import { openPdfForRendering, renderPdfPage } from "./pdf-renderer.js";
import { formatBytes, escapeHtml } from "./file-manager.js";

export async function renderPdfViewer(container, file) {
  container.innerHTML = `<section class="panel viewer-panel" aria-label="PDF viewer">
    <div class="viewer-toolbar">
      <div class="viewer-controls">
        <button type="button" data-viewer="previous" aria-label="Previous page">‹</button>
        <span class="viewer-page-label" data-page-label>1 / …</span>
        <button type="button" data-viewer="next" aria-label="Next page">›</button>
      </div>
      <div class="viewer-controls">
        <button type="button" data-viewer="zoom-out" aria-label="Zoom out">−</button>
        <span class="viewer-page-label" data-zoom-label>140%</span>
        <button type="button" data-viewer="zoom-in" aria-label="Zoom in">+</button>
      </div>
    </div>
    <div class="viewer-canvas-wrap" data-canvas-wrap><span>Loading ${escapeHtml(file.name)} · ${formatBytes(file.size)}</span></div>
  </section>`;

  const pdf = await openPdfForRendering(file);
  let pageNumber = 1;
  let scale = 1.4;
  const render = async () => {
    const wrap = container.querySelector("[data-canvas-wrap]");
    wrap.replaceChildren();
    const { canvas } = await renderPdfPage(pdf, pageNumber, scale);
    wrap.append(canvas);
    container.querySelector("[data-page-label]").textContent = `${pageNumber} / ${pdf.numPages}`;
    container.querySelector("[data-zoom-label]").textContent = `${Math.round(scale * 100)}%`;
  };
  container.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-viewer]");
    if (!button) return;
    const action = button.dataset.viewer;
    if (action === "previous") pageNumber = Math.max(1, pageNumber - 1);
    if (action === "next") pageNumber = Math.min(pdf.numPages, pageNumber + 1);
    if (action === "zoom-in") scale = Math.min(3, scale + 0.2);
    if (action === "zoom-out") scale = Math.max(0.5, scale - 0.2);
    await render();
  });
  await render();
}
