import {
  classifyContact,
  queryName,
  resolveIdentity,
  wantsSuggestion,
  type BookContact,
  type Confidence,
  type ContactClass,
  type IdentityVia,
} from "./classify.ts";
import { candidateUrls, type LogoHit } from "./logos.ts";

export type ReviewItem = {
  contact: BookContact;
  contactClass: ContactClass;
  query: string;
  domain?: string;
  via?: IdentityVia;
  candidates: LogoHit[];
  confidence: Confidence;
  flags: string[];
  selected: boolean;
  chosenIndex: number;
};

function confidenceFor(item: Omit<ReviewItem, "selected" | "chosenIndex" | "confidence">): Confidence {
  switch (item.contactClass) {
    case "nonBrand":
    case "person":
      return "skip";
    case "businessCard":
      break;
    default: {
      const _never: never = item.contactClass;
      return _never;
    }
  }
  if (item.candidates.length === 0) return "skip";
  const best = item.candidates[0];
  let tier: Confidence = "medium";
  switch (best.source) {
    case "preferred":
    case "simpleicons":
    case "ticker":
    case "brandfetch":
    case "logodev":
    case "clearbit":
    case "google":
      tier = item.via === "catalog" || item.via === "website" || item.via === "phone" ? "high" : "medium";
      break;
    case "favicon":
    case "upload":
    case "crop":
    case "url":
      tier = "medium";
      break;
    default: {
      const _never: never = best.source;
      void _never;
      break;
    }
  }
  if (item.via === "guess" || item.via === "email") tier = "medium";
  if (item.flags.includes("guessed-domain") || item.flags.includes("brand-tail") || item.flags.includes("homonym-risk")) {
    tier = "medium";
  }
  if (item.via === "guess" && best.source === "favicon") tier = "low";
  if (item.flags.includes("replace-existing") && tier === "high") tier = "medium";
  return tier;
}

export function matchContact(contact: BookContact): ReviewItem {
  const contactClass = classifyContact(contact);
  const { query, flags } = queryName(contact);
  if (contactClass === "nonBrand") {
    return {
      contact,
      contactClass,
      query,
      candidates: [],
      confidence: "skip",
      flags: [...flags, "non-brand"],
      selected: false,
      chosenIndex: 0,
    };
  }
  if (contactClass === "person") {
    return {
      contact,
      contactClass,
      query,
      candidates: [],
      confidence: "skip",
      flags: [...flags, contact.hadExistingPhoto ? "photo-protected" : "person"],
      selected: false,
      chosenIndex: 0,
    };
  }
  const identity = resolveIdentity(contact, query);
  if (identity) flags.push(`via-${identity.via}`);
  if (identity?.via === "guess") flags.push("guessed-domain");
  if (contact.hadExistingPhoto) flags.push("replace-existing");
  const candidates = identity ? candidateUrls(identity.domain) : [];
  const base = {
    contact,
    contactClass,
    query,
    domain: identity?.domain,
    via: identity?.via,
    candidates,
    flags,
  };
  const confidence = confidenceFor(base);
  return {
    ...base,
    confidence,
    selected: confidence === "high",
    chosenIndex: 0,
  };
}

export function matchBook(contacts: BookContact[]): ReviewItem[] {
  return contacts.filter((c) => wantsSuggestion(c, classifyContact(c)) || classifyContact(c) === "nonBrand").map(matchContact);
}

export function bucket(items: ReviewItem[]) {
  return {
    auto: items.filter((i) => i.confidence === "high"),
    review: items.filter((i) => i.confidence === "medium" || i.confidence === "low"),
    notFound: items.filter((i) => i.confidence === "skip"),
  };
}
