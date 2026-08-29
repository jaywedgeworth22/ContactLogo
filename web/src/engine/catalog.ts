/** Offline name → domain table ported from `vendor/crest/src/lib/contacts.ts`. */

import { companyKey, isOrgSignalWord, GEO_WORDS_LITERAL } from "./normalize.ts";

const DOMAINS: Record<string, string> = {
  apple: "apple.com",
  "apple inc": "apple.com",
  google: "google.com",
  alphabet: "abc.xyz",
  microsoft: "microsoft.com",
  amazon: "amazon.com",
  meta: "meta.com",
  facebook: "facebook.com",
  instagram: "instagram.com",
  tesla: "tesla.com",
  nvidia: "nvidia.com",
  netflix: "netflix.com",
  spotify: "spotify.com",
  adobe: "adobe.com",
  salesforce: "salesforce.com",
  oracle: "oracle.com",
  ibm: "ibm.com",
  intel: "intel.com",
  cisco: "cisco.com",
  stripe: "stripe.com",
  paypal: "paypal.com",
  visa: "visa.com",
  mastercard: "mastercard.com",
  "american express": "americanexpress.com",
  amex: "americanexpress.com",
  chase: "chase.com",
  jpmorgan: "jpmorganchase.com",
  "jp morgan": "jpmorganchase.com",
  "jpmorgan chase": "jpmorganchase.com",
  "bank of america": "bankofamerica.com",
  "wells fargo": "wellsfargo.com",
  citi: "citi.com",
  citibank: "citi.com",
  citigroup: "citi.com",
  geico: "geico.com",
  "state farm": "statefarm.com",
  "state farm insurance": "statefarm.com",
  allstate: "allstate.com",
  "allstate insurance": "allstate.com",
  usaa: "usaa.com",
  "usaa insurance": "usaa.com",
  verizon: "verizon.com",
  "at&t": "att.com",
  att: "att.com",
  "t-mobile": "t-mobile.com",
  tmobile: "t-mobile.com",
  "united airlines": "united.com",
  united: "united.com",
  "american airlines": "aa.com",
  delta: "delta.com",
  "delta air lines": "delta.com",
  "delta airlines": "delta.com",
  southwest: "southwest.com",
  "southwest airlines": "southwest.com",
  jetblue: "jetblue.com",
  "alaska airlines": "alaskaair.com",
  fedex: "fedex.com",
  ups: "ups.com",
  usps: "usps.com",
  "the home depot": "homedepot.com",
  "home depot": "homedepot.com",
  lowes: "lowes.com",
  "lowe's": "lowes.com",
  costco: "costco.com",
  walmart: "walmart.com",
  target: "target.com",
  starbucks: "starbucks.com",
  mcdonalds: "mcdonalds.com",
  "mcdonald's": "mcdonalds.com",
  uber: "uber.com",
  lyft: "lyft.com",
  doordash: "doordash.com",
  airbnb: "airbnb.com",
  nike: "nike.com",
  samsung: "samsung.com",
  sony: "sony.com",
  ford: "ford.com",
  bmw: "bmw.com",
  "centerpoint energy": "centerpointenergy.com",
  centerpoint: "centerpointenergy.com",
  "x ai": "x.ai",
  xai: "x.ai",
  square: "squareup.com",
  "capital one": "capitalone.com",
  discover: "discover.com",
  intuit: "intuit.com",
  "h&r block": "hrblock.com",
  "h and r block": "hrblock.com",
  heb: "heb.com",
  "h-e-b": "heb.com",
  walgreens: "walgreens.com",
  cvs: "cvs.com",
  "best buy": "bestbuy.com",
  fidelity: "fidelity.com",
  vanguard: "vanguard.com",
  schwab: "schwab.com",
  "charles schwab": "schwab.com",
  kroger: "kroger.com",
  publix: "publix.com",
  "trader joes": "traderjoes.com",
  "trader joe's": "traderjoes.com",
  aldi: "aldi.us",
  "whole foods": "wholefoodsmarket.com",
  "whole foods market": "wholefoodsmarket.com",
  kaiser: "kp.org",
  "kaiser permanente": "kp.org",
  quest: "questdiagnostics.com",
  "quest diagnostics": "questdiagnostics.com",
  labcorp: "labcorp.com",
  enterprise: "enterprise.com",
  "enterprise rent-a-car": "enterprise.com",
  hertz: "hertz.com",
  avis: "avis.com",
  shell: "shell.com",
  chevron: "chevron.com",
  exxon: "exxon.com",
  exxonmobil: "exxonmobil.com",
  bp: "bp.com",
  "7 eleven": "7-eleven.com",
  "7-eleven": "7-eleven.com",
  wawa: "wawa.com",
  bucees: "buc-ees.com",
  "buc ees": "buc-ees.com",
  "buc-ees": "buc-ees.com",
  spectrum: "spectrum.com",
  xfinity: "xfinity.com",
  comcast: "xfinity.com",
  amtrak: "amtrak.com",
  txt: "texasbytexas.com",
  "texas by texas": "texasbytexas.com",
  gcx: "raise.com",
  raise: "raise.com",
};

/**
 * R8.3 `CATALOG_TAIL_OK` = GEO_WORDS (R6.6) ∪ SUBBRAND_TAIL.  A department or
 * format tail is still the parent brand: "H-E-B Pharmacy" is H-E-B.
 *
 * `dental` and the other ORG_SIGNAL trade words are deliberately absent — a
 * trade word makes a *different* business, so "Delta Dental" must never reduce
 * to delta.com.  That is why the tail is tested word by word below rather than
 * searched for a match anywhere in it: a substring search let "Delta Dental
 * Center" through on `center` alone.
 */
const SUBBRAND_TAIL: ReadonlySet<string> = new Set([
  "pharmacy", "deli", "bakery", "fuel", "gas", "market", "marketplace", "optical", "photo",
  "curbside", "drive", "thru", "corporate", "hq", "distribution", "warehouse",
]);

export function isTailOkWord(word: string): boolean {
  const w = word.toLowerCase();
  if (GEO_WORDS_LITERAL.has(w) || SUBBRAND_TAIL.has(w)) return true;
  return /^#\d*$/.test(w) || /^\d{2,5}$/.test(w);
}

/**
 * R8.3 — may this tail be dropped, leaving the head brand?
 *
 * Two conditions, and both are needed.  Requiring only that *some* word be
 * tail-ok reduced "Delta Dental Center" to delta.com on the strength of
 * `center` alone — an airline's logo on a dental practice.  Requiring that
 * *every* word be tail-ok instead rejected "Walgreens Mason Rd", because a
 * street name is not on any list and never can be.
 *
 * So: something must positively mark the tail as a place or department, and
 * nothing in it may name a different trade.  An unrecognised word ("mason") is
 * tolerated as part of an address; an ORG_SIGNAL word ("dental") is not, since
 * it makes the tail a business of its own.  SUBBRAND_TAIL wins where the two
 * lists overlap — "pharmacy" and "bakery" are H-E-B departments here.
 */
export function isCatalogTailOK(tail: readonly string[]): boolean {
  if (tail.length === 0) return false;
  if (!tail.some(isTailOkWord)) return false;
  return tail.every((w) => isTailOkWord(w) || !isOrgSignalWord(w));
}

const DOMAIN_TO_TICKER: Record<string, string> = {
  "apple.com": "AAPL",
  "microsoft.com": "MSFT",
  "google.com": "GOOGL",
  "abc.xyz": "GOOGL",
  "amazon.com": "AMZN",
  "nvidia.com": "NVDA",
  "meta.com": "META",
  "tesla.com": "TSLA",
  "netflix.com": "NFLX",
  "spotify.com": "SPOT",
  "adobe.com": "ADBE",
  "salesforce.com": "CRM",
  "oracle.com": "ORCL",
  "ibm.com": "IBM",
  "intel.com": "INTC",
  "cisco.com": "CSCO",
  "paypal.com": "PYPL",
  "visa.com": "V",
  "mastercard.com": "MA",
  "americanexpress.com": "AXP",
  "jpmorganchase.com": "JPM",
  "chase.com": "JPM",
  "bankofamerica.com": "BAC",
  "wellsfargo.com": "WFC",
  "citi.com": "C",
  "schwab.com": "SCHW",
  "goldmansachs.com": "GS",
  "morganstanley.com": "MS",
  "verizon.com": "VZ",
  "att.com": "T",
  "t-mobile.com": "TMUS",
  "walmart.com": "WMT",
  "target.com": "TGT",
  "costco.com": "COST",
  "homedepot.com": "HD",
  "lowes.com": "LOW",
  "starbucks.com": "SBUX",
  "mcdonalds.com": "MCD",
  "uber.com": "UBER",
  "lyft.com": "LYFT",
  "airbnb.com": "ABNB",
  "nike.com": "NKE",
  "ford.com": "F",
  "gm.com": "GM",
  "disney.com": "DIS",
  "disneyplus.com": "DIS",
  "fedex.com": "FDX",
  "ups.com": "UPS",
  "united.com": "UAL",
  "aa.com": "AAL",
  "southwest.com": "LUV",
  "delta.com": "DAL",
  "jetblue.com": "JBLU",
  "boeing.com": "BA",
  "caterpillar.com": "CAT",
  "deere.com": "DE",
  "exxonmobil.com": "XOM",
  "chevron.com": "CVX",
  "pfizer.com": "PFE",
  "jnj.com": "JNJ",
  "modernatx.com": "MRNA",
  "lilly.com": "LLY",
  "cvs.com": "CVS",
  "walgreens.com": "WBA",
  "labcorp.com": "LH",
  "spectrum.com": "CHTR",
  "charter.com": "CHTR",
  "comcast.com": "CMCSA",
  "xfinity.com": "CMCSA",
  "block.xyz": "SQ",
  "squareup.com": "SQ",
  "coinbase.com": "COIN",
  "robinhood.com": "HOOD",
  "sofi.com": "SOFI",
  "crowdstrike.com": "CRWD",
  "palantir.com": "PLTR",
  "snowflake.com": "SNOW",
  "cloudflare.com": "NET",
  "datadoghq.com": "DDOG",
  "mongodb.com": "MDB",
  "roblox.com": "RBLX",
  "draftkings.com": "DKNG",
};

export function lookupCompanyTicker(domain: string): string | undefined {
  return DOMAIN_TO_TICKER[domain.toLowerCase().replace(/^www\./, "")];
}

export function lookupCompanyDomain(name: string): string | undefined {
  const key = companyKey(name);
  if (!key) return undefined;
  if (DOMAINS[key]) return DOMAINS[key];
  const nospace = key.replace(/\s+/g, "");
  if (DOMAINS[nospace]) return DOMAINS[nospace];

  const words = key.split(" ").filter(Boolean);
  for (let i = words.length - 1; i >= 1; i -= 1) {
    const head = words.slice(0, i).join(" ");
    const tail = words.slice(i);
    const domain = DOMAINS[head] ?? DOMAINS[head.replace(/\s+/g, "")];
    if (domain && isCatalogTailOK(tail)) return domain;
  }
  return undefined;
}
