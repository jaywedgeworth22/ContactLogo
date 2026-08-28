import {
  classifyContact,
  type BookContact,
  type Confidence,
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
  padAndSquareImage,
  sourceLabel,
  viaLabel,
  type LogoHit,
} from "./engine/logos.ts";
import { bucket, matchBook, type ReviewItem } from "./engine/match.ts";
import { canPickDeviceContacts, pickDeviceContacts } from "./engine/picker.ts";
import { getGoogleClientId, setGoogleClientId } from "./engine/settings.ts";
import { backupFilename, contactsToVcard, downloadText, parseVcard } from "./engine/vcard.ts";
import { reportClientError } from "./observability/datadog.ts";

export type FilterStatus = "all" | "ready" | "review" | "notfound" | "missingphoto";

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

/** Derived once per import instead of per keystroke — the book can hold 14k cards. */
let peopleCount = 0;
let hasGoogleContacts = false;

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

const SVG_NS = "http://www.w3.org/2000/svg";

function noLogoIcon(): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "noimg-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "28");
  svg.setAttribute("height", "28");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("cx", "12");
  circle.setAttribute("cy", "12");
  circle.setAttribute("r", "9");
  const slash = document.createElementNS(SVG_NS, "line");
  slash.setAttribute("x1", "5.6");
  slash.setAttribute("y1", "5.6");
  slash.setAttribute("x2", "18.4");
  slash.setAttribute("y2", "18.4");
  svg.append(circle, slash);
  return svg;
}

/* ------------------------------------------------------------------ *
 * Presentation rules (pure — unit tested)
 * ------------------------------------------------------------------ */

/** Engine flags never reach the DOM verbatim; anything missing here is dropped. */
const FLAG_PHRASES: Record<string, string> = {
  "homonym-risk": "name is also a common word",
  "brand-tail": "matched a partial name",
  "replace-existing": "replaces an existing photo",
};

const KNOWN_VIA: ReadonlySet<string> = new Set(["website", "email", "catalog", "phone", "guess"]);

export const GUESSED_DOMAIN_NOTE = "Domain guessed — check before applying";

export function humanFlagPhrases(flags: readonly string[]): string[] {
  const out: string[] = [];
  for (const flag of flags) {
    const phrase = FLAG_PHRASES[flag];
    if (phrase && !out.includes(phrase)) out.push(phrase);
  }
  return out;
}

export function badgeText(confidence: Confidence): string | undefined {
  switch (confidence) {
    case "high":
      return "High confidence";
    case "medium":
      return "Needs a look";
    case "low":
      return "Low confidence";
    case "skip":
      return undefined;
    default: {
      const _never: never = confidence;
      void _never;
      return undefined;
    }
  }
}

/** Source · via · human flag phrases.  Confidence lives in the badge, not here. */
export function metaLine(item: ReviewItem): string {
  const hit = item.candidates[item.chosenIndex];
  const parts: string[] = [];
  if (hit) parts.push(sourceLabel(hit.source));
  if (item.via && KNOWN_VIA.has(item.via)) {
    const via = viaLabel(item.via);
    if (via) parts.push(via);
  }
  parts.push(...humanFlagPhrases(item.flags));
  return parts.join(" · ");
}

/** "This contact is not a business" — a different fact from "no logo was found". */
export function isNonBrandItem(item: ReviewItem): boolean {
  if (item.flags.includes("non-brand")) return true;
  if (item.flags.includes("person") || item.flags.includes("photo-protected")) return true;
  return item.contactClass !== "businessCard";
}

/** A business card that has run out of viable candidates: terminal, never "ready". */
export function isExhaustedItem(item: ReviewItem): boolean {
  return item.candidates.length === 0 && !isNonBrandItem(item);
}

export type SectionKey = "ready" | "review" | "nonbrand" | "notfound";

export function partitionSections(items: ReviewItem[]): Record<SectionKey, ReviewItem[]> {
  const groups = bucket(items);
  return {
    ready: groups.auto,
    review: groups.review,
    nonbrand: groups.notFound.filter(isNonBrandItem),
    notfound: groups.notFound.filter((i) => !isNonBrandItem(i)),
  };
}

export function itemMatchesQuery(item: ReviewItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const fields = [
    item.contact.displayName,
    item.contact.organization ?? "",
    item.domain ?? "",
    item.query,
    item.contact.phone ?? "",
  ];
  return fields.some((f) => f.toLowerCase().includes(q));
}

export function itemMatchesFilter(item: ReviewItem, filter: FilterStatus): boolean {
  switch (filter) {
    case "all":
      return true;
    case "ready":
      return item.confidence === "high";
    case "review":
      return item.confidence === "medium" || item.confidence === "low";
    case "notfound":
      return item.confidence === "skip" && !isNonBrandItem(item);
    case "missingphoto":
      return !item.contact.hadExistingPhoto;
    default: {
      const _never: never = filter;
      void _never;
      return true;
    }
  }
}

export function filterItems(items: ReviewItem[], query: string, filter: FilterStatus): ReviewItem[] {
  return items.filter((i) => itemMatchesFilter(i, filter) && itemMatchesQuery(i, query));
}

/**
 * Drop a candidate whose image 404'd or came back as a 16px favicon.  Removing
 * (rather than advancing an index) is what makes exhaustion terminal: the list
 * shrinks on every failure, so it always reaches empty instead of livelocking.
 */
export function removeCandidate(item: ReviewItem, src: string): boolean {
  const index = item.candidates.findIndex((c) => c.src === src);
  if (index === -1) return false;
  item.candidates.splice(index, 1);
  if (item.chosenIndex > index) item.chosenIndex -= 1;
  if (item.chosenIndex >= item.candidates.length) {
    item.chosenIndex = Math.max(0, item.candidates.length - 1);
  }
  if (item.candidates.length === 0) {
    item.selected = false;
    item.confidence = "skip";
  }
  return true;
}

export type Slice = { start: number; end: number; offsetY: number; totalHeight: number };

/** Which cards a virtualized section has to mount for the current scroll offset. */
export function visibleSlice(
  count: number,
  columns: number,
  rowHeight: number,
  scrollTop: number,
  viewportHeight: number,
  overscan = 2,
): Slice {
  const cols = Math.max(1, Math.floor(columns));
  const rh = Math.max(1, rowHeight);
  const rows = Math.ceil(Math.max(0, count) / cols);
  if (rows === 0) return { start: 0, end: 0, offsetY: 0, totalHeight: 0 };
  const top = Math.max(0, scrollTop);
  const height = Math.max(0, viewportHeight);
  const firstRow = Math.max(0, Math.floor(top / rh) - overscan);
  const lastRow = Math.min(rows - 1, Math.ceil((top + height) / rh) + overscan);
  return {
    start: Math.min(count, firstRow * cols),
    end: Math.min(count, (lastRow + 1) * cols),
    offsetY: firstRow * rh,
    totalHeight: rows * rh,
  };
}

/* ------------------------------------------------------------------ *
 * Import / export
 * ------------------------------------------------------------------ */

/** Entry point for every import path (and the DOM test harness). */
export function adoptContacts(contacts: BookContact[], label: string) {
  if (contacts.length === 0) {
    state.notice = "No contacts found.";
    render();
    return;
  }
  cardViews.clear();
  mountedBySection.clear();
  state.contacts = contacts;
  state.items = matchBook(contacts);
  state.stage = "review";
  state.searchQuery = "";
  state.filterStatus = "all";
  peopleCount = contacts.filter((c) => classifyContact(c) === "person").length;
  hasGoogleContacts = contacts.some((c) => Boolean(c.googleResourceName));
  state.notice = `${label}: ${contacts.length} contact${contacts.length === 1 ? "" : "s"}.  Review every logo before download.`;
  render();
}

function importText(name: string, text: string) {
  const contacts = name.toLowerCase().endsWith(".csv") || looksLikeContactCsv(text)
    ? parseGoogleCsv(text)
    : parseVcard(text);
  for (const c of contacts) c.importSource = "file";
  adoptContacts(contacts, `Imported ${name}`);
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
    adoptContacts(contacts, "Google Contacts");
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
    adoptContacts(contacts, "This phone");
  } catch (err) {
    reportClientError(err, { operation: "import-device" });
    state.notice = err instanceof Error ? err.message : "Could not read contacts";
    render();
  }
}

function selectedCount(): number {
  return state.items.filter((i) => i.selected && i.candidates[i.chosenIndex]).length;
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

/**
 * CL-11 — embed the logos for an export and report the ones that could not be
 * embedded.  `embedSrc` falls back to returning the remote URL, and
 * `contactToVcard` serializes only `data:image/...` photos, so a failure here
 * silently drops the logo from the file.  The callback existed for this and was
 * wired into the tests but not into either download path, so the export still
 * announced an unqualified success.
 *
 * The contact is still exported — its other fields are fine and a missing logo
 * is not a reason to withhold them — but its name comes back so the notice can
 * say what did not make it.
 */
async function embedLogosForExport(
  contacts: BookContact[],
  shouldEmbed: (contact: BookContact) => boolean,
): Promise<string[]> {
  const skipped: string[] = [];
  for (const contact of contacts) {
    if (!contact.photoDataUrl || !shouldEmbed(contact)) continue;
    let failure: string | undefined;
    const embedded = await embedSrc(contact.photoDataUrl, (reason, detail) => {
      failure = detail ? `${reason}: ${detail}` : reason;
    });
    if (failure !== undefined) {
      skipped.push(contact.displayName);
      reportClientError(new Error(`logo embed failed (${failure})`), {
        operation: "export-embed-logo",
      });
      continue;
    }
    contact.photoDataUrl = await padAndSquareImage(embedded);
  }
  return skipped;
}

/** The tail of an export notice naming the logos that did not make it. */
export function skippedNotice(skipped: string[]): string {
  if (skipped.length === 0) return "";
  const shown = skipped.slice(0, 3).join(", ");
  const rest = skipped.length > 3 ? ` and ${skipped.length - 3} more` : "";
  return ` ${skipped.length} logo${skipped.length === 1 ? "" : "s"} could not be embedded and ${skipped.length === 1 ? "is" : "are"} missing from the file: ${shown}${rest}.`;
}

async function downloadApproved() {
  const count = selectedCount();
  if (count === 0) {
    state.notice = "No approved logos selected to export. Check the contacts you want to update first.";
    render();
    return;
  }
  state.notice = `Embedding and formatting ${count} approved logo${count === 1 ? "" : "s"}…`;
  render();
  const updated = applySelected(true);
  const skipped = await embedLogosForExport(updated, () => true);
  downloadText("contactlogo-approved-updates.vcf", contactsToVcard(updated), "text/vcard;charset=utf-8");
  state.notice = `Downloaded ${updated.length} updated contact${updated.length === 1 ? "" : "s"}. Import this file into Contacts to safely update only these cards.${skippedNotice(skipped)}`;
  render();
}

async function downloadFull() {
  state.notice = "Embedding approved logos into full address book…";
  render();
  const updated = applySelected(false);
  const skipped = await embedLogosForExport(updated, (contact) =>
    state.items.some((i) => i.selected && i.contact.id === contact.id));
  downloadText("contactlogo-full-addressbook.vcf", contactsToVcard(updated), "text/vcard;charset=utf-8");
  state.notice = `Downloaded full address book (${updated.length} contacts).${skippedNotice(skipped)}`;
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

function tryAnother(item: ReviewItem) {
  if (item.candidates.length < 2) return;
  item.chosenIndex = (item.chosenIndex + 1) % item.candidates.length;
  item.selected = true;
  render();
}

/** A candidate image failed to load, or loaded too small to be a real mark. */
function candidateFailed(item: ReviewItem, src: string) {
  if (removeCandidate(item, src)) render();
}

function isTooSmall(img: HTMLImageElement, src: string): boolean {
  if (isVectorSource(src)) return false;
  return img.naturalWidth > 0 && (img.naturalWidth < 48 || img.naturalHeight < 48);
}

/* ------------------------------------------------------------------ *
 * Crop modal
 * ------------------------------------------------------------------ */

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

let cropOpener: HTMLElement | null = null;

function openCropFor(item: ReviewItem) {
  const hit = item.candidates[item.chosenIndex];
  if (!hit) return;
  cropOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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

function focusableWithin(root: HTMLElement): HTMLElement[] {
  const selector = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';
  return [...root.querySelectorAll<HTMLElement>(selector)].filter(
    (node) => !node.hasAttribute("disabled") && node.tabIndex !== -1,
  );
}

type ModalView = { node: HTMLElement; destroy: () => void };

/**
 * Built once per open and torn down on close — every listener it registers on
 * `window`/`document` is removed by `destroy()`, and no re-render can replace
 * the canvas (or the drag state) while the modal is on screen.
 */
function buildCropModal(item: ReviewItem): ModalView {
  const backdrop = el("div", { class: "modal-backdrop" });
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeCrop();
  });

  const modal = el("div", {
    class: "crop-modal",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "crop-modal-title",
  });

  const header = el(
    "div",
    { class: "crop-header" },
    el("h3", { id: "crop-modal-title" }, `Crop & Adjust — ${item.contact.displayName}`),
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

  const onMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    cropState.panX = initialPanX + dx * (512 / 280);
    cropState.panY = initialPanY + dy * (512 / 280);
    drawPreview();
  };
  const onMouseUp = () => {
    isDragging = false;
  };
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);

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
    "aria-label": "Zoom",
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

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeCrop();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = focusableWithin(modal);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (!modal.contains(active)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
      return;
    }
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener("keydown", onKeyDown, true);

  modal.append(header, canvas, controls, actions);
  backdrop.append(modal);

  return {
    node: backdrop,
    destroy() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keydown", onKeyDown, true);
      img.onload = null;
      backdrop.remove();
    },
  };
}

let modalView: ModalView | null = null;

function syncCropModal(root: HTMLElement) {
  if (cropState.item && !modalView) {
    modalView = buildCropModal(cropState.item);
    root.append(modalView.node);
    const focusable = focusableWithin(modalView.node);
    focusable[0]?.focus();
    return;
  }
  if (!cropState.item && modalView) {
    modalView.destroy();
    modalView = null;
    cropOpener?.focus();
    cropOpener = null;
  }
}

/* ------------------------------------------------------------------ *
 * Cards — built once per review item, updated in place afterwards
 * ------------------------------------------------------------------ */

type CardView = { node: HTMLElement; update: () => void };

const cardViews = new Map<ReviewItem, CardView>();

function buildCard(item: ReviewItem): CardView {
  const name = item.contact.displayName;

  const check = el("input", { type: "checkbox" }) as HTMLInputElement;
  check.addEventListener("change", () => {
    item.selected = check.checked;
    render();
  });

  // Decorative: the card name is adjacent text and "Crop" is the keyboard path,
  // so the thumbnail carries no name of its own.
  const thumb = el("img", { class: "thumb", alt: "", "aria-hidden": "true", title: "Click to crop and adjust logo" }) as HTMLImageElement;
  thumb.addEventListener("click", () => openCropFor(item));
  thumb.addEventListener("error", () => {
    const src = thumb.getAttribute("src");
    if (src) candidateFailed(item, src);
  });
  thumb.addEventListener("load", () => {
    const src = thumb.getAttribute("src");
    if (src && isTooSmall(thumb, src)) candidateFailed(item, src);
  });

  const noimg = el("div", { class: "noimg", "aria-hidden": "true" });
  let noimgMode: "unknown" | "empty" | "exhausted" = "unknown";

  const badge = el("span", { class: "confidence-badge" });
  const badgeNote = el("span", { class: "confidence-badge-note" }, GUESSED_DOMAIN_NOTE);
  const nameEl = el("div", { class: "name" }, name);
  const exhaustedLabel = el("p", { class: "exhausted-label" }, "No logo found");
  const meta = el("div", { class: "meta" });
  const alts = el("div", { class: "alts" });
  const altButtons = new Map<string, HTMLButtonElement>();

  function altButtonFor(cand: LogoHit): HTMLButtonElement {
    const cached = altButtons.get(cand.src);
    if (cached) return cached;
    const button = el("button", {
      class: "alts-btn",
      type: "button",
      "aria-label": `Use ${sourceLabel(cand.source)} logo`,
      "aria-pressed": "false",
    });
    const image = el("img", { src: cand.src, alt: "" }) as HTMLImageElement;
    image.addEventListener("error", () => candidateFailed(item, cand.src));
    image.addEventListener("load", () => {
      if (isTooSmall(image, cand.src)) candidateFailed(item, cand.src);
    });
    button.append(image);
    button.addEventListener("click", () => {
      const index = item.candidates.findIndex((c) => c.src === cand.src);
      if (index === -1) return;
      item.chosenIndex = index;
      item.selected = true;
      render();
    });
    altButtons.set(cand.src, button);
    return button;
  }

  const upload = el("input", { type: "file", accept: "image/*", class: "hidden" }) as HTMLInputElement;
  upload.addEventListener("change", () => {
    const file = upload.files?.[0];
    if (file) void uploadFor(item, file);
    upload.value = "";
  });
  const uploadBtn = el("button", { class: "btn secondary", type: "button" }, "Upload");
  uploadBtn.addEventListener("click", () => upload.click());

  const cropBtn = el("button", { class: "btn secondary", type: "button" }, "Crop");
  cropBtn.addEventListener("click", () => openCropFor(item));

  const pasteBtn = el("button", { class: "btn secondary", type: "button" }, "Paste URL");
  pasteBtn.addEventListener("click", () => void pasteUrlFor(item));

  const retry = el("button", { class: "btn secondary", type: "button" }, "Try another");
  retry.addEventListener("click", () => tryAnother(item));

  const skip = el("button", { class: "btn ghost", type: "button" }, "Skip");
  skip.addEventListener("click", () => {
    item.selected = false;
    render();
  });

  const content = el(
    "div",
    { class: "card-content" },
    badge,
    badgeNote,
    nameEl,
    exhaustedLabel,
    meta,
    alts,
    el("div", { class: "actions" }, retry, cropBtn, uploadBtn, pasteBtn, skip, upload),
  );

  const node = el("article", { class: "card" }, check, thumb, noimg, content);

  // Drag-and-drop directly onto this contact card
  node.addEventListener("dragenter", (e) => {
    e.preventDefault();
    node.classList.add("drag-over");
  });
  node.addEventListener("dragover", (e) => {
    e.preventDefault();
    node.classList.add("drag-over");
  });
  node.addEventListener("dragleave", (e) => {
    if (!node.contains(e.relatedTarget as Node)) {
      node.classList.remove("drag-over");
    }
  });
  node.addEventListener("drop", (e) => {
    e.preventDefault();
    node.classList.remove("drag-over");
    const file = e.dataTransfer?.files?.[0];
    if (file && (file.type.startsWith("image/") || file.type === "image/svg+xml")) {
      void uploadFor(item, file);
    }
  });

  function update() {
    const hit = item.candidates[item.chosenIndex];
    const exhausted = isExhaustedItem(item);

    node.className = `card ${item.confidence}${exhausted ? " card--exhausted" : ""}`;

    check.checked = item.selected;
    check.disabled = item.candidates.length === 0;
    check.setAttribute(
      "aria-label",
      check.disabled ? `No logo available for ${name}` : `Apply logo to ${name}`,
    );

    if (hit && thumb.getAttribute("src") !== hit.src) thumb.setAttribute("src", hit.src);
    thumb.className = hit
      ? `thumb${state.showCircleMask ? " circle-mask" : ""} clickable`
      : "thumb hidden";

    noimg.classList.toggle("hidden", Boolean(hit));
    const wantedMode = exhausted ? "exhausted" : "empty";
    if (!hit && noimgMode !== wantedMode) {
      noimgMode = wantedMode;
      noimg.className = exhausted ? "noimg noimg--exhausted" : "noimg";
      if (exhausted) noimg.replaceChildren(noLogoIcon());
      else noimg.replaceChildren("?");
    }

    const badgeCopy = badgeText(item.confidence);
    badge.classList.toggle("hidden", badgeCopy === undefined);
    if (badgeCopy) {
      badge.className = `confidence-badge confidence-badge--${item.confidence}`;
      if (badge.textContent !== badgeCopy) badge.textContent = badgeCopy;
    }
    const showNote = badgeCopy !== undefined && item.flags.includes("guessed-domain");
    badgeNote.classList.toggle("hidden", !showNote);

    exhaustedLabel.classList.toggle("hidden", !exhausted);

    const metaCopy = metaLine(item);
    if (meta.textContent !== metaCopy) meta.textContent = metaCopy;
    meta.classList.toggle("hidden", metaCopy === "");

    const wantedAlts = item.candidates.map(altButtonFor);
    if (!sameChildren(alts, wantedAlts)) alts.replaceChildren(...wantedAlts);
    item.candidates.forEach((cand, i) => {
      const button = altButtons.get(cand.src);
      if (!button) return;
      const on = i === item.chosenIndex;
      button.classList.toggle("on", on);
      button.setAttribute("aria-pressed", String(on));
    });

    retry.disabled = item.candidates.length < 2;
    cropBtn.disabled = !hit;
  }

  return { node, update };
}

/**
 * CL-09 — bound the card-view cache instead of letting it grow to the whole
 * address book.
 *
 * `cardViews` only ever grew: a card built once was kept for the life of the
 * session with its article, listeners, thumbnail and every alternate-image
 * element, so scrolling a long queue walked memory and loaded-image count toward
 * the full contact count — the scale problem the virtualizer exists to avoid.
 *
 * A cap rather than "evict everything not mounted", because reuse is the other
 * half of CL-09: re-rendering must not rebuild visible cards and re-request
 * their logos. Strict eviction breaks that whenever the mounted window comes
 * back empty — a zero-height viewport during first layout, a hidden grid, a
 * filter that matches nothing — by clearing the cache on every paint. Mounted
 * views are never evicted; beyond them the least-recently-used go first, which
 * `cardFor` maintains by re-inserting on a hit.
 */
export function trimViewCache<K, V>(cache: Map<K, V>, mounted: readonly K[], cap: number): number {
  const live = new Set(mounted);
  let evicted = 0;
  for (const key of [...cache.keys()]) {
    if (cache.size <= cap) break;
    if (live.has(key)) continue;
    cache.delete(key);
    evicted += 1;
  }
  return evicted;
}

/** Enough to survive a degenerate measurement without holding a whole book. */
const MIN_CACHED_VIEWS = 60;

/**
 * What each section currently has mounted.
 *
 * `cardViews` is shared by every section but `paint` runs per section, so
 * trimming against one section's window treated the other sections' *attached*
 * views as evictable.  Once the combined windows passed the cap, painting a
 * later section tore down still-visible cards in an earlier one and the next
 * render rebuilt them and re-requested their thumbnails — the repeated network
 * and DOM work the cap was added to stop, now triggered by an ordinary checkbox
 * click.  Trimming against the union fixes that; a view is evictable only when
 * no section has it on screen.
 */
const mountedBySection = new Map<SectionKey, readonly ReviewItem[]>();

function trimSharedViewCache(key: SectionKey, mountedItems: readonly ReviewItem[]): void {
  mountedBySection.set(key, mountedItems);
  const union: ReviewItem[] = [];
  for (const section of mountedBySection.values()) union.push(...section);
  trimViewCache(cardViews, union, Math.max(MIN_CACHED_VIEWS, union.length * 3));
}

function cardFor(item: ReviewItem): HTMLElement {
  let view = cardViews.get(item);
  if (!view) {
    view = buildCard(item);
  } else {
    // Re-insert so Map order is least-recently-used first, which is what
    // `trimViewCache` evicts by.
    cardViews.delete(item);
  }
  cardViews.set(item, view);
  view.update();
  return view.node;
}

function sameChildren(parent: Element, nodes: readonly Element[]): boolean {
  if (parent.children.length !== nodes.length) return false;
  for (let i = 0; i < nodes.length; i += 1) {
    if (parent.children[i] !== nodes[i]) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Virtualized sections
 * ------------------------------------------------------------------ */

const ESTIMATED_ROW_HEIGHT = 260;
const OVERSCAN_ROWS = 2;
let measuredRowHeight = 0;

function maxViewportHeight(): number {
  return Math.max(360, Math.round(window.innerHeight * 0.72));
}

function gridColumns(grid: HTMLElement): number {
  const tracks = getComputedStyle(grid).gridTemplateColumns;
  if (!tracks || tracks === "none") return 1;
  return Math.max(1, tracks.split(" ").filter(Boolean).length);
}

/** A single shared row height keeps every section's scrollbar honest. */
function measureRowHeight(grid: HTMLElement): boolean {
  const first = grid.firstElementChild as HTMLElement | null;
  if (!first) return false;
  const gap = parseFloat(getComputedStyle(grid).rowGap) || 16;
  const height = Math.min(720, Math.round(first.getBoundingClientRect().height + gap));
  if (height <= gap) return false;
  if (height <= measuredRowHeight + 2) return false;
  measuredRowHeight = height;
  return true;
}

type SectionView = {
  node: HTMLElement;
  setItems(items: ReviewItem[]): void;
  repaint(): void;
};

function buildSection(title: string, key: SectionKey): SectionView {
  const heading = el("h2", {}, `${title} (0)`);
  const grid = el("div", { class: "grid" });
  const spacer = el("div", { class: "virtual-list-spacer" }, grid);
  const viewport = el("div", { class: "virtual-list" }, spacer);
  const node = el("section", { class: `section section--${key}` }, heading, viewport);

  let items: ReviewItem[] = [];
  let frame = 0;
  let remeasuring = false;

  function paint() {
    if (node.classList.contains("hidden")) return;
    const columns = gridColumns(grid);
    const rowHeight = measuredRowHeight || ESTIMATED_ROW_HEIGHT;
    const rows = Math.ceil(items.length / columns);
    const totalHeight = rows * rowHeight;
    const height = Math.min(totalHeight, maxViewportHeight());
    viewport.style.height = `${height}px`;
    spacer.style.height = `${totalHeight}px`;

    const slice = visibleSlice(items.length, columns, rowHeight, viewport.scrollTop, height, OVERSCAN_ROWS);
    grid.style.transform = `translateY(${slice.offsetY}px)`;
    const mountedItems = items.slice(slice.start, slice.end);
    const mounted = mountedItems.map(cardFor);
    if (!sameChildren(grid, mounted)) grid.replaceChildren(...mounted);
    trimSharedViewCache(key, mountedItems);

    if (!remeasuring && measureRowHeight(grid)) {
      remeasuring = true;
      paint();
      remeasuring = false;
    }
  }

  function schedulePaint() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      paint();
    });
  }

  viewport.addEventListener("scroll", schedulePaint, { passive: true });

  return {
    node,
    setItems(next) {
      items = next;
      heading.textContent = `${title} (${next.length})`;
      if (viewport.scrollTop > 0 && next.length === 0) viewport.scrollTop = 0;
      paint();
    },
    repaint: schedulePaint,
  };
}

/* ------------------------------------------------------------------ *
 * Shell — built once, then updated in place
 * ------------------------------------------------------------------ */

type Shell = {
  root: HTMLElement;
  settings: HTMLElement;
  settingsInput: HTMLInputElement;
  landing: HTMLElement;
  notice: HTMLElement;
  review: HTMLElement;
  searchInput: HTMLInputElement;
  maskCheckbox: HTMLInputElement;
  chips: Map<FilterStatus, HTMLButtonElement>;
  stats: Record<"ready" | "review" | "nonbrand" | "notfound" | "people", HTMLElement>;
  approvedBtn: HTMLButtonElement;
  exportFullBtn: HTMLButtonElement;
  googleSyncBtn: HTMLButtonElement;
  sections: Record<SectionKey, SectionView>;
};

let shell: Shell | null = null;

const CHIP_LABELS: [FilterStatus, string][] = [
  ["all", "All"],
  ["ready", "Ready to apply"],
  ["review", "Needs review"],
  ["notfound", "Not found"],
  ["missingphoto", "Missing photo"],
];

function buildSettingsPanel(): { node: HTMLElement; input: HTMLInputElement } {
  const input = el("input", {
    type: "text",
    class: "settings-input",
    placeholder: "Google OAuth client id",
    value: getGoogleClientId(),
    autocomplete: "off",
    "aria-label": "Google OAuth client id",
  }) as HTMLInputElement;
  const save = el("button", { class: "btn secondary", type: "button" }, "Save");
  save.addEventListener("click", () => {
    setGoogleClientId(input.value);
    state.notice = "Saved Google client id in this browser.  Contacts are still not stored.";
    state.showSettings = false;
    render();
  });
  const node = el(
    "div",
    { class: "settings hidden" },
    el("h2", {}, "Settings"),
    el(
      "p",
      { class: "meta" },
      "Optional Google People API client id for Import and Direct Sync to Google Contacts.  Stored only in this browser.",
    ),
    input,
    save,
  );
  return { node, input };
}

function buildLanding(): HTMLElement {
  const what = el(
    "section",
    { class: "section" },
    el("h2", {}, "Every business in your contacts, with its real logo"),
    el(
      "p",
      {},
      "Your address book is full of grey initial circles.  ContactLogo finds the official mark for each business card in it — the pharmacy, the bank, the school, the plumber — so calls, messages and mail arrive with a face you recognise instead of two letters.",
    ),
    el(
      "p",
      { class: "meta" },
      "People are left alone.  Contacts with a first or last name are never given a company logo, and a photo you already chose is never overwritten without you ticking the box.",
    ),
  );

  const how = el(
    "section",
    { class: "section" },
    el("h2", {}, "How it works"),
    el(
      "ol",
      {},
      el(
        "li",
        {},
        el("strong", {}, "Import. "),
        "Drop in a vCard or Google CSV export, connect Google Contacts, or pick straight from this phone.",
      ),
      el(
        "li",
        {},
        el("strong", {}, "Review. "),
        "Every match is scored.  Clear, square, official marks come pre-checked; guesses, look-alike names and existing photos wait for your glance.  Each card offers other candidates, your own upload, a pasted image, and a crop tool.",
      ),
      el(
        "li",
        {},
        el("strong", {}, "Apply. "),
        "Download a small file containing only the contacts you approved, export the whole address book, or push the approved photos straight to Google Contacts.",
      ),
    ),
  );

  const promise = el(
    "section",
    { class: "section" },
    el("h2", {}, "Nothing changes without your approval"),
    el(
      "p",
      {},
      "There is no automatic apply.  A logo reaches your address book only after you tick its box and press the download or sync button — and one click saves an untouched copy of the original first, so you can always go back.",
    ),
    el("h2", {}, "Your contacts stay in this browser"),
    el(
      "p",
      {},
      "The address book is read and matched on this device.  It is never uploaded to a server, never stored between visits, and closing the tab leaves nothing behind.  Logo images are fetched from public brand sources by domain name only.",
    ),
    el(
      "p",
      { class: "meta" },
      "A wrong logo is worse than none.  Generic names like “Hospital” or “Gift Card”, and names that double as ordinary words, are never matched automatically.",
    ),
  );

  return el("div", {}, what, how, promise);
}

function mountShell(root: HTMLElement): Shell {
  if (shell && shell.root === root && root.firstChild) return shell;

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

  const settings = buildSettingsPanel();
  app.append(settings.node);

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
  const importActions: HTMLElement[] = [pick, google];
  if (canPickDeviceContacts()) {
    const device = el("button", { class: "btn secondary", type: "button" }, "Import from this phone");
    device.addEventListener("click", () => void importFromDevice());
    importActions.push(device);
  }

  const drop = el(
    "div",
    { class: "drop" },
    el("div", {}, el("strong", {}, "Import an address book"), el("span", {}, "Contacts stay in this browser.  Nothing is uploaded to a server.")),
    ...importActions,
    file,
  );
  drop.addEventListener("dragover", (e) => e.preventDefault());
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files[0];
    if (f) void importFile(f);
  });
  app.append(drop);

  const notice = el("p", {
    class: "meta notice-banner hidden",
    role: "status",
    "aria-live": "polite",
    "aria-atomic": "true",
  });
  app.append(notice);

  const landing = buildLanding();
  app.append(landing);

  // ---- review stage ------------------------------------------------
  const review = el("div", { class: "hidden" });

  const searchInput = el("input", {
    type: "search",
    class: "search-input",
    placeholder: "Search contacts by brand, domain, phone…",
    "aria-label": "Search contacts",
  }) as HTMLInputElement;
  searchInput.addEventListener("input", () => {
    state.searchQuery = searchInput.value;
    render();
  });

  const maskCheckbox = el("input", { type: "checkbox" }) as HTMLInputElement;
  maskCheckbox.checked = state.showCircleMask;
  maskCheckbox.addEventListener("change", () => {
    state.showCircleMask = maskCheckbox.checked;
    render();
  });
  const maskToggle = el("label", { class: "mask-toggle" }, maskCheckbox, el("span", {}, "Circle mask preview"));
  review.append(el("div", { class: "search-bar" }, searchInput, maskToggle));

  const chips = new Map<FilterStatus, HTMLButtonElement>();
  const chipRow = el("div", { class: "filter-chips", role: "group", "aria-label": "Filter contacts by status" });
  for (const [value, label] of CHIP_LABELS) {
    const chip = el("button", {
      class: "chip",
      type: "button",
      "data-filter": value,
      "aria-pressed": String(state.filterStatus === value),
    }, label);
    chip.addEventListener("click", () => {
      state.filterStatus = value;
      render();
    });
    chips.set(value, chip);
    chipRow.append(chip);
  }
  review.append(chipRow);

  const statValue = () => el("b", {}, "0");
  const stats = {
    ready: statValue(),
    review: statValue(),
    nonbrand: statValue(),
    notfound: statValue(),
    people: statValue(),
  };
  review.append(
    el(
      "div",
      { class: "stats" },
      el("div", { class: "stat high" }, stats.ready, " Ready to apply"),
      el("div", { class: "stat medium" }, stats.review, " Needs review"),
      el("div", { class: "stat skip" }, stats.nonbrand, " Not a brand"),
      el("div", { class: "stat skip" }, stats.notfound, " Not found"),
      el("div", { class: "stat" }, stats.people, " People left alone"),
    ),
  );

  const selectHigh = el("button", { class: "btn secondary", type: "button" }, "Select all high-confidence");
  selectHigh.addEventListener("click", () => setAllHigh(true));
  const clearHigh = el("button", { class: "btn ghost", type: "button" }, "Clear high-confidence");
  clearHigh.addEventListener("click", () => setAllHigh(false));

  const approvedBtn = el("button", {
    class: "btn",
    type: "button",
    title: "Export ONLY modified business contacts as a delta vCard to safely import into Apple Contacts without touching other cards",
  }, "Download 0 Approved Updates");
  approvedBtn.addEventListener("click", () => void downloadApproved());

  const exportFullBtn = el("button", {
    class: "btn secondary",
    type: "button",
    title: "Export full address book with all contacts merged",
  }, "Export full address book (0)");
  exportFullBtn.addEventListener("click", () => void downloadFull());

  const backup = el(
    "button",
    { class: "btn ghost", type: "button", title: "Download untouched original address book backup" },
    "Download backup",
  );
  backup.addEventListener("click", downloadBackup);

  const googleSyncBtn = el("button", { class: "btn secondary google-sync-btn hidden", type: "button" }, "⚡ Apply to Google Contacts");
  googleSyncBtn.addEventListener("click", () => void syncToGoogleContacts());

  review.append(el("div", { class: "toolbar" }, selectHigh, clearHigh, approvedBtn, exportFullBtn, backup, googleSyncBtn));

  const sections: Record<SectionKey, SectionView> = {
    ready: buildSection("Ready to apply", "ready"),
    review: buildSection("Needs review", "review"),
    nonbrand: buildSection("Not a brand", "nonbrand"),
    notfound: buildSection("Not found", "notfound"),
  };
  for (const key of ["ready", "review", "nonbrand", "notfound"] as SectionKey[]) {
    review.append(sections[key].node);
  }
  app.append(review);

  app.append(
    el(
      "p",
      { class: "footer" },
      "Review-first: clear, official marks are pre-checked; guessed domains, favicons and photos you already have wait for your review.  The Mac and iPhone apps follow the same rules.",
    ),
  );

  root.append(app);

  const built: Shell = {
    root,
    settings: settings.node,
    settingsInput: settings.input,
    landing,
    notice,
    review,
    searchInput,
    maskCheckbox,
    chips,
    stats,
    approvedBtn,
    exportFullBtn,
    googleSyncBtn,
    sections,
  };
  shell = built;

  window.addEventListener("resize", () => {
    for (const key of ["ready", "review", "nonbrand", "notfound"] as SectionKey[]) {
      built.sections[key].repaint();
    }
  });

  return built;
}

function syncShell(s: Shell) {
  s.settings.classList.toggle("hidden", !state.showSettings);
  if (state.showSettings && s.settingsInput.value !== getGoogleClientId() && document.activeElement !== s.settingsInput) {
    s.settingsInput.value = getGoogleClientId();
  }

  if (s.notice.textContent !== state.notice) s.notice.textContent = state.notice;
  s.notice.classList.toggle("hidden", state.notice === "");

  const reviewing = state.stage === "review";
  s.landing.classList.toggle("hidden", reviewing);
  s.review.classList.toggle("hidden", !reviewing);
  if (!reviewing) return;

  if (s.searchInput.value !== state.searchQuery) s.searchInput.value = state.searchQuery;
  if (s.maskCheckbox.checked !== state.showCircleMask) s.maskCheckbox.checked = state.showCircleMask;

  for (const [value, chip] of s.chips) {
    const on = state.filterStatus === value;
    chip.setAttribute("aria-pressed", String(on));
    chip.classList.toggle("chip--active", on);
  }

  const groups = partitionSections(state.items);
  s.stats.ready.textContent = String(groups.ready.length);
  s.stats.review.textContent = String(groups.review.length);
  s.stats.nonbrand.textContent = String(groups.nonbrand.length);
  s.stats.notfound.textContent = String(groups.notfound.length);
  s.stats.people.textContent = String(peopleCount);

  const approved = selectedCount();
  const approvedLabel = `Download ${approved} Approved Update${approved === 1 ? "" : "s"}`;
  if (s.approvedBtn.textContent !== approvedLabel) s.approvedBtn.textContent = approvedLabel;
  const fullLabel = `Export full address book (${state.contacts.length})`;
  if (s.exportFullBtn.textContent !== fullLabel) s.exportFullBtn.textContent = fullLabel;
  s.googleSyncBtn.classList.toggle("hidden", !hasGoogleContacts);

  const narrowed = state.searchQuery.trim() !== "" || state.filterStatus !== "all";
  for (const key of ["ready", "review", "nonbrand", "notfound"] as SectionKey[]) {
    const visible = filterItems(groups[key], state.searchQuery, state.filterStatus);
    s.sections[key].node.classList.toggle("hidden", visible.length === 0 && narrowed);
    s.sections[key].setItems(visible);
  }
}

export function render() {
  const root = document.getElementById("app");
  if (!root) return;
  const s = mountShell(root);
  syncShell(s);
  syncCropModal(root);
}
