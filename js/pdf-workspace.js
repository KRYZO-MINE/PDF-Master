import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { escapeHtml, formatBytes, isPdf, saveBytes } from "./file-manager.js";
import { openPdfForRendering } from "./pdf-renderer.js";

const clone = (value) => structuredClone(value);

export async function renderWorkspace(container, notify) {
  container.innerHTML = `<div class="tool-page-header"><div><div class="eyebrow"><span class="eyebrow-mark"></span> LOCAL PDF EDITOR</div><h1>PDF Workspace</h1><p>Arrange pages, add text or marks, and save an updated PDF on this device.</p></div></div>
    <section class="panel workspace-open panel-tool"><div class="workspace-empty"><div><div class="drop-icon">▤</div><h2 class="panel-title">Open a PDF to get started</h2><p class="panel-subtitle">Your document stays in your browser and is not uploaded.</p><button class="primary-button" type="button" data-workspace-open>Choose a PDF</button><input class="file-input" type="file" accept=".pdf,application/pdf" data-workspace-file></div></div></section>`;
  const fileInput = container.querySelector("[data-workspace-file]");
  container.querySelector("[data-workspace-open]").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const [file] = fileInput.files;
    if (file) loadWorkspace(container, file, notify);
  });
  const openPanel = container.querySelector(".workspace-open");
  openPanel.addEventListener("dragover", (event) => {
    event.preventDefault();
    openPanel.classList.add("drag-over");
  });
  openPanel.addEventListener("dragleave", () => openPanel.classList.remove("drag-over"));
  openPanel.addEventListener("drop", (event) => {
    event.preventDefault();
    openPanel.classList.remove("drag-over");
    const [file] = [...event.dataTransfer.files].filter(isPdf);
    if (!file) {
      notify("Choose a PDF file to open the workspace.", "error");
      return;
    }
    loadWorkspace(container, file, notify);
  });
}

async function loadWorkspace(container, file, notify) {
  try {
    const pdf = await openPdfForRendering(file);
    const initialOrder = Array.from({ length: pdf.numPages }, (_, index) => index);
    const state = {
      order: initialOrder,
      rotations: {},
      annotations: {},
      currentPage: 0,
      zoom: 1.1,
      mode: "",
      pendingImage: null,
      undo: [],
      redo: []
    };

    container.innerHTML = `<div class="tool-page-header"><div><div class="eyebrow"><span class="eyebrow-mark"></span> LOCAL PDF EDITOR</div><h1>PDF Workspace</h1><p>${escapeHtml(file.name)} · ${formatBytes(file.size)} · ${pdf.numPages} pages</p></div><button class="secondary-button" type="button" data-workspace-reopen>Open another PDF</button></div>
      <div class="workspace-layout">
        <aside class="panel workspace-thumbnails" data-thumbnails aria-label="PDF pages"></aside>
        <section class="panel workspace-main">
          <div class="workspace-toolbar">
            <button type="button" data-action="undo" aria-label="Undo">↶ Undo</button><button type="button" data-action="redo" aria-label="Redo">↷ Redo</button>
            <button type="button" data-action="move-left">← Move page</button><button type="button" data-action="move-right">Move page →</button>
            <button type="button" data-action="rotate">⟳ Rotate</button><button type="button" data-action="delete">− Delete page</button>
            <button type="button" data-action="zoom-out">− Zoom</button><button type="button" data-action="zoom-in">+ Zoom</button>
            <button type="button" data-action="text">T Add text</button><input class="workspace-text-input" type="text" maxlength="160" placeholder="Text to place" aria-label="Text to place">
            <button type="button" data-action="rectangle">▭ Rectangle</button><button type="button" data-action="draw">✎ Draw</button>
            <label class="workspace-file-button">Add image<input type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" data-image-input></label>
            <button type="button" data-action="image">Place image</button><button type="button" data-action="signature">Place signature</button>
            <button class="primary-button" type="button" data-action="save">Save PDF</button>
          </div>
          <div class="workspace-save-status" data-save-status role="status" aria-live="polite"></div>
          <p class="workspace-hint" data-workspace-hint>Drag thumbnails to reorder pages. Add text, shapes, images, signatures, or freehand marks by choosing a tool and clicking or drawing on the page.</p>
          <div class="workspace-stage" data-stage><span>Rendering page…</span></div>
        </section>
      </div>`;

    const thumbnails = container.querySelector("[data-thumbnails]");
    const stage = container.querySelector("[data-stage]");
    const hint = container.querySelector("[data-workspace-hint]");
    const textInput = container.querySelector(".workspace-text-input");
    const imageInput = container.querySelector("[data-image-input]");
    let activeCanvas = null;
    let activeOverlay = null;
    let drawing = false;
    let activeStroke = [];

    const snapshot = () => ({
      order: [...state.order],
      rotations: { ...state.rotations },
      annotations: clone(state.annotations),
      currentPage: state.currentPage
    });
    const record = () => {
      state.undo.push(snapshot());
      if (state.undo.length > 30) state.undo.shift();
      state.redo.length = 0;
    };
    const restore = (saved) => {
      state.order = [...saved.order];
      state.rotations = { ...saved.rotations };
      state.annotations = clone(saved.annotations);
      state.currentPage = saved.currentPage;
    };
    const currentIndex = () => state.order[state.currentPage];
    const setMode = (mode) => {
      state.mode = state.mode === mode ? "" : mode;
      hint.textContent = state.mode === "draw" ? "Draw on the page with your pointer or finger. Choose Draw again to stop."
        : state.mode === "text" ? "Click on the page to place the text from the field."
          : state.mode === "rectangle" ? "Click on the page to place a rectangle outline."
            : state.mode === "image" ? "Click on the page to place the selected image."
              : state.mode === "signature" ? "Click on the page to place the selected signature image."
                : "Drag thumbnails to reorder pages. Add text, shapes, images, signatures, or freehand marks by choosing a tool and clicking or drawing on the page.";
      activeOverlay?.classList.toggle("workspace-draw-cursor", state.mode === "draw");
    };

    const paintAnnotations = async (overlay, pageIndex) => {
      const context = overlay.getContext("2d");
      const annotations = state.annotations[pageIndex] || [];
      for (const item of annotations) {
        if (item.type === "text") {
          context.fillStyle = item.color || "#d94b2b";
          context.font = `${Math.max(14, overlay.width * 0.025)}px sans-serif`;
          context.fillText(item.text, item.x * overlay.width, item.y * overlay.height);
        } else if (item.type === "rectangle") {
          context.strokeStyle = "#ef5337";
          context.lineWidth = Math.max(2, overlay.width * 0.003);
          context.strokeRect(item.x * overlay.width, item.y * overlay.height, item.width * overlay.width, item.height * overlay.height);
        } else if (item.type === "stroke") {
          context.strokeStyle = "#ef5337";
          context.lineWidth = Math.max(2, overlay.width * 0.003);
          context.lineCap = "round";
          context.beginPath();
          item.points.forEach((point, index) => {
            const x = point.x * overlay.width;
            const y = point.y * overlay.height;
            if (index === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
          });
          context.stroke();
        } else if (item.type === "image") {
          const image = new Image();
          await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(new Error("Could not display the selected image."));
            image.src = item.data;
          });
          context.drawImage(image, item.x * overlay.width, item.y * overlay.height, item.width * overlay.width, item.height * overlay.height);
        }
      }
    };

    const drawCurrent = async () => {
      if (!state.order.length) {
        stage.innerHTML = `<div class="workspace-empty"><p>There are no pages left. Undo a delete or open another PDF.</p></div>`;
        return;
      }
      state.currentPage = Math.max(0, Math.min(state.currentPage, state.order.length - 1));
      const pageIndex = currentIndex();
      const page = await pdf.getPage(pageIndex + 1);
      const rotation = (page.rotate + (state.rotations[pageIndex] || 0)) % 360;
      const viewport = page.getViewport({ scale: state.zoom, rotation });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { alpha: false });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: context, canvas, viewport }).promise;
      const overlay = document.createElement("canvas");
      overlay.width = canvas.width;
      overlay.height = canvas.height;
      await paintAnnotations(overlay, pageIndex);
      const layer = document.createElement("div");
      layer.className = "workspace-page-layer";
      layer.append(canvas, overlay);
      stage.replaceChildren(layer);
      activeCanvas = canvas;
      activeOverlay = overlay;
      overlay.classList.toggle("workspace-draw-cursor", state.mode === "draw");
      thumbnails.querySelectorAll(".workspace-thumb").forEach((thumb, index) => {
        thumb.classList.toggle("selected", index === state.currentPage);
        thumb.setAttribute("aria-current", index === state.currentPage ? "page" : "false");
      });
    };

    const drawThumbnails = async () => {
      thumbnails.replaceChildren();
      for (const [position, pageIndex] of state.order.entries()) {
        const thumb = document.createElement("button");
        thumb.type = "button";
        thumb.className = `workspace-thumb${position === state.currentPage ? " selected" : ""}`;
        thumb.draggable = true;
        thumb.dataset.pageIndex = String(pageIndex);
        thumb.dataset.position = String(position);
        thumb.setAttribute("aria-label", `Page ${position + 1}`);
        const canvas = document.createElement("canvas");
        const page = await pdf.getPage(pageIndex + 1);
        const rotation = (page.rotate + (state.rotations[pageIndex] || 0)) % 360;
        const viewport = page.getViewport({ scale: Math.min(115 / page.view[2], 150 / page.view[3]), rotation });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext("2d", { alpha: false }), canvas, viewport }).promise;
        const number = document.createElement("span");
        number.textContent = `Page ${position + 1}`;
        thumb.append(canvas, number);
        thumb.addEventListener("click", () => {
          state.currentPage = Number(thumb.dataset.position);
          drawCurrent();
        });
        thumb.addEventListener("dragstart", (event) => {
          event.dataTransfer.setData("text/plain", thumb.dataset.position);
          event.dataTransfer.effectAllowed = "move";
        });
        thumb.addEventListener("dragover", (event) => event.preventDefault());
        thumb.addEventListener("drop", (event) => {
          event.preventDefault();
          const from = Number(event.dataTransfer.getData("text/plain"));
          const to = Number(thumb.dataset.position);
          if (from === to || !Number.isInteger(from)) return;
          record();
          const [moved] = state.order.splice(from, 1);
          state.order.splice(to, 0, moved);
          state.currentPage = to;
          drawThumbnails();
          drawCurrent();
        });
        thumbnails.append(thumb);
      }
    };

    const toRelativePoint = (event) => {
      const rect = activeOverlay.getBoundingClientRect();
      return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
    };
    const addAnnotation = (annotation) => {
      record();
      const pageIndex = currentIndex();
      state.annotations[pageIndex] ||= [];
      state.annotations[pageIndex].push(annotation);
      drawCurrent();
    };
    stage.addEventListener("pointerdown", (event) => {
      if (!activeOverlay || !state.mode) return;
      event.preventDefault();
      const point = toRelativePoint(event);
      if (state.mode === "draw") {
        drawing = true;
        activeStroke = [point];
        activeOverlay.setPointerCapture(event.pointerId);
      } else if (state.mode === "text") {
        const text = textInput.value.trim();
        if (!text) {
          notify("Enter text in the field before placing it.", "error");
          return;
        }
        addAnnotation({ type: "text", text, ...point });
      } else if (state.mode === "rectangle") {
        addAnnotation({ type: "rectangle", ...point, width: 0.24, height: 0.12 });
      } else if (state.mode === "image" || state.mode === "signature") {
        if (!state.pendingImage) {
          notify("Choose an image file first.", "error");
          return;
        }
        addAnnotation({ type: "image", data: state.pendingImage, ...point, width: state.mode === "signature" ? 0.22 : 0.3, height: state.mode === "signature" ? 0.1 : 0.2 });
      }
    });
    stage.addEventListener("pointermove", (event) => {
      if (!drawing || !activeOverlay) return;
      activeStroke.push(toRelativePoint(event));
      const context = activeOverlay.getContext("2d");
      const last = activeStroke.slice(-2);
      if (last.length < 2) return;
      context.strokeStyle = "#ef5337";
      context.lineWidth = Math.max(2, activeOverlay.width * 0.003);
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(last[0].x * activeOverlay.width, last[0].y * activeOverlay.height);
      context.lineTo(last[1].x * activeOverlay.width, last[1].y * activeOverlay.height);
      context.stroke();
    });
    const endStroke = () => {
      if (!drawing) return;
      drawing = false;
      if (activeStroke.length > 1) addAnnotation({ type: "stroke", points: activeStroke });
      activeStroke = [];
    };
    stage.addEventListener("pointerup", endStroke);
    stage.addEventListener("pointercancel", endStroke);

    container.querySelector("[data-workspace-reopen]").addEventListener("click", () => renderWorkspace(container, notify));
    imageInput.addEventListener("change", async () => {
      const [image] = imageInput.files;
      if (!image) return;
      if (image.size > 12 * 1024 * 1024) {
        notify("Choose an image smaller than 12 MB for the workspace.", "error");
        imageInput.value = "";
        return;
      }
      try {
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error("Could not read the selected image."));
          reader.readAsDataURL(image);
        });
        state.pendingImage = data;
        setMode("image");
        notify("Image ready. Click the page to place it.", "success");
      } catch (error) {
        console.error("Could not load workspace image:", error);
        notify(error.message, "error");
      }
    });

    container.querySelector(".workspace-toolbar").addEventListener("click", async (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      const action = button.dataset.action;
      if (action === "undo" && state.undo.length) {
        state.redo.push(snapshot());
        restore(state.undo.pop());
        await drawThumbnails();
        await drawCurrent();
      } else if (action === "redo" && state.redo.length) {
        state.undo.push(snapshot());
        restore(state.redo.pop());
        await drawThumbnails();
        await drawCurrent();
      } else if (action === "rotate") {
        record();
        const pageIndex = currentIndex();
        state.rotations[pageIndex] = ((state.rotations[pageIndex] || 0) + 90) % 360;
        await drawThumbnails();
        await drawCurrent();
      } else if (action === "move-left" || action === "move-right") {
        const destination = state.currentPage + (action === "move-left" ? -1 : 1);
        if (destination < 0 || destination >= state.order.length) return;
        record();
        const [moved] = state.order.splice(state.currentPage, 1);
        state.order.splice(destination, 0, moved);
        state.currentPage = destination;
        await drawThumbnails();
        await drawCurrent();
      } else if (action === "delete") {
        if (state.order.length <= 1) {
          notify("A PDF must contain at least one page.", "error");
          return;
        }
        record();
        state.order.splice(state.currentPage, 1);
        state.currentPage = Math.min(state.currentPage, state.order.length - 1);
        await drawThumbnails();
        await drawCurrent();
      } else if (action === "zoom-in") {
        state.zoom = Math.min(2.5, state.zoom + 0.15);
        await drawCurrent();
      } else if (action === "zoom-out") {
        state.zoom = Math.max(0.55, state.zoom - 0.15);
        await drawCurrent();
      } else if (["text", "rectangle", "draw", "image", "signature"].includes(action)) {
        if ((action === "image" || action === "signature") && !state.pendingImage) {
          notify("Choose an image file first.", "error");
          return;
        }
        setMode(action);
      } else if (action === "save") {
        button.disabled = true;
        button.dataset.processing = "true";
        button.setAttribute("aria-busy", "true");
        button.textContent = "Saving locally…";
        const saveStatus = container.querySelector("[data-save-status]");
        saveStatus.textContent = "Applying your edits and preparing the PDF…";
        try {
          const source = await PDFDocument.load(await file.arrayBuffer());
          const output = await PDFDocument.create();
          const pages = await output.copyPages(source, state.order);
          const italicFont = await output.embedFont(StandardFonts.TimesRomanItalic);
          const embeddedImages = new Map();
          for (const [position, page] of pages.entries()) {
            const originalIndex = state.order[position];
            const rotation = state.rotations[originalIndex] || 0;
            if (rotation) page.setRotation(degrees((page.getRotation().angle + rotation) % 360));
            const { width, height } = page.getSize();
            for (const item of state.annotations[originalIndex] || []) {
              const x = item.x * width;
              const yTop = item.y * height;
              if (item.type === "text") {
                page.drawText(item.text, { x, y: height - yTop - 16, size: Math.max(10, width * 0.025), font: italicFont, color: rgb(0.85, 0.2, 0.12) });
              } else if (item.type === "rectangle") {
                page.drawRectangle({ x, y: height - yTop - item.height * height, width: item.width * width, height: item.height * height, borderColor: rgb(0.92, 0.2, 0.13), borderWidth: 2, color: rgb(1, 0.5, 0.25), opacity: 0, borderOpacity: 1 });
              } else if (item.type === "stroke") {
                for (let point = 1; point < item.points.length; point += 1) {
                  const start = item.points[point - 1];
                  const end = item.points[point];
                  page.drawLine({ start: { x: start.x * width, y: height - start.y * height }, end: { x: end.x * width, y: height - end.y * height }, thickness: 2, color: rgb(0.92, 0.2, 0.13) });
                }
              } else if (item.type === "image") {
                let image = embeddedImages.get(item.data);
                if (!image) {
                  const base64 = item.data.split(",")[1];
                  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
                  image = item.data.startsWith("data:image/jpeg") ? await output.embedJpg(bytes) : await output.embedPng(bytes);
                  embeddedImages.set(item.data, image);
                }
                page.drawImage(image, { x, y: height - yTop - item.height * height, width: item.width * width, height: item.height * height });
              }
            }
          }
          saveBytes(await output.save(), `${file.name.replace(/\.pdf$/i, "")}-workspace.pdf`);
          saveStatus.textContent = "Download started. Your file was created on this device.";
          notify("Workspace PDF saved to your device.", "success");
        } catch (error) {
          console.error("Could not save workspace PDF:", error);
          saveStatus.textContent = "Could not save this PDF.";
          notify(error.message || "Could not save this PDF.", "error");
        } finally {
          button.disabled = false;
          delete button.dataset.processing;
          button.setAttribute("aria-busy", "false");
          button.textContent = "Save PDF";
        }
      }
    });

    await drawThumbnails();
    await drawCurrent();
  } catch (error) {
    console.error("Could not open PDF in workspace:", error);
    notify(error.message || "This PDF could not be opened in the workspace.", "error");
  }
}
