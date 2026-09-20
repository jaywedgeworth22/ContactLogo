import type { BookContact } from "./classify.ts";
import { getGoogleClientId } from "./settings.ts";

const CONTACTS_READ_SCOPE = "https://www.googleapis.com/auth/contacts.readonly";
const CONTACTS_WRITE_SCOPE = "https://www.googleapis.com/auth/contacts";
const PERSON_FIELDS = "names,emailAddresses,phoneNumbers,organizations,urls,photos";

type TokenClient = {
  requestAccessToken: (opts?: { prompt?: string }) => void;
};

type GisOauth = {
  initTokenClient: (cfg: {
    client_id: string;
    scope: string;
    callback: (resp: { access_token?: string; error?: string; error_description?: string }) => void;
    error_callback?: (err: { type?: string; message?: string }) => void;
  }) => TokenClient;
};

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GisOauth } };
  }
}

let cachedAccessToken: string | null = null;
let tokenHasWriteScope = false;

function loadGis(): Promise<GisOauth> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google.accounts.oauth2);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-contactlogo-gis]");
    if (existing) {
      existing.addEventListener("load", () => {
        const api = window.google?.accounts?.oauth2;
        if (api) resolve(api);
        else reject(new Error("Google sign-in failed to load"));
      });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.contactlogoGis = "1";
    script.onload = () => {
      const api = window.google?.accounts?.oauth2;
      if (api) resolve(api);
      else reject(new Error("Google sign-in failed to load"));
    };
    script.onerror = () => reject(new Error("Could not reach Google sign-in"));
    document.head.appendChild(script);
  });
}

export async function requestAccessToken(clientId: string, requireWrite = false): Promise<string> {
  if (cachedAccessToken && (!requireWrite || tokenHasWriteScope)) {
    return cachedAccessToken;
  }
  const oauth = await loadGis();
  const scope = requireWrite ? CONTACTS_WRITE_SCOPE : CONTACTS_READ_SCOPE;
  return new Promise((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: clientId,
      scope,
      callback: (resp) => {
        if (resp.access_token) {
          cachedAccessToken = resp.access_token;
          tokenHasWriteScope = requireWrite;
          resolve(resp.access_token);
        } else {
          reject(new Error(resp.error_description || resp.error || "Google access was denied"));
        }
      },
      error_callback: (err) => {
        reject(new Error(err.message || "Google sign-in was cancelled"));
      },
    });
    client.requestAccessToken({ prompt: requireWrite ? "consent" : "" });
  });
}

/**
 * docs/ENGINE-CONTRACT.md R11.6 — retry a rate-limited (429) request with
 * exponential backoff and full jitter: base 500ms, doubling, 4 attempts,
 * cap 8s, honoring `Retry-After` when present and larger than the computed
 * wait. A 429 that survives every attempt is returned as-is so the caller's
 * existing `!res.ok` handling still surfaces it — retries make 429 rarer,
 * they must never make it silent.
 */
const RETRY_BASE_MS = 500;
const RETRY_MAX_ATTEMPTS = 4;
const RETRY_CAP_MS = 8000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const when = Date.parse(header);
  return Number.isNaN(when) ? undefined : Math.max(0, when - Date.now());
}

async function fetchWithRetry(input: string | URL, init?: RequestInit): Promise<Response> {
  let attempt = 0;
  for (;;) {
    const res = await fetch(input, init);
    if (res.status !== 429 || attempt >= RETRY_MAX_ATTEMPTS - 1) return res;
    const computed = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** attempt);
    const jittered = Math.random() * computed;
    const retryAfterMs = parseRetryAfterMs(res.headers.get("Retry-After"));
    const waitMs = retryAfterMs !== undefined && retryAfterMs > jittered ? Math.min(retryAfterMs, RETRY_CAP_MS) : jittered;
    await sleep(waitMs);
    attempt += 1;
  }
}

export type Person = {
  resourceName?: string;
  names?: Array<{ displayName?: string; givenName?: string; familyName?: string }>;
  emailAddresses?: Array<{ value?: string; type?: string }>;
  phoneNumbers?: Array<{ value?: string; type?: string }>;
  organizations?: Array<{ name?: string }>;
  urls?: Array<{ value?: string; type?: string }>;
  photos?: Array<{ url?: string; default?: boolean }>;
};

/**
 * 2026-09-20 audit — order labels work > school > home > iCloud > undefined
 * so the brand-relevant inbox (work) wins over the personal one when the
 * same contact lists both.  Previously the first-listed email was used,
 * which is usually the personal one — the whole contact was then mis-
 * attributed.
 */
function preferredLabelScore(type: string | undefined): number {
  const t = (type ?? "").toLowerCase();
  if (t === "work") return 0;
  if (t.startsWith("work_")) return 0;
  if (t === "school") return 2;
  if (t === "home") return 3;
  if (t.startsWith("home_")) return 3;
  return 1; // undefined / iCloud / other
}

/**
 * Not a real expectation of the address book's size — a sanity backstop
 * against an API bug that never stops returning `nextPageToken` (e.g. a
 * cycle). 200,000 contacts is far past any real personal or org address
 * book. If it is ever hit, that is reported to the caller as an error
 * (CL-10) rather than silently truncating the import the way the old
 * `page < 12` cap did.
 */
const MAX_CONNECTION_PAGES = 200;

export async function fetchConnections(token: string, onProgress?: (n: number) => void): Promise<Person[]> {
  const people: Person[] = [];
  let pageToken = "";
  let page = 0;
  for (;;) {
    if (page >= MAX_CONNECTION_PAGES) {
      throw new Error(
        `Google Contacts import stopped after ${people.length.toLocaleString()} contacts (${MAX_CONNECTION_PAGES} pages) — more remain on the account. This is a safety limit, not expected; please report it.`,
      );
    }
    const url = new URL("https://people.googleapis.com/v1/people/me/connections");
    url.searchParams.set("personFields", PERSON_FIELDS);
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("sortOrder", "LAST_MODIFIED_DESCENDING");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      if (res.status === 403) throw new Error("Google did not allow Contacts access.");
      if (res.status === 429) throw new Error("Google Contacts is rate-limiting this import; wait a moment and try again.");
      throw new Error(`Could not read Google Contacts (HTTP ${res.status})`);
    }
    const data = (await res.json()) as { connections?: Person[]; nextPageToken?: string };
    people.push(...(data.connections ?? []));
    onProgress?.(people.length);
    page += 1;
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return people;
}

export function personToBookContact(person: Person): BookContact | null {
  const primary = person.names?.[0];
  const organization = person.organizations?.[0]?.name?.trim();
  const name = primary?.displayName?.trim() || organization;
  if (!name) return null;
  const photo = person.photos?.find((p) => p.url && !p.default);
  type LabeledString = { value: string; type: string | undefined; idx: number };
  const rawEmails: LabeledString[] = (person.emailAddresses ?? [])
    .map((e, idx): LabeledString => ({ value: e.value?.trim() ?? "", type: e.type, idx }))
    .filter((e) => Boolean(e.value));
  const rawWebsites: LabeledString[] = (person.urls ?? [])
    .map((u, idx): LabeledString => ({ value: u.value?.trim() ?? "", type: u.type, idx }))
    .filter((u) => Boolean(u.value));
  // Tie on label score → keep original declaration order.  Otherwise
  // unlabeled entries get alphabetized and "agencies" with mixed types
  // silently reorder.
  const sortedEmails = [...rawEmails].sort(
    (a, b) => preferredLabelScore(a.type) - preferredLabelScore(b.type) || a.idx - b.idx,
  );
  const sortedWebsites = [...rawWebsites].sort(
    (a, b) => preferredLabelScore(a.type) - preferredLabelScore(b.type) || a.idx - b.idx,
  );
  const emails = sortedEmails.map((e) => e.value);
  const websites = sortedWebsites.map((u) => u.value);
  const phones = person.phoneNumbers
    ?.map((p) => p.value?.trim())
    .filter((v): v is string => Boolean(v));

  return {
    id: crypto.randomUUID(),
    displayName: name,
    givenName: primary?.givenName,
    familyName: primary?.familyName,
    organization,
    email: emails[0],
    phone: phones?.[0] ?? person.phoneNumbers?.[0]?.value,
    website: websites[0],
    emails: emails.length > 0 ? emails : undefined,
    phones: phones && phones.length > 0 ? phones : undefined,
    websites: websites.length > 0 ? websites : undefined,
    photoDataUrl: photo?.url,
    hadExistingPhoto: Boolean(photo),
    existingPhotoUrl: photo?.url,
    importSource: "google",
    googleResourceName: person.resourceName,
  };
}

export async function importGoogleContacts(onProgress?: (n: number) => void): Promise<BookContact[]> {
  const clientId = getGoogleClientId();
  if (!clientId) {
    throw new Error("GOOGLE_CONTACTS_NOT_CONFIGURED");
  }
  const token = await requestAccessToken(clientId, false);
  const people = await fetchConnections(token, onProgress);
  return people.map(personToBookContact).filter((c): c is BookContact => Boolean(c));
}

function encodeResourceName(resourceName: string): string {
  return resourceName
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

/** Update contact photo in Google People API */
export async function updateGoogleContactPhoto(
  resourceName: string,
  photoDataUrlOrBase64: string,
  token: string,
): Promise<void> {
  const base64Data = photoDataUrlOrBase64.includes(",")
    ? photoDataUrlOrBase64.split(",")[1]
    : photoDataUrlOrBase64;
  const url = `https://people.googleapis.com/v1/${encodeResourceName(resourceName)}:updateContactPhoto`;
  // Bulk photo sync walks every selected contact sequentially; on a large
  // book the People API 429s partway through (CL-10). fetchWithRetry backs
  // off and retries in place so a transient rate limit doesn't fail the
  // contact outright; a 429 that survives every attempt still surfaces here
  // as a per-contact error, which callers already catch per-item.
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ photoBytes: base64Data }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Failed to update photo for ${resourceName}: ${res.status} ${errText}`);
  }
}

/** Delete contact photo in Google People API */
export async function deleteGoogleContactPhoto(
  resourceName: string,
  token: string,
): Promise<void> {
  const url = `https://people.googleapis.com/v1/${encodeResourceName(resourceName)}:deleteContactPhoto`;
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok && res.status !== 404) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Failed to delete photo for ${resourceName}: ${res.status} ${errText}`);
  }
}

export type GoogleSyncUndoRecord = {
  resourceName: string;
  displayName: string;
  hadExistingPhoto: boolean;
  priorPhotoDataUrl?: string;
};

export type GoogleSyncUndoBatch = {
  id: string;
  timestamp: number;
  records: GoogleSyncUndoRecord[];
};

export const GOOGLE_UNDO_KEY = "contactlogo.googleSyncUndo";

function openUndoDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      return reject(new Error("IndexedDB unavailable"));
    }
    const req = indexedDB.open("contactlogo_db", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("google_sync_undo")) {
        db.createObjectStore("google_sync_undo", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

export async function saveGoogleSyncUndoBatch(batch: GoogleSyncUndoBatch): Promise<void> {
  try {
    const db = await openUndoDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("google_sync_undo", "readwrite");
      const store = tx.objectStore("google_sync_undo");
      store.clear();
      store.put({ ...batch, id: "latest" });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // IndexedDB unavailable or error
  }

  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(GOOGLE_UNDO_KEY, JSON.stringify(batch));
    } catch {
      try {
        const metadataOnly: GoogleSyncUndoBatch = {
          id: batch.id,
          timestamp: batch.timestamp,
          records: batch.records.map((r) => ({
            resourceName: r.resourceName,
            displayName: r.displayName,
            hadExistingPhoto: r.hadExistingPhoto,
          })),
        };
        localStorage.setItem(GOOGLE_UNDO_KEY, JSON.stringify(metadataOnly));
      } catch {
        // ignore storage quota error
      }
    }
  }
}

export async function getLatestGoogleSyncUndoBatch(): Promise<GoogleSyncUndoBatch | null> {
  try {
    const db = await openUndoDb();
    const batch = await new Promise<GoogleSyncUndoBatch | null>((resolve, reject) => {
      const tx = db.transaction("google_sync_undo", "readonly");
      const store = tx.objectStore("google_sync_undo");
      const req = store.get("latest");
      req.onsuccess = () => resolve((req.result as GoogleSyncUndoBatch) ?? null);
      req.onerror = () => reject(req.error);
    });
    if (batch && batch.records?.length > 0) return batch;
  } catch {
    // fall through to localStorage
  }

  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(GOOGLE_UNDO_KEY);
      if (raw) {
        return JSON.parse(raw) as GoogleSyncUndoBatch;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export async function clearGoogleSyncUndoBatch(): Promise<void> {
  try {
    const db = await openUndoDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("google_sync_undo", "readwrite");
      const store = tx.objectStore("google_sync_undo");
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }

  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(GOOGLE_UNDO_KEY);
    } catch {
      // ignore
    }
  }
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader !== "undefined") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const type = blob.type || "image/jpeg";
  return `data:${type};base64,${btoa(binary)}`;
}

/** People API hosts accept the OAuth bearer.  Photo CDNs do not, and a
 *  cross-origin `Authorization` header forces a CORS preflight that
 *  `lh3.googleusercontent.com` rejects — so the snapshot fetch fails
 *  and the caller used to overwrite the portrait with no undo bytes.
 */
function shouldAttachGoogleToken(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "googleapis.com" || host.endsWith(".googleapis.com");
  } catch {
    return false;
  }
}

export function isUndoablePriorPhoto(priorPhotoDataUrl?: string): boolean {
  return Boolean(priorPhotoDataUrl?.startsWith("data:") && priorPhotoDataUrl.includes(","));
}

/**
 * Bytes we can hand back to `:updateContactPhoto`.  Prefer an in-memory
 * data URL (the card after a previous apply).  Otherwise fetch the
 * People API photo URL.  `undefined` means the contact has a photo we
 * could not snapshot — the caller MUST skip the write.
 */
export async function snapshotPriorGooglePhoto(
  contact: {
    hadExistingPhoto?: boolean;
    existingPhotoUrl?: string;
    photoDataUrl?: string;
  },
  token: string,
): Promise<string | undefined> {
  if (!contact.hadExistingPhoto) return undefined;
  if (isUndoablePriorPhoto(contact.photoDataUrl)) return contact.photoDataUrl;
  if (contact.existingPhotoUrl) {
    const fetched = await fetchPhotoAsDataUrl(contact.existingPhotoUrl, token);
    if (isUndoablePriorPhoto(fetched)) return fetched;
  }
  return undefined;
}

export async function fetchPhotoAsDataUrl(url: string, token?: string): Promise<string | undefined> {
  try {
    const headers: Record<string, string> = {};
    if (token && shouldAttachGoogleToken(url)) headers.Authorization = `Bearer ${token}`;
    const res = await fetchWithRetry(url, { headers });
    if (!res.ok) return undefined;
    const blob = await res.blob();
    const dataUrl = await blobToDataUrl(blob);
    return isUndoablePriorPhoto(dataUrl) ? dataUrl : undefined;
  } catch {
    return undefined;
  }
}

export async function undoGooglePhotoSync(
  token: string,
  batch?: GoogleSyncUndoBatch | null,
  onProgress?: (done: number, total: number, name: string) => void,
): Promise<{ restored: number; failed: number }> {
  const currentBatch = batch ?? (await getLatestGoogleSyncUndoBatch());
  if (!currentBatch || currentBatch.records.length === 0) {
    return { restored: 0, failed: 0 };
  }

  let restored = 0;
  let failed = 0;
  const total = currentBatch.records.length;

  for (const record of currentBatch.records) {
    onProgress?.(restored + failed + 1, total, record.displayName);
    try {
      if (record.hadExistingPhoto && isUndoablePriorPhoto(record.priorPhotoDataUrl)) {
        await updateGoogleContactPhoto(record.resourceName, record.priorPhotoDataUrl!, token);
        restored += 1;
      } else if (!record.hadExistingPhoto) {
        await deleteGoogleContactPhoto(record.resourceName, token);
        restored += 1;
      } else {
        // Had existing photo but no prior data URL was captured
        failed += 1;
      }
    } catch {
      failed += 1;
    }
  }

  // Native undo keeps the log when restore fails so Retry still has bytes.
  // Clearing here made a CORS-failed snapshot permanently unrestorable.
  if (failed === 0) {
    await clearGoogleSyncUndoBatch();
  }
  return { restored, failed };
}
