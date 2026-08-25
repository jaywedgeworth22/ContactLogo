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

function applySelected(): BookContact[] {
  const byId = new Map(state.contacts.map((c) => [c.id, { ...c }]));
  for (const item of state.items) {
    if (!item.selected) continue;
    const hit = item.candidates[item.chosenIndex];
    if (!hit) continue;
    const next = byId.get(item.contact.id);
    if (next) next.photoDataUrl = hit.src;
  }
  return [...byId.values()];
}

function downloadBackup() {
  downloadText(backupFilename(), contactsToVcard(state.contacts), "text/vcard;charset=utf-8");
}

async function downloadUpdated() {
  state.notice = "Embedding and formatting approved logos…";
  render();
  const updated = applySelected();
  for (const contact of updated) {
    if (contact.photoDataUrl) {
      const embedded = await embedSrc(contact.photoDataUrl);
      contact.photoDataUrl = await padAndSquareImage(embedded);
    }
  }
  downloadText("contactlogo-contacts.vcf", contactsToVcard(updated), "text/vcard;charset=utf-8");
  state.notice = "Download started.  Import the vCard back into your address book.";
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

function card(item: ReviewItem): HTMLElement {
  const hit = item.candidates[item.chosenIndex];
  const thumbClass = `thumb${state.showCircleMask ? " circle-mask" : ""}`;
  const thumb = hit
    ? el("img", { class: thumbClass, src: hit.src, alt: item.contact.displayName })
    : el("div", { class: "noimg" }, "?");
  const check = el("input", { type: "checkbox" }) as HTMLInputElement;
  check.checked = item.selected;
  check.disabled = item.candidates.length === 0;
  check.addEventListener("change", () => {
    item.selected = check.checked;
  });

  const alts = el("div", { class: "alts" });
  item.candidates.forEach((cand, i) => {
    const b = el("button", { class: i === item.chosenIndex ? "on" : "", type: "button" });
    b.append(el("img", { src: cand.src, alt: cand.source }));
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
  return el(
    "article",
    { class: `card ${item.confidence}` },
    check,
    thumb,
    el(
      "div",
      {},
      el("div", { class: "name" }, item.contact.displayName),
      el(
        "div",
        { class: "meta" },
        `${item.confidence} · ${source}${via ? ` · ${via}` : ""}${item.flags.length ? ` · ${item.flags.join(", ")}` : ""}`,
      ),
      alts,
      el("div", { class: "actions" }, retry, uploadBtn, pasteBtn, skip, upload),
    ),
  );
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
    const backup = el("button", { class: "btn secondary", type: "button" }, "Download backup");
    backup.addEventListener("click", downloadBackup);
    const save = el("button", { class: "btn", type: "button" }, "Download approved vCard");
    save.addEventListener("click", () => void downloadUpdated());

    const toolbarItems = [selectHigh, clearHigh, backup, save];
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
}

