const GOOGLE_KEY = "contactlogo.googleClientId";
const BRANDFETCH_KEY = "contactlogo.brandfetchClientId";
const LOGODEV_KEY = "contactlogo.logodevToken";

/** Session-only fallback when localStorage refuses a write — native analog of SettingsStore.credentialStorageFailed. */
const sessionFallback = new Map<string, string>();
let storageFailed = false;

export function didCredentialStorageFail(): boolean {
  return storageFailed;
}

function readEnv(name: string): string {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const fromProc = proc?.env?.[name] ?? proc?.env?.[`VITE_${name}`];
  if (fromProc) return String(fromProc).trim();
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const fromVite = viteEnv?.[name] ?? viteEnv?.[`VITE_${name}`];
  return String(fromVite ?? "").trim();
}

function readStored(key: string): string {
  const live = sessionFallback.get(key);
  if (live) return live;
  if (typeof localStorage === "undefined") return "";
  try {
    return localStorage.getItem(key)?.trim() ?? "";
  } catch {
    storageFailed = true;
    return "";
  }
}

function writeStored(key: string, value: string): boolean {
  const trimmed = value.trim();
  if (typeof localStorage === "undefined") {
    sessionFallback.set(key, trimmed);
    return false;
  }
  try {
    if (trimmed) localStorage.setItem(key, trimmed);
    else localStorage.removeItem(key);
    sessionFallback.delete(key);
    storageFailed = false;
    return true;
  } catch {
    storageFailed = true;
    sessionFallback.set(key, trimmed);
    return false;
  }
}

export function getGoogleClientId(): string {
  return readStored(GOOGLE_KEY) || readEnv("GOOGLE_CONTACTS_CLIENT_ID") || readEnv("VITE_GOOGLE_CONTACTS_CLIENT_ID");
}

export function setGoogleClientId(value: string): boolean {
  return writeStored(GOOGLE_KEY, value);
}

/** Brandfetch Logo Link CDN client id (`?c=`). */
export function getBrandfetchClientId(): string {
  return readStored(BRANDFETCH_KEY) || readEnv("BRANDFETCH_CLIENT_ID") || readEnv("VITE_BRANDFETCH_CLIENT_ID");
}

export function setBrandfetchClientId(value: string): boolean {
  return writeStored(BRANDFETCH_KEY, value);
}

/** Logo.dev image CDN token (`?token=`). */
export function getLogoDevToken(): string {
  return readStored(LOGODEV_KEY) || readEnv("LOGODEV_TOKEN") || readEnv("VITE_LOGODEV_TOKEN");
}

export function setLogoDevToken(value: string): boolean {
  return writeStored(LOGODEV_KEY, value);
}

export function hasHdLogoKeys(): boolean {
  return Boolean(getBrandfetchClientId() || getLogoDevToken());
}
