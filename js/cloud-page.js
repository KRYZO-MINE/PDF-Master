import { escapeHtml, formatBytes, isImage, isPdf, saveBlob } from "./file-manager.js";
import { getSupabaseClient } from "./supabase-client.js";

const CLOUD_BUCKET = "pdf-master-cloud";
const CLOUD_QUOTA_BYTES = 1024 ** 3;

function getCloudContentType(file) {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return "application/pdf";
  if (file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name)) return "image/jpeg";
  if (file.type === "image/png" || /\.png$/i.test(file.name)) return "image/png";
  if (file.type === "image/webp" || /\.webp$/i.test(file.name)) return "image/webp";
  return "";
}

function renderSetup(container) {
  container.innerHTML = `<section class="cloud-page">
    <div class="cloud-hero"><span class="cloud-hero-icon" aria-hidden="true">☁</span><div><span class="section-kicker">PRIVATE FILE STORAGE</span><h1>Your personal PDF cloud</h1><p>Premium cloud storage is planned at 1 GB per verified account. Connect Supabase to enable Google sign-in and private file storage.</p></div></div>
    <section class="panel cloud-state-panel"><span class="cloud-state-mark" aria-hidden="true">i</span><div><h2>Cloud service needs setup</h2><p>${escapeHtml("Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to a local .env file, then apply the Supabase migration. Local PDF tools continue to work without cloud configuration.")}</p><a class="secondary-button cloud-link-button" href="#premium">View Premium plans</a></div></section>
  </section>`;
}

function renderSignIn(container, client, notify) {
  container.innerHTML = `<section class="cloud-page">
    <div class="cloud-hero"><span class="cloud-hero-icon" aria-hidden="true">☁</span><div><span class="section-kicker">PRIVATE FILE STORAGE</span><h1>Your personal PDF cloud</h1><p>Sign in with Google to view your account. Files are only uploaded when you choose them.</p></div></div>
    <section class="panel cloud-auth-panel"><span class="cloud-auth-icon" aria-hidden="true">G</span><h2>Sign in to PDF MASTER</h2><p>Your cloud files are private to your account. Your documents are not uploaded until you select a file and confirm.</p><button class="primary-button" type="button" data-cloud-signin>Continue with Google</button><small>Cloud access needs an internet connection. Local PDF tools remain available offline.</small></section>
  </section>`;

  container.querySelector("[data-cloud-signin]").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.dataset.processing = "true";
    button.textContent = "Connecting to Google…";
    try {
      const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${location.origin}${location.pathname}?cloud=1` }
      });
      if (error) throw error;
    } catch (error) {
      console.error("Could not start Google sign-in:", error);
      notify(error.message || "Google sign-in could not be started.", "error");
      button.disabled = false;
      delete button.dataset.processing;
      button.textContent = "Continue with Google";
    }
  });
}

function renderFiles(files) {
  if (!files.length) return `<div class="cloud-empty"><span aria-hidden="true">▤</span><strong>No cloud files yet</strong><small>Choose files to upload them to your private storage.</small></div>`;
  return `<div class="cloud-file-list">${files.map((file) => `<article class="cloud-file-row" data-cloud-file="${escapeHtml(file.id)}">
    <span class="cloud-file-icon" aria-hidden="true">${isPdf({ name: file.display_name, type: file.content_type }) ? "PDF" : "IMG"}</span>
    <span class="cloud-file-copy"><strong>${escapeHtml(file.display_name)}</strong><small>${formatBytes(Number(file.size_bytes))} · Added ${new Date(file.created_at).toLocaleDateString()}</small></span>
    <span class="cloud-file-actions"><button class="secondary-button" type="button" data-download-file="${escapeHtml(file.id)}">Download</button><button class="danger-button" type="button" data-delete-file="${escapeHtml(file.id)}">Delete</button></span>
  </article>`).join("")}</div>`;
}

export async function renderCloudPage(container, notify) {
  let client;
  try {
    client = getSupabaseClient();
  } catch (error) {
    if (!error.message.startsWith("Cloud storage is not configured.")) {
      console.error("Could not initialize Supabase:", error);
    }
    renderSetup(container);
    window.dispatchEvent(new CustomEvent("pdf-master:premium-entitlement", { detail: { active: false } }));
    return;
  }

  container.innerHTML = `<section class="cloud-loading" role="status" aria-live="polite"><span class="processing-spinner" aria-hidden="true"></span><span>Checking your private cloud account…</span></section>`;

  try {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    const session = sessionData.session;
    if (!session) {
      window.dispatchEvent(new CustomEvent("pdf-master:premium-entitlement", { detail: { active: false } }));
      renderSignIn(container, client, notify);
      return;
    }

    const user = session.user;
    const [{ data: profile, error: profileError }, { data: files, error: filesError }] = await Promise.all([
      client.from("profiles").select("premium_status,premium_until,quota_bytes").eq("id", user.id).single(),
      client.from("cloud_files").select("id,display_name,size_bytes,content_type,storage_path,created_at,status").eq("status", "stored").order("created_at", { ascending: false })
    ]);
    if (profileError) throw profileError;
    if (filesError) throw filesError;

    const premiumUntil = profile.premium_until ? new Date(profile.premium_until) : null;
    const quota = Number(profile.quota_bytes) || 0;
    const hasCurrentPayment = profile.premium_status === "active" && (!premiumUntil || premiumUntil > new Date());
    const isActive = hasCurrentPayment && quota === CLOUD_QUOTA_BYTES;
    const isLifetime = isActive && !premiumUntil;
    const withinGrace = quota === CLOUD_QUOTA_BYTES && premiumUntil && premiumUntil <= new Date() && premiumUntil.getTime() + 30 * 86400000 > Date.now();
    const quotaPending = hasCurrentPayment && quota !== CLOUD_QUOTA_BYTES;
    window.dispatchEvent(new CustomEvent("pdf-master:premium-entitlement", { detail: { active: isActive } }));
    const cloudFiles = files || [];
    const used = cloudFiles.reduce((total, file) => total + Number(file.size_bytes), 0);
    const canRead = isActive || withinGrace;

    container.innerHTML = `<section class="cloud-page">
      <div class="cloud-page-heading"><div><span class="section-kicker">YOUR PRIVATE SPACE</span><h1>My Cloud</h1><p>Signed in as ${escapeHtml(user.email || "Google account")}. Cloud files are separate from local processing.</p></div><button class="secondary-button" type="button" data-cloud-signout>Sign out</button></div>
      <section class="cloud-quota-panel panel">
        <div class="cloud-quota-heading"><div><span class="cloud-quota-icon" aria-hidden="true">☁</span>        <div><span class="section-kicker">PREMIUM STORAGE</span><h2>${quotaPending ? "Storage setup pending" : isLifetime ? "Lifetime Premium" : isActive ? "Premium active" : withinGrace ? "Read-only grace period" : "Premium not active"}</h2></div></div><span class="cloud-quota-value">${formatBytes(used)} <small>of ${formatBytes(quota)}</small></span></div>
        <div class="cloud-quota-track" role="progressbar" aria-label="Cloud storage used" aria-valuemin="0" aria-valuemax="${quota || CLOUD_QUOTA_BYTES}" aria-valuenow="${used}"><span style="width:${quota ? Math.min(100, used / quota * 100) : 0}%"></span></div>
        <p>${quotaPending ? "Your Premium account is verified, but its storage quota has not been provisioned. Contact support; do not retry payments." : isActive ? "Upload only the files you select. Your private cloud quota is 1 GB." : withinGrace ? "Premium has expired. Cloud is read-only during your 30-day grace period; you can download or delete files." : "A verified Premium account is required to use cloud storage. Your local PDF tools are still available."}</p>
        ${isActive && premiumUntil ? `<small class="cloud-expiry">Premium access until ${premiumUntil.toLocaleDateString()}.</small>` : ""}
        ${!isActive && !withinGrace && !quotaPending ? `<a class="primary-button cloud-link-button" href="#premium">View Premium plans</a>` : ""}
      </section>
      ${canRead ? `<section class="panel cloud-files-panel">
        <div class="cloud-files-heading"><div><h2>Your files</h2><p>Private to your signed-in account.</p></div>
          ${isActive ? `<label class="primary-button cloud-upload-label">Upload files<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" multiple data-cloud-upload></label>` : ""}
        </div>
        ${renderFiles(cloudFiles)}
        <p class="cloud-privacy-note">Uploads are manual and opt-in. Cloud files leave your device only after you select them here.</p>
      </section>` : ""}
    </section>`;

    container.querySelector("[data-cloud-signout]").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      const { error } = await client.auth.signOut();
      if (error) {
        button.disabled = false;
        notify(error.message || "Could not sign out.", "error");
        return;
      }
      window.dispatchEvent(new CustomEvent("pdf-master:premium-entitlement", { detail: { active: false } }));
      await renderCloudPage(container, notify);
    });

    container.querySelector("[data-cloud-upload]")?.addEventListener("change", async (event) => {
      const input = event.currentTarget;
      const filesToUpload = [...input.files];
      input.value = "";
      for (const file of filesToUpload) {
        if (!isPdf(file) && !isImage(file)) {
          notify(`${file.name}: choose a PDF, JPG, PNG, or WEBP file.`, "error");
          continue;
        }
        await uploadCloudFile(client, file, container, notify);
      }
      await renderCloudPage(container, notify);
    });

    container.onclick = async (event) => {
      const downloadButton = event.target.closest("[data-download-file]");
      if (downloadButton) {
        const file = cloudFiles.find((item) => item.id === downloadButton.dataset.downloadFile);
        if (file) await downloadCloudFile(client, file, downloadButton, notify);
        return;
      }
      const deleteButton = event.target.closest("[data-delete-file]");
      if (deleteButton) {
        const file = cloudFiles.find((item) => item.id === deleteButton.dataset.deleteFile);
        if (file) await deleteCloudFile(client, file, deleteButton, notify, container);
      }
    };
  } catch (error) {
    console.error("Could not load cloud account:", error);
    window.dispatchEvent(new CustomEvent("pdf-master:premium-entitlement", { detail: { active: false } }));
    container.innerHTML = `<section class="cloud-page"><div class="panel cloud-error-panel"><h1>Cloud account unavailable</h1><p>${escapeHtml(error.message || "The account or cloud storage could not be loaded.")}</p><button class="secondary-button" type="button" data-cloud-retry>Try again</button></div></section>`;
    container.querySelector("[data-cloud-retry]").addEventListener("click", () => renderCloudPage(container, notify));
  }
}

async function uploadCloudFile(client, file, container, notify) {
  const status = document.createElement("div");
  status.className = "cloud-upload-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.innerHTML = `<span class="processing-spinner" aria-hidden="true"></span><span>Preparing ${escapeHtml(file.name)}…</span>`;
  container.querySelector(".cloud-files-panel")?.prepend(status);

  let reservation;
  let objectUploaded = false;
  try {
    const contentType = getCloudContentType(file);
    if (!contentType) throw new Error("The selected file type is not supported.");
    const { data: reserved, error: reserveError } = await client.rpc("reserve_cloud_upload", {
      p_display_name: file.name,
      p_size_bytes: file.size,
      p_content_type: contentType
    });
    if (reserveError) throw reserveError;
    reservation = Array.isArray(reserved) ? reserved[0] : reserved;
    if (!reservation?.id || !reservation?.storage_path) throw new Error("Cloud upload reservation was not created.");

    status.lastElementChild.textContent = `Uploading ${file.name} to your private cloud…`;
    const { error: uploadError } = await client.storage.from(CLOUD_BUCKET).upload(reservation.storage_path, file, {
      contentType,
      upsert: false
    });
    if (uploadError) throw uploadError;
    objectUploaded = true;

    const { error: finalizeError } = await client.rpc("finalize_cloud_upload", { p_file_id: reservation.id });
    if (finalizeError) throw finalizeError;
    notify(`${file.name} uploaded to your private cloud.`, "success");
  } catch (error) {
    console.error("Cloud upload failed:", error);
    if (objectUploaded && reservation?.storage_path) {
      const { error: removeError } = await client.storage.from(CLOUD_BUCKET).remove([reservation.storage_path]);
      if (removeError) console.error("Could not remove incomplete cloud upload:", removeError);
    }
    if (reservation?.id) {
      const { error: releaseError } = await client.rpc("release_cloud_upload", { p_file_id: reservation.id });
      if (releaseError) console.error("Could not release cloud upload reservation:", releaseError);
    }
    notify(error.message || `Could not upload ${file.name}.`, "error");
  } finally {
    status.remove();
  }
}

async function downloadCloudFile(client, file, button, notify) {
  button.disabled = true;
  button.dataset.processing = "true";
  button.setAttribute("aria-busy", "true");
  const idleLabel = button.textContent;
  button.textContent = "Downloading…";
  try {
    const { data, error } = await client.storage.from(CLOUD_BUCKET).download(file.storage_path);
    if (error) throw error;
    saveBlob(data, file.display_name);
    notify("Your cloud file download has started.", "success");
  } catch (error) {
    console.error("Cloud download failed:", error);
    notify(error.message || "Could not download this cloud file.", "error");
  } finally {
    button.disabled = false;
    delete button.dataset.processing;
    button.setAttribute("aria-busy", "false");
    button.textContent = idleLabel;
  }
}

async function deleteCloudFile(client, file, button, notify, container) {
  if (!window.confirm(`Permanently delete "${file.display_name}" from your cloud storage?`)) return;
  button.disabled = true;
  button.dataset.processing = "true";
  button.setAttribute("aria-busy", "true");
  const idleLabel = button.textContent;
  button.textContent = "Deleting…";
  try {
    const { error: removeError } = await client.storage.from(CLOUD_BUCKET).remove([file.storage_path]);
    if (removeError) throw removeError;
    const { error: metadataError } = await client.from("cloud_files").delete().eq("id", file.id);
    if (metadataError) throw metadataError;
    notify("Cloud file deleted.", "success");
    await renderCloudPage(container, notify);
  } catch (error) {
    console.error("Cloud delete failed:", error);
    notify(error.message || "Could not delete this cloud file.", "error");
    button.disabled = false;
    delete button.dataset.processing;
    button.setAttribute("aria-busy", "false");
    button.textContent = idleLabel;
  }
}
