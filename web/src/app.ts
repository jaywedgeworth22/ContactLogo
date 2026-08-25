import {
  classifyContact,
  type BookContact,
} from "./engine/classify.ts";
import { looksLikeContactCsv, parseGoogleCsv } from "./engine/csv.ts";
import {
  importGoogleContacts,
  requestAccessToken,
  updateGoogleContactPhoto,
} from "./engine/google-contacts.ts";
import {
  composeFromFile,
  composeFromUrl,
  embedSrc,
  isVectorSource,
  nextCandidateIndex,
  padAndSquareImage,
  sourceLabel,
  viaLabel,
} from "./engine/logos.ts";
import { bucket, matchBook, type ReviewItem } from "./engine/match.ts";
import { canPickDeviceContacts, pickDeviceContacts } from "./engine/picker.ts";
import { getGoogleClientId, setGoogleClientId } from "./engine/settings.ts";
import { backupFilename, contactsToVcard, downloadText, parseVcard } from "./engine/vcard.ts";
import { reportClientError } from "./observability/datadog.ts";

type FilterStatus = "all" | "ready" | "review" | "notfound" | "missingphoto";

type State = {
  contacts: BookContact[];
  items: ReviewItem[];
  stage: "idle" | "review";
  notice: string;
  showSettings: boolean;
  searchQuery: string;
  filterStatus: FilterStatus;
  showCircleMask: boolean;
};

const state: State = {
  contacts: [],
  items: [],
  stage: "idle",
  notice: "",
  showSettings: false,
  searchQuery: "",
  filterStatus: "all",
  showCircleMask: true,
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const kid of kids) node.append(kid);
  return node;
}

function adopt(contacts: BookContact[], label: string) {
  if (contacts.length === 0) {
    state.notice = "No contacts found.";
    render();
    return;
  }
  state.contacts = contacts;
  state.items = matchBook(contacts);
  state.stage = "review";
  state.searchQuery = "";
  state.filterStatus = "all";
  state.notice = `${label}: ${contacts.length} contact${contacts.length === 1 ? "" : "s"}.  Review every logo before download.`;
  render();
}

function importText(name: string, text: string) {
  const contacts = name.toLowerCase().endsWith(".csv") || looksLikeContactCsv(text)
    ? parseGoogleCsv(text)
    : parseVcard(text);
  for (const c of contacts) c.importSource = "file";
  adopt(contacts, `Imported ${name}`);
}

async function importFile(file: File) {
  try {
    state.notice = `Reading ${file.name}…`;
    render();
    const text = await file.text();
    importText(file.name, text);
  } catch (err) {
    reportClientError(err, { operation: "import-file" });
    state.notice = err instanceof Error ? err.message : "Could not read that file";
    render();
  }
}

async function importFromGoogle() {
  try {
    state.notice = "Connecting to Google…";
    render();
    const contacts = await importGoogleContacts((n) => {
      state.notice = `Reading Google Contacts · ${n}`;
      render();
    });
    adopt(contacts, "Google Contacts");
  } catch (err) {
    reportClientError(err, { operation: "import-google" });
    const message = err instanceof Error ? err.message : "Google import failed";
    state.notice =
      message === "GOOGLE_CONTACTS_NOT_CONFIGURED"
        ? "Set a Google OAuth client id in Settings, then try again."
        : message;
    if (message === "GOOGLE_CONTACTS_NOT_CONFIGURED") state.showSettings = true;
    render();
  }
}

async function importFromDevice() {
  try {
    state.notice = "Opening the device address book…";
    render();
    const contacts = await pickDeviceContacts();
    adopt(contacts, "This phone");
  } catch (err) {
    reportClientError(err, { operation: "import-device" });
    state.notice = err instanceof Error ? err.message : "Could not read contacts";
    render();
  }
}

function applySelected(onlySelected: boolean = true): BookContact[] {
  const byId = new Map(state.contacts.map((c) => [c.id, { ...c }]));
  const updatedIds = new Set<string>();
  for (const item of state.items) {
    if (!item.selected) continue;
    const hit = item.candidates[item.chosenIndex];
    if (!hit) continue;
    const next = byId.get(item.contact.id);
    if (next) {
      next.photoDataUrl = hit.src;
      updatedIds.add(item.contact.id);
    }
  }
  if (onlySelected) {
    return [...byId.values()].filter((c) => updatedIds.has(c.id));
  }
  return [...byId.values()];
}

function downloadBackup() {
  downloadText(backupFilename(), contactsToVcard(state.contacts), "text/vcard;charset=utf-8");
}

async function downloadApproved() {
  const selectedCount = state.items.filter((i) => i.selected && i.candidates[i.chosenIndex]).length;
  if (selectedCount === 0) {
    state.notice = "No approved logos selected to export. Check the contacts you want to update first.";
    render();
    return;
  }
  state.notice = `Embedding and formatting ${selectedCount} approved logo${selectedCount === 1 ? "" : "s"}…`;
  render();
  const updated = applySelected(true);
  for (const contact of updated) {
    if (contact.photoDataUrl) {
      const embedded = await embedSrc(contact.photoDataUrl);
      contact.photoDataUrl = await padAndSquareImage(embedded);
    }
  }
  downloadText("contactlogo-approved-updates.vcf", contactsToVcard(updated), "text/vcard;charset=utf-8");
  state.notice = `Downloaded ${updated.length} updated contact${updated.length === 1 ? "" : "s"}. Import this file into Contacts to safely update only these cards.`;
  render();
}

async function downloadFull() {
  state.notice = "Embedding approved logos into full address book…";
  render();
  const updated = applySelected(false);
  for (const contact of updated) {
    if (contact.photoDataUrl && state.items.some((i) => i.selected && i.contact.id === contact.id)) {
      const embedded = await embedSrc(contact.photoDataUrl);
      contact.photoDataUrl = await padAndSquareImage(embedded);
    }
  }
  downloadText("contactlogo-full-addressbook.vcf", contactsToVcard(updated), "text/vcard;charset=utf-8");
  state.notice = `Downloaded full address book (${updated.length} contacts).`;
  render();
}

async function syncToGoogleContacts() {
  const clientId = getGoogleClientId();
  if (!clientId) {
    state.notice = "Configure Google Client ID in Settings first.";
    state.showSettings = true;
    render();
    return;
  }
  try {
    state.notice = "Requesting Google Contacts write permission…";
    render();
    const token = await requestAccessToken(clientId, true);
    const selectedItems = state.items.filter((i) => i.selected && i.candidates[i.chosenIndex]);
    const googleTargets = selectedItems.filter((i) => i.contact.googleResourceName);
    if (googleTargets.length === 0) {
      state.notice = "No selected contacts originated from Google Contacts to sync.";
      render();
      return;
    }
    let done = 0;
    let failed = 0;
    for (const item of googleTargets) {
      const hit = item.candidates[item.chosenIndex];
      if (!hit || !item.contact.googleResourceName) continue;
      state.notice = `Syncing photo to Google: ${done + 1}/${googleTargets.length} (${item.contact.displayName})…`;
      render();
      try {
        const embedded = await embedSrc(hit.src);
        const squared = await padAndSquareImage(embedded);
        await updateGoogleContactPhoto(item.contact.googleResourceName, squared, token);
        item.contact.hadExistingPhoto = true;
        done += 1;
      } catch (err) {
        reportClientError(err, { operation: "google-sync-photo" });
        failed += 1;
      }
    }
    state.notice = `Google Contacts sync complete: ${done} updated${failed > 0 ? `, ${failed} failed` : ""}.`;
    render();
  } catch (err) {
    reportClientError(err, { operation: "google-sync" });
    state.notice = err instanceof Error ? err.message : "Google sync failed";
    render();
  }
}

function setAllHigh(selected: boolean) {
  for (const item of state.items) {
    if (item.confidence === "high") item.selected = selected;
  }
  render();
}

async function uploadFor(item: ReviewItem, file: File) {
  const src = await composeFromFile(file);
  item.candidates = [{ src, source: "upload", kind: "icon" }, ...item.candidates];
  item.chosenIndex = 0;
  item.selected = true;
  item.confidence = "high";
  item.flags = item.flags.filter((f) => f !== "non-brand");
  render();
}

async function pasteUrlFor(item: ReviewItem) {
  const raw = window.prompt("Paste an image URL");
  if (!raw) return;
  try {
    const src = await composeFromUrl(raw);
    item.candidates = [{ src, source: "url", kind: "icon" }, ...item.candidates];
    item.chosenIndex = 0;
    item.selected = true;
    item.confidence = "high";
    render();
  } catch (err) {
    reportClientError(err, { operation: "paste-logo-url" });
    state.notice = err instanceof Error ? err.message : "Could not use that URL";
    render();
  }
}

type CropModalState = {
  item: ReviewItem | null;
  imgSrc: string;
  zoom: number;
  panX: number;
  panY: number;
  addBadge: boolean;
  bgColor: string;
};

const cropState: CropModalState = {
  item: null,
  imgSrc: "",
  zoom: 1.0,
  panX: 0,
  panY: 0,
  addBadge: false,
  bgColor: "transparent",
};

function openCropFor(item: ReviewItem) {
  const hit = item.candidates[item.chosenIndex];
  if (!hit) return;
  cropState.item = item;
  cropState.imgSrc = hit.src;
  cropState.zoom = 1.0;
  cropState.panX = 0;
  cropState.panY = 0;
  cropState.addBadge = false;
  cropState.bgColor = "transparent";
  render();
}

function closeCrop() {
  cropState.item = null;
  render();
}

async function applyCrop() {
  if (!cropState.item || !cropState.imgSrc) return;
  const item = cropState.item;
  try {
    const croppedSrc = await padAndSquareImage(cropState.imgSrc, {
      zoom: cropState.zoom,
      panX: cropState.panX,
      panY: cropState.panY,
      addBadgeForDarkAlpha: cropState.addBadge,
      backgroundColor: cropState.bgColor,
    });
    item.candidates = [{ src: croppedSrc, source: "crop", kind: "icon" }, ...item.candidates];
    item.chosenIndex = 0;
    item.selected = true;
    item.confidence = "high";
    cropState.item = null;
    state.notice = `Applied custom crop for ${item.contact.displayName}.`;
    render();
  } catch (err) {
    reportClientError(err, { operation: "apply-crop" });
    cropState.item = null;
    render();
  }
}

function cropModal(): HTMLElement {
  const item = cropState.item;
  if (!item) return el("div", { class: "hidden" });

  const backdrop = el("div", { class: "modal-backdrop" });
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeCrop();
  });

  const modal = el("div", { class: "crop-modal" });

  const header = el(
    "div",
    { class: "crop-header" },
    el("h3", {}, `Crop & Adjust — ${item.contact.displayName}`),
    el("p", { class: "meta" }, "Drag the image to center it and adjust the zoom slider for circular contact framing."),
  );

  const canvas = el("canvas", { class: "crop-canvas", width: "280", height: "280" }) as HTMLCanvasElement;
  const ctx = canvas.getContext("2d");

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = cropState.imgSrc;

  function drawPreview() {
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (cropState.bgColor && cropState.bgColor !== "transparent") {
      ctx.fillStyle = cropState.bgColor;
      ctx.fillRect(0, 0, w, h);
    }

    if (cropState.addBadge) {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w / 2 - 4, 0, Math.PI * 2);
      ctx.fill();
    }

    if (img.complete && img.naturalWidth > 0) {
      ctx.save();
      const availWidth = w * 0.7;
      const availHeight = h * 0.7;
      const baseScale = Math.min(availWidth / img.naturalWidth, availHeight / img.naturalHeight, 1.0);
      const scale = baseScale * cropState.zoom;
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      const dx = (w - dw) / 2 + cropState.panX * (w / 512);
      const dy = (h - dh) / 2 + cropState.panY * (h / 512);

      ctx.drawImage(img, dx, dy, dw, dh);
      ctx.restore();
    }

    // Circular safe-ring mask overlay
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.arc(w / 2, h / 2, w / 2 - 6, 0, Math.PI * 2, true);
    ctx.fill();

    // Circular guideline border
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  img.onload = () => drawPreview();

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let initialPanX = 0;
  let initialPanY = 0;

  canvas.addEventListener("mousedown", (e) => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    initialPanX = cropState.panX;
    initialPanY = cropState.panY;
  });

  window.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    cropState.panX = initialPanX + dx * (512 / 280);
    cropState.panY = initialPanY + dy * (512 / 280);
    drawPreview();
  });

  window.addEventListener("mouseup", () => {
    isDragging = false;
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.05 : -0.05;
    cropState.zoom = Math.max(0.4, Math.min(4.0, cropState.zoom + delta));
    zoomInput.value = String(cropState.zoom);
    zoomLabel.textContent = `${Math.round(cropState.zoom * 100)}%`;
    drawPreview();
  }, { passive: false });

  canvas.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      isDragging = true;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      initialPanX = cropState.panX;
      initialPanY = cropState.panY;
    }
  });

  canvas.addEventListener("touchmove", (e) => {
    if (!isDragging || e.touches.length !== 1) return;
    e.preventDefault();
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    cropState.panX = initialPanX + dx * (512 / 280);
    cropState.panY = initialPanY + dy * (512 / 280);
    drawPreview();
  }, { passive: false });

  canvas.addEventListener("touchend", () => { isDragging = false; });

  const zoomLabel = el("span", { class: "zoom-val" }, `${Math.round(cropState.zoom * 100)}%`);
  const zoomInput = el("input", {
    type: "range",
    min: "0.4",
    max: "3.0",
    step: "0.05",
    value: String(cropState.zoom),
    class: "zoom-slider",
  }) as HTMLInputElement;
  zoomInput.addEventListener("input", () => {
    cropState.zoom = parseFloat(zoomInput.value);
    zoomLabel.textContent = `${Math.round(cropState.zoom * 100)}%`;
    drawPreview();
  });
  const zoomRow = el("div", { class: "crop-row" }, el("label", {}, "Zoom:"), zoomInput, zoomLabel);

  const badgeCheck = el("input", { type: "checkbox" }) as HTMLInputElement;
  badgeCheck.checked = cropState.addBadge;
  badgeCheck.addEventListener("change", () => {
    cropState.addBadge = badgeCheck.checked;
    drawPreview();
  });
  const badgeToggle = el("label", { class: "crop-check-row" }, badgeCheck, el("span", {}, "White circular backing (for dark logos)"));

  const resetBtn = el("button", { class: "btn secondary small", type: "button" }, "Center / Reset");
  resetBtn.addEventListener("click", () => {
    cropState.zoom = 1.0;
    cropState.panX = 0;
    cropState.panY = 0;
    zoomInput.value = "1.0";
    zoomLabel.textContent = "100%";
    drawPreview();
  });

  const controls = el("div", { class: "crop-controls" }, zoomRow, badgeToggle, resetBtn);

  const applyBtn = el("button", { class: "btn", type: "button" }, "Apply Crop");
  applyBtn.addEventListener("click", () => void applyCrop());
  const cancelBtn = el("button", { class: "btn ghost", type: "button" }, "Cancel");
  cancelBtn.addEventListener("click", () => closeCrop());
  const actions = el("div", { class: "crop-actions" }, cancelBtn, applyBtn);

  modal.append(header, canvas, controls, actions);
  backdrop.append(modal);
  return backdrop;
}

function tryAnother(item: ReviewItem) {
  if (item.candidates.length < 2) return;
  item.chosenIndex = (item.chosenIndex + 1) % item.candidates.length;
  item.selected = true;
  render();
}

function card(item: ReviewItem): HTMLElement {
  const hit = item.candidates[item.chosenIndex];
  const thumbClass = `thumb${state.showCircleMask ? " circle-mask" : ""}${hit ? " clickable" : ""}`;
  const thumb = hit
    ? el("img", { class: thumbClass, src: hit.src, alt: item.contact.displayName })
    : el("div", { class: "noimg" }, "?");

  if (hit) {
    thumb.setAttribute("title", "Click to crop and adjust logo");
    thumb.addEventListener("click", () => openCropFor(item));
    (thumb as HTMLImageElement).addEventListener("error", () => {
      const next = nextCandidateIndex(item.chosenIndex, item.candidates.length);
      if (next !== undefined) {
        item.chosenIndex = next;
        render();
      }
    });
    (thumb as HTMLImageElement).addEventListener("load", () => {
      const isVector = isVectorSource(hit.src);
      const imgEl = thumb as HTMLImageElement;
      if (!isVector && imgEl.naturalWidth > 0 && (imgEl.naturalWidth < 48 || imgEl.naturalHeight < 48)) {
        const next = nextCandidateIndex(item.chosenIndex, item.candidates.length);
        if (next !== undefined) {
          item.chosenIndex = next;
          render();
        }
      }
    });
  }

  const check = el("input", { type: "checkbox" }) as HTMLInputElement;
  check.checked = item.selected;
  check.disabled = item.candidates.length === 0;
  check.addEventListener("change", () => {
    item.selected = check.checked;
  });

  const alts = el("div", { class: "alts" });
  item.candidates.forEach((cand, i) => {
    const b = el("button", { class: i === item.chosenIndex ? "on" : "", type: "button", title: sourceLabel(cand.source) });
    const cImg = el("img", { src: cand.src, alt: cand.source }) as HTMLImageElement;
    cImg.addEventListener("error", () => {
      b.style.display = "none";
    });
    cImg.addEventListener("load", () => {
      const isVector = isVectorSource(cand.src);
      if (!isVector && cImg.naturalWidth > 0 && (cImg.naturalWidth < 48 || cImg.naturalHeight < 48)) {
        b.style.display = "none";
        if (item.chosenIndex === i) {
          const next = nextCandidateIndex(i, item.candidates.length);
          if (next !== undefined) {
            item.chosenIndex = next;
            render();
          }
        }
      }
    });
    b.append(cImg);
    b.addEventListener("click", () => {
      item.chosenIndex = i;
      item.selected = true;
      render();
    });
    alts.append(b);
  });

  const upload = el("input", { type: "file", accept: "image/*", class: "hidden" }) as HTMLInputElement;
  upload.addEventListener("change", () => {
    const file = upload.files?.[0];
    if (file) void uploadFor(item, file);
    upload.value = "";
  });
  const uploadBtn = el("button", { class: "btn secondary", type: "button" }, "Upload");
  uploadBtn.addEventListener("click", () => upload.click());

  const cropBtn = el("button", { class: "btn secondary", type: "button" }, "Crop");
  cropBtn.disabled = !hit;
  cropBtn.addEventListener("click", () => openCropFor(item));

  const pasteBtn = el("button", { class: "btn secondary", type: "button" }, "Paste URL");
  pasteBtn.addEventListener("click", () => void pasteUrlFor(item));
  const retry = el("button", { class: "btn secondary", type: "button" }, "Try another");
  retry.disabled = item.candidates.length < 2;
  retry.addEventListener("click", () => tryAnother(item));
  const skip = el("button", { class: "btn ghost", type: "button" }, "Skip");
  skip.addEventListener("click", () => {
    item.selected = false;
    render();
  });

  const via = viaLabel(item.via);
  const source = hit ? sourceLabel(hit.source) : "none";

  const cardEl = el(
    "article",
    { class: `card ${item.confidence}` },
    check,
    thumb,
    el(
      "div",
      { class: "card-content" },
      el("div", { class: "name" }, item.contact.displayName),
      el(
        "div",
        { class: "meta" },
        `${item.confidence} · ${source}${via ? ` · ${via}` : ""}${item.flags.length ? ` · ${item.flags.join(", ")}` : ""}`,
      ),
      alts,
      el("div", { class: "actions" }, retry, cropBtn, uploadBtn, pasteBtn, skip, upload),
    ),
  );

  // Drag-and-drop directly onto this contact card
  cardEl.addEventListener("dragenter", (e) => {
    e.preventDefault();
    cardEl.classList.add("drag-over");
  });
  cardEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    cardEl.classList.add("drag-over");
  });
  cardEl.addEventListener("dragleave", (e) => {
    if (!cardEl.contains(e.relatedTarget as Node)) {
      cardEl.classList.remove("drag-over");
    }
  });
  cardEl.addEventListener("drop", (e) => {
    e.preventDefault();
    cardEl.classList.remove("drag-over");
    const file = e.dataTransfer?.files?.[0];
    if (file && (file.type.startsWith("image/") || file.type === "image/svg+xml")) {
      void uploadFor(item, file);
    }
  });

  return cardEl;
}

function section(title: string, items: ReviewItem[]): HTMLElement {
  const wrap = el("section", { class: "section" }, el("h2", {}, `${title} (${items.length})`));
  const grid = el("div", { class: "grid" });
  for (const item of items) grid.append(card(item));
  wrap.append(grid);
  return wrap;
}

function settingsPanel(): HTMLElement {
  const input = el("input", {
    type: "text",
    class: "settings-input",
    placeholder: "Google OAuth client id",
    value: getGoogleClientId(),
    autocomplete: "off",
  }) as HTMLInputElement;
  const save = el("button", { class: "btn secondary", type: "button" }, "Save");
  save.addEventListener("click", () => {
    setGoogleClientId(input.value);
    state.notice = "Saved Google client id in this browser.  Contacts are still not stored.";
    state.showSettings = false;
    render();
  });
  return el(
    "div",
    { class: "settings" },
    el("h2", {}, "Settings"),
    el(
      "p",
      { class: "meta" },
      "Optional Google People API client id for Import and Direct Sync to Google Contacts.  Stored only in this browser.",
    ),
    input,
    save,
  );
}

export function render() {
  const root = document.getElementById("app");
  if (!root) return;
  root.replaceChildren();

  const app = el("div", { class: "app" });
  const settingsBtn = el("button", { class: "btn ghost", type: "button" }, "Settings");
  settingsBtn.addEventListener("click", () => {
    state.showSettings = !state.showSettings;
    render();
  });
  app.append(
    el(
      "header",
      { class: "hero" },
      el("div", { class: "hero-row" }, el("h1", {}, "ContactLogo"), settingsBtn),
      el(
        "p",
        {},
        "Brand icons for your address book.  Import a vCard, Google CSV, Google Contacts, or this phone, review every match, then download an updated card or sync directly to Google.  Existing person photos are never replaced.",
      ),
    ),
  );

  if (state.showSettings) app.append(settingsPanel());

  const file = el("input", { type: "file", accept: ".vcf,.vcard,.csv,text/vcard,text/csv", class: "hidden" }) as HTMLInputElement;
  file.addEventListener("change", () => {
    const f = file.files?.[0];
    if (f) void importFile(f);
    file.value = "";
  });
  const pick = el("button", { class: "btn", type: "button" }, "Import vCard or CSV");
  pick.addEventListener("click", () => file.click());
  const google = el("button", { class: "btn secondary", type: "button" }, "Import Google Contacts");
  google.addEventListener("click", () => void importFromGoogle());
  const actions: HTMLElement[] = [pick, google];
  if (canPickDeviceContacts()) {
    const device = el("button", { class: "btn secondary", type: "button" }, "Import from this phone");
    device.addEventListener("click", () => void importFromDevice());
    actions.push(device);
  }

  const drop = el(
    "div",
    { class: "drop" },
    el("div", {}, el("strong", {}, "Import an address book"), el("span", {}, "Contacts stay in this browser.  Nothing is uploaded to a server.")),
    ...actions,
    file,
  );
  drop.addEventListener("dragover", (e) => e.preventDefault());
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files[0];
    if (f) void importFile(f);
  });
  app.append(drop);
  if (state.notice) app.append(el("p", { class: "meta notice-banner" }, state.notice));

  if (state.stage === "review") {
    const groups = bucket(state.items);
    const people = state.contacts.filter((c) => classifyContact(c) === "person").length;

    // Filter items based on searchQuery & filterStatus
    const query = state.searchQuery.trim().toLowerCase();
    const matchesSearch = (item: ReviewItem) => {
      if (!query) return true;
      const d = item.contact.displayName.toLowerCase();
      const org = (item.contact.organization || "").toLowerCase();
      const dom = (item.domain || "").toLowerCase();
      const q = item.query.toLowerCase();
      const ph = (item.contact.phone || "").toLowerCase();
      return d.includes(query) || org.includes(query) || dom.includes(query) || q.includes(query) || ph.includes(query);
    };

    const searchInput = el("input", {
      type: "search",
      class: "search-input",
      placeholder: "Search contacts by brand, domain, phone…",
      value: state.searchQuery,
    }) as HTMLInputElement;
    searchInput.addEventListener("input", () => {
      state.searchQuery = searchInput.value;
      render();
    });

    const circleMaskToggle = el("label", { class: "mask-toggle" });
    const maskCheckbox = el("input", { type: "checkbox" }) as HTMLInputElement;
    maskCheckbox.checked = state.showCircleMask;
    maskCheckbox.addEventListener("change", () => {
      state.showCircleMask = maskCheckbox.checked;
      render();
    });
    circleMaskToggle.append(maskCheckbox, el("span", {}, "Circle mask preview"));

    const searchBar = el("div", { class: "search-bar" }, searchInput, circleMaskToggle);
    app.append(searchBar);

    app.append(
      el(
        "div",
        { class: "stats" },
        el("div", { class: "stat high" }, el("b", {}, String(groups.auto.length)), " Ready to apply"),
        el("div", { class: "stat medium" }, el("b", {}, String(groups.review.length)), " Needs review"),
        el("div", { class: "stat skip" }, el("b", {}, String(groups.notFound.length)), " Not a brand / not found"),
        el("div", { class: "stat" }, el("b", {}, String(people)), " People left alone"),
      ),
    );

    const selectHigh = el("button", { class: "btn secondary", type: "button" }, "Select all high-confidence");
    selectHigh.addEventListener("click", () => setAllHigh(true));
    const clearHigh = el("button", { class: "btn ghost", type: "button" }, "Clear high-confidence");
    clearHigh.addEventListener("click", () => setAllHigh(false));

    const selectedCount = state.items.filter((i) => i.selected && i.candidates[i.chosenIndex]).length;
    const saveApproved = el(
      "button",
      {
        class: "btn",
        type: "button",
        title: "Export ONLY modified business contacts as a delta vCard to safely import into Apple Contacts without touching other cards",
      },
      `Download ${selectedCount} Approved Update${selectedCount === 1 ? "" : "s"}`,
    );
    saveApproved.addEventListener("click", () => void downloadApproved());

    const exportFull = el(
      "button",
      {
        class: "btn secondary",
        type: "button",
        title: "Export full address book with all contacts merged",
      },
      `Export full address book (${state.contacts.length})`,
    );
    exportFull.addEventListener("click", () => void downloadFull());

    const backup = el(
      "button",
      { class: "btn ghost", type: "button", title: "Download untouched original address book backup" },
      "Download backup",
    );
    backup.addEventListener("click", downloadBackup);

    const toolbarItems = [selectHigh, clearHigh, saveApproved, exportFull, backup];
    const hasGoogleContacts = state.contacts.some((c) => Boolean(c.googleResourceName));
    if (hasGoogleContacts) {
      const googleSyncBtn = el("button", { class: "btn secondary google-sync-btn", type: "button" }, "⚡ Apply to Google Contacts");
      googleSyncBtn.addEventListener("click", () => void syncToGoogleContacts());
      toolbarItems.push(googleSyncBtn);
    }
    app.append(el("div", { class: "toolbar" }, ...toolbarItems));

    const filteredAuto = groups.auto.filter(matchesSearch);
    const filteredReview = groups.review.filter(matchesSearch);
    const filteredNotFound = groups.notFound.filter(matchesSearch);

    if (filteredAuto.length > 0 || !query) app.append(section("Ready to apply", filteredAuto));
    if (filteredReview.length > 0 || !query) app.append(section("Needs review", filteredReview));
    if (filteredNotFound.length > 0 || !query) app.append(section("Not found / not a brand", filteredNotFound));
  }

  app.append(
    el(
      "p",
      { class: "footer" },
      "Review-first: high-confidence matches are pre-checked; guessed domains, favicons, and existing business photos stay in review.  Native macOS and iOS apps use the same rules in ContactLogoKit.  Frozen originals of BadgeBook and Crest live in backups/.",
    ),
  );
  root.append(app);
  if (cropState.item) {
    root.append(cropModal());
  }
}

