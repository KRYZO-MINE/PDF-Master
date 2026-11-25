import "../css/style.css";
import { getRoute, listenToRoutes, navigate } from "./router.js";
import { addRecent, getFavorites, getRecent, toggleFavorite } from "./storage.js";
import { escapeHtml, formatBytes, isImage, isPdf, saveBytes } from "./file-manager.js";
import { initializeAds } from "./ads.js";

const tools = [
  { id: "merge", title: "Merge PDF", group: "Organize PDF", icon: "⊕", description: "Combine multiple PDFs into one document.", files: "pdf-multiple" },
  { id: "split", title: "Split PDF", group: "Organize PDF", icon: "⫶", description: "Split a PDF into page groups or individual files.", files: "pdf-single" },
  { id: "extract", title: "Extract PDF pages", group: "Organize PDF", icon: "▣", description: "Save selected pages as a new PDF.", files: "pdf-single" },
  { id: "delete", title: "Delete PDF pages", group: "Organize PDF", icon: "⊖", description: "Remove selected pages from a PDF.", files: "pdf-single" },
  { id: "rotate", title: "Rotate PDF", group: "Organize PDF", icon: "⟳", description: "Rotate selected pages or the whole document.", files: "pdf-single" },
  { id: "reorder", title: "Reorder PDF pages", group: "Organize PDF", icon: "☷", description: "Arrange pages in the order you choose.", files: "pdf-single" },
  { id: "duplicate", title: "Duplicate PDF pages", group: "Organize PDF", icon: "▤", description: "Insert copies of selected pages after each original.", files: "pdf-single" },
  { id: "images-to-pdf", title: "Images to PDF", group: "Convert PDF", icon: "▧", description: "Combine JPG, PNG, or WEBP images into a PDF.", files: "image-multiple" },
  { id: "pdf-to-images", title: "PDF to images", group: "Convert PDF", icon: "▧", description: "Export every page as a PNG or JPEG image.", files: "pdf-single" },
  { id: "info", title: "PDF information", group: "PDF details", icon: "ⓘ", description: "Inspect page dimensions and available document metadata.", files: "pdf-single" },
  { id: "viewer", title: "PDF viewer", group: "PDF details", icon: "◉", description: "Read a PDF with page navigation and zoom controls.", files: "pdf-single" },
  { id: "workspace", title: "PDF Workspace", group: "PDF details", icon: "▤", description: "Reorder, rotate, remove pages, add text and save locally.", files: "pdf-single" }
];

const container = document.querySelector("#view-container");
const sectionLabel = document.querySelector("#current-section");
const toastRegion = document.querySelector("#toast-region");
let activeTool = null;
let selectedFiles = [];
let currentRoute = "";
let verifiedPremium = false;
let themeMode = document.documentElement.dataset.theme === "dark" ? "dark" : "light";

function applyTheme(mode, { persist = true } = {}) {
  themeMode = mode === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = themeMode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeMode === "dark" ? "#111827" : "#f5f7fb");
  if (persist) {
    try {
      localStorage.setItem("pdf-master-theme", themeMode);
    } catch (error) {
      console.error("Could not save the appearance preference:", error);
      toast("Your theme changed, but this browser could not save the preference.", "error");
    }
  }
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    const selected = button.dataset.themeChoice === themeMode;
    button.setAttribute("aria-checked", String(selected));
    button.tabIndex = selected ? 0 : -1;
    button.classList.toggle("selected", selected);
  });
}

window.addEventListener("pdf-master:premium-entitlement", (event) => {
  verifiedPremium = event.detail?.active === true;
  document.documentElement.classList.toggle("premium-user", verifiedPremium);
});

const toolById = (id) => tools.find((tool) => tool.id === id);
const pdfAccept = ".pdf,application/pdf";
const imageAccept = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

if (!location.hash && new URLSearchParams(location.search).get("cloud") === "1") {
  history.replaceState(null, "", `${location.pathname}${location.search}#cloud`);
}

function toast(message, type = "success") {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  toastRegion.append(node);
  window.setTimeout(() => node.remove(), 4200);
}

function cardMarkup(tool, favorites) {
  const selected = favorites.includes(tool.id);
  return `<article class="tool-card">
    <div class="tool-card-top"><span class="tool-icon">${tool.icon}</span>
      <button class="favorite-button${selected ? " selected" : ""}" type="button" data-favorite="${tool.id}" aria-label="${selected ? "Remove from" : "Add to"} favorites" aria-pressed="${selected}">${selected ? "★" : "☆"}</button>
    </div>
    <h3>${escapeHtml(tool.title)}</h3><p>${escapeHtml(tool.description)}</p>
    <button class="card-click" type="button" data-open-tool="${tool.id}" aria-label="Open ${escapeHtml(tool.title)}"></button>
  </article>`;
}

function renderDashboard({ category = "", search = "" } = {}) {
  const favorites = getFavorites();
  const recent = getRecent().map(toolById).filter(Boolean);
  const needle = search.trim().toLowerCase();
  const visible = tools.filter((tool) => {
    const categoryMatches = !category || tool.group.toLowerCase().includes(category.toLowerCase());
    const searchMatches = !needle || `${tool.title} ${tool.group} ${tool.description}`.toLowerCase().includes(needle);
    return categoryMatches && searchMatches;
  });
  const heading = category || "All available tools";
  const isLanding = !category && !needle;
  const quickActions = ["merge", "split", "images-to-pdf", "workspace"].map(toolById).filter(Boolean);
  const recentMarkup = recent.length
    ? recent.map((tool) => `<div class="recent-row"><span class="recent-icon">${tool.icon}</span><div class="recent-copy"><strong>${escapeHtml(tool.title)}</strong><span>${escapeHtml(tool.group)}</span></div><button class="recent-open" type="button" data-open-tool="${tool.id}">Open <span aria-hidden="true">→</span></button></div>`).join("")
    : `<p class="empty-note">Your recently used tools will show up here.</p>`;
  const favoriteTools = favorites.map(toolById).filter(Boolean);
  const favoriteMarkup = favoriteTools.length
    ? favoriteTools.map((tool) => `<div class="recent-row"><span class="recent-icon favorite-icon">${tool.icon}</span><div class="recent-copy"><strong>${escapeHtml(tool.title)}</strong><span>${escapeHtml(tool.group)}</span></div><button class="recent-open" type="button" data-open-tool="${tool.id}">Open <span aria-hidden="true">→</span></button></div>`).join("")
    : `<p class="empty-note">Tap the star on any tool to keep it close.</p>`;
  container.innerHTML = `
    ${isLanding ? `<section class="dashboard-welcome">
      <div class="welcome-copy">
        <div class="eyebrow"><span class="eyebrow-mark"></span> YOUR PRIVATE PDF WORKSPACE</div>
        <h1>Get things done.<br><span>Keep it local.</span></h1>
        <p>Organize, convert, and manage documents with tools that run right here on your device.</p>
        <div class="welcome-actions">
          <button class="primary-button" type="button" data-open-tool="workspace"><span aria-hidden="true">▤</span> Open workspace</button>
          <a class="welcome-secondary" href="#tools">Explore all tools <span aria-hidden="true">→</span></a>
        </div>
        <div class="welcome-assurances"><span><i aria-hidden="true">✓</i> Local processing</span><span><i aria-hidden="true">✓</i> No file uploads</span></div>
      </div>
      <div class="welcome-art" aria-hidden="true">
        <div class="art-orbit orbit-one"></div><div class="art-orbit orbit-two"></div>
        <div class="art-sheet sheet-back"><span></span><span></span><span></span></div>
        <div class="art-sheet sheet-front"><b>PDF</b><span></span><span></span><span></span><i>↗</i></div>
        <div class="art-spark spark-one">✦</div><div class="art-spark spark-two">✦</div>
      </div>
      <div class="welcome-foot"><span><i class="local-pulse"></i> Works on this device</span><span>${tools.length} ready-to-use tools</span></div>
    </section>
    <section class="dashboard-tools quick-actions-section">
      <div class="section-heading"><div><span class="section-kicker">GET STARTED</span><h2>Jump into a task</h2><p>Popular tools, one tap away.</p></div></div>
      <div class="quick-actions">${quickActions.map((tool, index) => `<button class="quick-action" type="button" data-open-tool="${tool.id}">
        <span class="quick-action-icon quick-tone-${index}">${tool.icon}</span><span class="quick-action-copy"><strong>${escapeHtml(tool.title)}</strong><small>${escapeHtml(tool.description)}</small></span><span class="quick-action-arrow" aria-hidden="true">↗</span>
      </button>`).join("")}</div>
    </section>` : ""}
    <section class="dashboard-tools tool-catalog">
      <div class="section-heading">
        <div><span class="section-kicker">${category ? "BROWSE CATEGORY" : isLanding ? "THE TOOLKIT" : "SEARCH"}</span><h2>${category ? escapeHtml(heading) : isLanding ? "Find the right tool" : "Available tools"}</h2><p>${category ? "Focused tools for your document workflow." : "Search or browse the PDF tools available in this app."}</p></div>
        <label class="search-wrap"><span class="search-icon">⌕</span><span class="sr-only">Search PDF tools</span>
          <input id="tool-search" type="search" placeholder="Search PDF tools..." value="${escapeHtml(search)}"></label>
      </div>
      <div class="quick-grid">${visible.length ? visible.map((tool) => cardMarkup(tool, favorites)).join("") : `<div class="tool-card is-empty">No matching tools found. Try a different search.</div>`}</div>
    </section>
    ${isLanding ? `<div class="dashboard-lower-grid">
      <section class="dashboard-tools dashboard-list-panel"><div class="section-heading"><div><span class="section-kicker">PICK UP WHERE YOU LEFT OFF</span><h2>Recently used</h2></div></div>${recentMarkup}</section>
      <section class="dashboard-tools dashboard-list-panel"><div class="section-heading"><div><span class="section-kicker">SAVED BY YOU</span><h2>Your favorites</h2></div></div>${favoriteMarkup}</section>
    </div>
    <div class="privacy-banner"><span class="privacy-banner-mark" aria-hidden="true">◉</span><p><b>Your files stay on your device.</b> PDF processing happens locally. Documents are never sent to a server.</p><span class="privacy-banner-link">Private by design</span></div>` : ""}
    <div class="ad-slot" data-ad-placement="dashboard-banner" data-ad-slot-id="" aria-label="Advertisement" hidden></div>`;
  sectionLabel.textContent = category || (search ? "Search results" : "Dashboard");
  document.querySelector("#tool-search").addEventListener("input", (event) => {
    renderDashboard({ category, search: event.target.value });
    const input = document.querySelector("#tool-search");
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
  container.onclick = (event) => {
    const favorite = event.target.closest("[data-favorite]");
    if (favorite) {
      toggleFavorite(favorite.dataset.favorite);
      renderDashboard({ category, search });
      return;
    }
    const open = event.target.closest("[data-open-tool]");
    if (open) navigate(open.dataset.openTool === "workspace" ? "workspace" : `tools/${open.dataset.openTool}`);
  };
}

const premiumPlans = [
  { id: "monthly", name: "Monthly", price: "₹59", period: "per month", detail: "Auto-renews monthly" },
  { id: "quarterly", name: "3 months", price: "₹149", period: "every 3 months", detail: "About ₹50 per month", saving: "Save 16%" },
  { id: "yearly", name: "Yearly", price: "₹499", period: "per year", detail: "About ₹42 per month", saving: "Save 30%", featured: true },
  { id: "lifetime", name: "Lifetime", price: "₹1,499", period: "one-time", detail: "One payment, lifetime access" }
];

function renderPremium() {
  container.innerHTML = `<section class="premium-page">
    <div class="premium-hero">
      <div class="premium-hero-copy">
        <div class="eyebrow"><span class="eyebrow-mark"></span> PDF MASTER PLUS</div>
        <h1>A better way to<br><span>work with PDFs.</span></h1>
        <p>Explore suggested launch pricing for PDF MASTER Plus. Plans and cloud storage are not available yet.</p>
        <div class="premium-checkout-note"><span aria-hidden="true">i</span><span><b>Cashfree checkout is not connected.</b> These are indicative prices only; no payment can be made from this version.</span></div>
      </div>
      <div class="premium-hero-visual" aria-hidden="true"><div class="premium-glow"></div><div class="premium-ticket"><span>PLUS</span><strong>✦</strong><small>PDF MASTER</small></div></div>
    </div>
    <section class="premium-pricing">
      <div class="premium-section-heading"><div><span class="section-kicker">SUGGESTED LAUNCH PRICING</span><h2>Choose what fits your pace</h2><p>Recommended introductory rates based on your pricing direction.</p></div><span class="pricing-indicative">Indicative · Not on sale</span></div>
      <div class="pricing-grid">${premiumPlans.map((plan) => `<article class="pricing-card${plan.featured ? " pricing-card-featured" : ""}">
        ${plan.featured ? `<span class="pricing-popular">BEST VALUE</span>` : ""}
        <div class="pricing-card-heading"><h3>${plan.name}</h3>${plan.saving ? `<span class="pricing-saving">${plan.saving}</span>` : ""}</div>
        <div class="pricing-amount">${plan.price}<span>${plan.period}</span></div>
        <p class="pricing-detail">${plan.detail}</p>
        <button class="${plan.featured ? "primary-button" : "secondary-button"} pricing-button" type="button" data-plan="${plan.id}">Choose ${plan.name}</button>
        <span class="pricing-status">Checkout setup required</span>
      </article>`).join("")}</div>
      <p class="pricing-footnote">Monthly, 3-month, and yearly plans are intended to auto-renew until canceled; lifetime is one-time. Final terms, taxes, Cashfree checkout, and subscription cancellation controls must be configured before launch.</p>
    </section>
    <section class="premium-cloud-plan">
      <div class="cloud-plan-icon" aria-hidden="true">☁</div>
      <div><span class="section-kicker">PLANNED PREMIUM BENEFIT</span><h2>1 GB personal cloud storage</h2><p>Each verified Premium account is planned to receive a 1 GB storage quota after payment is confirmed by the server. Cloud accounts, uploads, quota allocation, and file sync are not connected in this build.</p><small>Cloud storage requires an account and will upload files only when the user chooses to store them.</small></div>
      <span class="cloud-plan-status">Not active yet</span>
    </section>
    <section class="premium-next-step"><div><span class="section-kicker">NEXT STEP</span><h2>Make it ready to buy</h2><p>Cashfree requires merchant credentials and a secure server-side checkout endpoint. Secret keys must never be placed in this client-side app.</p></div><button class="secondary-button" type="button" data-plan="setup">View checkout requirements <span aria-hidden="true">→</span></button></section>
  </section>`;
  sectionLabel.textContent = "Premium";
  container.onclick = (event) => {
    const choice = event.target.closest("[data-plan]");
    if (!choice) return;
    const plan = premiumPlans.find((item) => item.id === choice.dataset.plan);
    const checkoutMessage = document.querySelector("#checkout-message");
    checkoutMessage.textContent = plan
      ? `${plan.name} at ${plan.price} ${plan.period} is an indicative price only. Cashfree checkout and Premium benefits are not active yet; no payment has been started.`
      : "Cashfree requires merchant credentials and a secure server-side checkout endpoint. Secret keys must never be placed in this client-side app. No payment has been started.";
    document.querySelector("#checkout-dialog").showModal();
  };
}

function formFields(id) {
  if (id === "split") return `<div class="field-group"><label for="pages-per-file">Pages in each output PDF</label><input id="pages-per-file" name="pagesPerFile" type="number" min="1" value="1" required><p class="field-hint">Use 1 to create one PDF per page. Output is downloaded as a ZIP.</p></div>`;
  if (["extract", "delete", "duplicate"].includes(id)) return `<div class="field-group"><label for="page-selection">Page numbers</label><input id="page-selection" name="pages" type="text" placeholder="Example: 1, 3-5" required><p class="field-hint">Page numbers start at 1. Ranges are inclusive.</p></div>`;
  if (id === "rotate") return `<div class="options-grid"><div class="field-group"><label for="page-selection">Pages (optional)</label><input id="page-selection" name="pages" type="text" placeholder="All pages"></div><div class="field-group"><label for="rotation-angle">Rotation</label><select id="rotation-angle" name="angle"><option value="90">90° clockwise</option><option value="180">180°</option><option value="270">90° counter-clockwise</option></select></div></div><p class="field-hint">Leave pages blank to rotate every page.</p>`;
  if (id === "reorder") return `<div class="field-group"><label for="page-order">New page order</label><input id="page-order" name="order" type="text" placeholder="Example: 3, 1, 2" required><p class="field-hint">Enter every page number exactly once. The current page count is shown after selection.</p></div>`;
  if (id === "pdf-to-images") return `<div class="options-grid"><div class="field-group"><label for="image-format">Image format</label><select id="image-format" name="format"><option value="image/png">PNG</option><option value="image/jpeg">JPEG</option></select></div><div class="field-group"><label for="image-scale">Resolution</label><select id="image-scale" name="scale"><option value="1">Standard</option><option value="1.5" selected>High</option><option value="2">Very high</option></select></div></div><p class="field-hint">Each PDF page becomes an image inside a ZIP archive.</p>`;
  return "";
}

function renderFileRows(files) {
  const list = container.querySelector("#file-list");
  list.innerHTML = files.map((file, index) => `<div class="file-row"><span class="file-type">${isPdf(file) ? "PDF" : "IMG"}</span><div class="file-details"><strong>${escapeHtml(file.name)}</strong><span>${formatBytes(file.size)}</span></div><button class="file-remove" type="button" data-remove-file="${index}" aria-label="Remove ${escapeHtml(file.name)}">×</button></div>`).join("");
}

function renderTool(tool) {
  activeTool = tool;
  selectedFiles = [];
  addRecent(tool.id);
  const accept = tool.files.startsWith("image") ? imageAccept : pdfAccept;
  const multiple = tool.files.endsWith("multiple") ? "multiple" : "";
  const hint = tool.files.startsWith("image") ? "JPG, PNG, and WEBP files" : "PDF documents";
  const countHint = tool.files.endsWith("multiple") ? "You can select multiple files." : "Choose one PDF file.";
  container.innerHTML = `
    <div class="tool-page-header"><div><div class="eyebrow"><span class="eyebrow-mark"></span>${escapeHtml(tool.group)}</div><h1>${escapeHtml(tool.title)}</h1><p>${escapeHtml(tool.description)}</p></div><button class="secondary-button" type="button" data-back>← All tools</button></div>
    <div class="tool-layout">
      <section class="panel tool-panel"><h2 class="panel-title">Choose your files</h2><p class="panel-subtitle">Files remain on this device and are never uploaded.</p>
        <div class="dropzone" id="dropzone"><div><div class="drop-icon">⇧</div><h3>Drop your files here</h3><p>${hint} · ${countHint}</p>
          <button class="secondary-button" id="choose-files" type="button">Browse files</button><input id="file-input" class="file-input" type="file" accept="${accept}" ${multiple}></div></div>
        <div id="file-list" class="file-list"></div>
        <form id="tool-form">${formFields(tool.id)}
          <div class="progress-wrap" id="progress-wrap" role="status" aria-live="polite" aria-busy="false" hidden>
            <span class="processing-spinner" aria-hidden="true"></span>
            <div class="processing-progress-copy"><strong id="progress-label"></strong><span>Files stay on this device while the operation runs.</span></div>
            <ol class="processing-steps" aria-hidden="true">
              <li data-progress-step="prepare">Prepare</li><li data-progress-step="process">Process</li><li data-progress-step="export">Export</li>
            </ol>
          </div>
          <div class="action-row"><button class="primary-button" type="submit">${tool.id === "info" ? "Read PDF details" : tool.id === "viewer" ? "Open PDF" : "Process locally"}</button><button class="secondary-button" type="button" data-clear>Clear files</button></div>
        </form>
        <div id="tool-result"></div>
      </section>
      <aside class="panel tool-aside"><h2 class="aside-label">Good to know</h2>
        <div class="aside-note"><span class="note-symbol">✓</span><span>Processing happens locally on your device.</span></div>
        <div class="aside-note"><span class="note-symbol">↗</span><span>Output is generated in your browser and downloaded directly.</span></div>
        <div class="aside-note"><span class="note-symbol">!</span><span>Encrypted or damaged PDFs may not be supported by this operation.</span></div>
        <div class="aside-note"><span class="note-symbol">⌑</span><span>Large documents need enough available device memory.</span></div>
      </aside>
    </div>`;
  sectionLabel.textContent = tool.title;
  const fileInput = container.querySelector("#file-input");
  const dropzone = container.querySelector("#dropzone");
  const updateFiles = (files) => {
    const valid = files.filter((file) => tool.files.startsWith("image") ? isImage(file) : isPdf(file));
    if (valid.length !== files.length) toast(`Choose ${hint.toLowerCase()} only.`, "error");
    const combined = tool.files.endsWith("multiple") ? [...selectedFiles, ...valid] : valid.slice(0, 1);
    selectedFiles = combined.filter((file, index, list) => list.findIndex((other) => other.name === file.name && other.size === file.size && other.lastModified === file.lastModified) === index);
    renderFileRows(selectedFiles);
    if (tool.id === "reorder" && selectedFiles.length) {
      import("./pdf-renderer.js").then(({ openPdfForRendering }) => openPdfForRendering(selectedFiles[0])).then((pdf) => {
        const orderInput = container.querySelector("#page-order");
        orderInput.placeholder = `Example: ${Array.from({ length: Math.min(pdf.numPages, 3) }, (_, index) => pdf.numPages - index).join(", ")}${pdf.numPages > 3 ? ", ..." : ""} (${pdf.numPages} pages)`;
      }).catch((error) => toast(error.message, "error"));
    }
  };
  fileInput.addEventListener("change", () => updateFiles([...fileInput.files]));
  container.querySelector("#choose-files").addEventListener("click", () => fileInput.click());
  for (const eventName of ["dragenter", "dragover"]) dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("drag-over");
  });
  for (const eventName of ["dragleave", "drop"]) dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("drag-over");
  });
  dropzone.addEventListener("drop", (event) => updateFiles([...event.dataTransfer.files]));
  container.querySelector("#file-list").addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-file]");
    if (remove) {
      selectedFiles.splice(Number(remove.dataset.removeFile), 1);
      renderFileRows(selectedFiles);
    }
  });
  container.querySelector("[data-clear]").addEventListener("click", () => {
    selectedFiles = [];
    fileInput.value = "";
    renderFileRows(selectedFiles);
    container.querySelector("#tool-result").replaceChildren();
    container.querySelector("#progress-wrap").hidden = true;
    container.querySelector("#progress-wrap").setAttribute("aria-busy", "false");
  });
  container.querySelector("[data-back]").addEventListener("click", () => navigate("tools"));
  container.querySelector("#tool-form").addEventListener("submit", (event) => {
    event.preventDefault();
    executeTool(tool);
  });
}

async function executeTool(tool) {
  if (!selectedFiles.length) {
    toast("Choose a file before continuing.", "error");
    return;
  }
  if (tool.files === "pdf-multiple" && selectedFiles.length < 2) {
    toast("Choose at least two PDFs to merge.", "error");
    return;
  }
  const form = container.querySelector("#tool-form");
  if (!form.reportValidity()) return;
  const button = form.querySelector('[type="submit"]');
  const idleLabel = button.textContent;
  const progress = container.querySelector("#progress-wrap");
  const status = container.querySelector("#progress-label");
  const result = container.querySelector("#tool-result");
  const setProgress = (stage, message, busy = true) => {
    progress.dataset.stage = stage;
    progress.dataset.premium = String(verifiedPremium);
    progress.setAttribute("aria-busy", String(busy));
    status.textContent = message;
    const activeStep = ["prepare", "process", "export"].indexOf(stage);
    progress.querySelectorAll("[data-progress-step]").forEach((step, index) => {
      step.classList.toggle("is-complete", activeStep > index || stage === "complete");
      step.classList.toggle("is-active", activeStep === index);
    });
  };
  button.disabled = true;
  button.dataset.processing = "true";
  button.setAttribute("aria-busy", "true");
  button.textContent = "Working locally…";
  progress.hidden = false;
  setProgress("prepare", "Preparing local tools…");
  result.replaceChildren();
  try {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    setProgress("process", "Processing your file on this device…");
    const values = Object.fromEntries(new FormData(form).entries());
    let response;
    if (tool.id === "merge") {
      response = await (await import("./tools/merge.js")).runMerge(selectedFiles);
    } else if (tool.id === "split") {
      const { openPdfForRendering } = await import("./pdf-renderer.js");
      const count = Number((await openPdfForRendering(selectedFiles[0])).numPages);
      const pagesPerFile = Number(values.pagesPerFile);
      if (!Number.isInteger(pagesPerFile) || pagesPerFile < 1) throw new Error("Pages per output must be a positive whole number.");
      response = await (await import("./tools/split.js")).runSplit(selectedFiles[0], pagesPerFile);
    } else if (["extract", "delete", "rotate", "reorder", "duplicate"].includes(tool.id)) {
      const { openPdfForRendering } = await import("./pdf-renderer.js");
      const pageCount = (await openPdfForRendering(selectedFiles[0])).numPages;
      response = await (await import("./tools/organize.js")).runOrganizeTool(tool.id, selectedFiles[0], { ...values, pageCount });
    } else if (["images-to-pdf", "pdf-to-images"].includes(tool.id)) {
      response = await (await import("./tools/convert.js")).runConvertTool(tool.id, selectedFiles, values);
    } else if (tool.id === "info") {
      const { getPdfInformation } = await import("./pdf-renderer.js");
      const info = await getPdfInformation(selectedFiles[0]);
      result.innerHTML = `<section class="panel viewer-panel"><h2 class="panel-title">Document information</h2><p class="panel-subtitle">${escapeHtml(selectedFiles[0].name)} · ${formatBytes(selectedFiles[0].size)}</p><div class="info-grid">
        ${[["Pages", info.pages], ["Page size", `${info.width.toFixed(1)} × ${info.height.toFixed(1)} pt`], ["PDF version", info.version], ["Title", info.title], ["Author", info.author], ["Subject", info.subject], ["Creator", info.creator], ["Producer", info.producer], ["Created", info.creationDate], ["Modified", info.modificationDate]].map(([label, value]) => `<div class="info-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}
        </div></section>`;
      status.textContent = "Information read locally.";
    } else if (tool.id === "viewer") {
      const { renderPdfViewer } = await import("./pdf-viewer.js");
      await renderPdfViewer(result, selectedFiles[0]);
      status.textContent = "PDF opened locally.";
    }
    if (response) {
      setProgress("export", "Preparing your download…");
      saveBytes(response.bytes, response.filename, response.type);
      setProgress("complete", "Done. Your download has started.", false);
      toast("Your file is ready to download.", "success");
    } else {
      setProgress("complete", tool.id === "info" ? "Information is ready." : "PDF is open and ready.", false);
      toast(tool.id === "info" ? "PDF information loaded." : "PDF opened in the viewer.", "success");
    }
  } catch (error) {
    console.error(`PDF MASTER ${tool.id} failed:`, error);
    setProgress("error", "Could not complete this operation.", false);
    toast(error.message || "The PDF could not be processed. Check that the file is valid and try again.", "error");
  } finally {
    button.disabled = false;
    delete button.dataset.processing;
    button.setAttribute("aria-busy", "false");
    button.textContent = idleLabel;
  }
}

function renderToolsList(category) {
  renderDashboard({ category });
  sectionLabel.textContent = category || "All tools";
}

function renderAbout() {
  container.innerHTML = `<section class="hero"><div class="hero-copy"><div class="eyebrow"><span class="eyebrow-mark"></span> PRIVATE DOCUMENT TOOLS</div><h1>Every PDF Tool. <span>One Place.</span></h1><p>Local tools process documents on this device. My Cloud is optional and uploads only the files you select.</p></div></section>
    <section class="dashboard-tools"><div class="section-heading"><div><h2>Privacy & limitations</h2><p>What this version does and does not do.</p></div></div>
      <div class="panel tool-panel"><div class="aside-note">PDF processing and downloads stay local unless you explicitly upload a file in My Cloud.</div><div class="aside-note">My Cloud is optional: files selected there are uploaded to a private Supabase bucket and require Google sign-in, an active verified Premium entitlement, and an internet connection.</div><div class="aside-note">The app shell and PDF processing libraries are bundled locally and cached by the service worker after its first successful load.</div><div class="aside-note">Password-protected PDF editing, compression, repair, redaction and several advanced editing operations are not included in this release.</div><div class="aside-note">No advertisements are loaded in this build. An ad provider and publisher configuration are required before any ad slot is enabled.</div></div>
    </section>`;
  sectionLabel.textContent = "About";
}

function renderSettings() {
  container.innerHTML = `<section class="settings-page">
    <header class="settings-heading"><span class="section-kicker">PREFERENCES</span><h1>Settings</h1><p>Make PDF MASTER feel right for you. Your appearance choice is saved on this device.</p></header>
    <section class="settings-card" aria-labelledby="appearance-heading">
      <div class="settings-card-copy"><span class="settings-icon" aria-hidden="true">◐</span><div><h2 id="appearance-heading">Appearance</h2><p>Choose the theme used across the dashboard and PDF tools.</p></div></div>
      <div class="theme-options" role="radiogroup" aria-label="Color theme">
        <button class="theme-option" type="button" role="radio" data-theme-choice="light" aria-checked="false"><span class="theme-preview theme-preview-light" aria-hidden="true"><i></i><i></i><i></i></span><span><strong>Light</strong><small>Bright and clean</small></span><span class="theme-check" aria-hidden="true">✓</span></button>
        <button class="theme-option" type="button" role="radio" data-theme-choice="dark" aria-checked="false"><span class="theme-preview theme-preview-dark" aria-hidden="true"><i></i><i></i><i></i></span><span><strong>Dark</strong><small>Comfortable in low light</small></span><span class="theme-check" aria-hidden="true">✓</span></button>
      </div>
    </section>
    <div class="settings-note"><span aria-hidden="true">ⓘ</span><p>This preference is stored locally in your browser and works offline. It does not change how your PDF files are processed.</p></div>
  </section>`;
  sectionLabel.textContent = "Settings";
  container.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.addEventListener("click", () => applyTheme(button.dataset.themeChoice));
  });
  container.querySelector(".theme-options").addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...container.querySelectorAll("[data-theme-choice]")];
    const next = event.key === "Home" ? buttons[0]
      : event.key === "End" ? buttons[buttons.length - 1]
        : buttons.find((button) => button.dataset.themeChoice !== themeMode);
    applyTheme(next.dataset.themeChoice);
    next.focus();
  });
  applyTheme(themeMode, { persist: false });
}

function updateNavigation(route) {
  document.querySelectorAll("[data-nav]").forEach((link) => {
    const active = route.section === "home" ? link.dataset.nav === "home"
      : route.section === "workspace" ? link.dataset.nav === "workspace"
        : route.section === "tools" ? link.dataset.nav === "tools"
        : route.section === "cloud" ? link.dataset.nav === "cloud"
            : route.section === "premium" ? link.dataset.nav === "premium"
              : route.section === "settings" ? link.dataset.nav === "settings" : false;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function renderRoute() {
  const route = getRoute();
  const routeKey = `${route.section}/${route.category || ""}`;
  if (currentRoute === routeKey && route.section === "home") return;
  currentRoute = routeKey;
  updateNavigation(route);
  if (route.section === "home") renderDashboard();
  else if (route.section === "workspace") {
    sectionLabel.textContent = "PDF Workspace";
    import("./pdf-workspace.js").then(({ renderWorkspace }) => {
      if (currentRoute === routeKey) renderWorkspace(container, toast);
    }).catch((error) => {
      console.error("Could not load the PDF workspace:", error);
      toast("The PDF workspace could not be loaded.", "error");
    });
  } else if (route.section === "tools" && toolById(route.category)) {
    renderTool(toolById(route.category));
  } else if (route.section === "tools" && ["organize", "convert", "other"].includes(route.category)) {
    const group = { organize: "Organize PDF", convert: "Convert PDF", other: "PDF details" }[route.category];
    renderToolsList(group);
  } else if (route.section === "tools") renderToolsList("");
  else if (route.section === "cloud") {
    sectionLabel.textContent = "My Cloud";
    import("./cloud-page.js").then(({ renderCloudPage }) => {
      if (currentRoute === routeKey) renderCloudPage(container, toast);
    }).catch((error) => {
      console.error("Could not load cloud storage:", error);
      toast("Cloud storage could not be loaded.", "error");
    });
  }
  else if (route.section === "premium") renderPremium();
  else if (route.section === "about") renderAbout();
  else if (route.section === "settings") renderSettings();
  else renderDashboard();
}

document.querySelector("#menu-toggle").addEventListener("click", () => {
  document.querySelector("#sidebar").classList.add("open");
  document.querySelector("#sidebar-scrim").classList.add("visible");
});
document.querySelector("#sidebar-scrim").addEventListener("click", () => {
  document.querySelector("#sidebar").classList.remove("open");
  document.querySelector("#sidebar-scrim").classList.remove("visible");
});
document.querySelector("#sidebar").addEventListener("click", (event) => {
  if (event.target.closest("a")) {
    document.querySelector("#sidebar").classList.remove("open");
    document.querySelector("#sidebar-scrim").classList.remove("visible");
  }
});
document.querySelector(".side-link").addEventListener("click", (event) => {
  event.preventDefault();
  navigate("about");
});

listenToRoutes(renderRoute);
initializeAds();

let installPrompt;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  document.querySelector("#install-button").hidden = false;
});
document.querySelector("#install-button").addEventListener("click", async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  installPrompt = null;
  document.querySelector("#install-button").hidden = true;
});

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch((error) => {
      console.error("Service worker registration failed:", error);
      toast("Offline caching could not be started in this browser.", "error");
    });
  });
}
