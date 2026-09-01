/**
 * A hand-rolled DOM good enough to drive `render()` end to end.  The repo has no
 * jsdom (and this lane may not add dependencies), so the harness below implements
 * only the surface app.ts touches — enough to prove the three browser-verified
 * findings: search keeps focus and its value, the approved count is never stale,
 * and a 300-contact book mounts a window of cards instead of all of them.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { BookContact } from "./engine/classify.ts";

type Handler = (event: StubEvent) => void;
type StubEvent = { type: string; target: StubElement; preventDefault(): void; relatedTarget?: unknown };

let created: StubElement[] = [];

class StubElement {
  tagName: string;
  className = "";
  childNodes: (StubElement | string)[] = [];
  parent: StubElement | null = null;
  attrs = new Map<string, string>();
  listeners = new Map<string, Handler[]>();
  style: Record<string, string> = {};
  scrollTop = 0;
  value = "";
  checked = false;
  disabled = false;
  tabIndex = 0;

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
    created.push(this);
  }

  get children(): StubElement[] {
    return this.childNodes.filter((n): n is StubElement => typeof n !== "string");
  }
  get firstChild(): StubElement | string | null {
    return this.childNodes[0] ?? null;
  }
  get firstElementChild(): StubElement | null {
    return this.children[0] ?? null;
  }
  get textContent(): string {
    return this.childNodes.map((n) => (typeof n === "string" ? n : n.textContent)).join("");
  }
  set textContent(value: string) {
    for (const kid of this.children) kid.parent = null;
    this.childNodes = [String(value)];
  }
  get classList() {
    const self = this;
    const list = () => self.className.split(" ").filter(Boolean);
    return {
      contains: (name: string) => list().includes(name),
      add: (name: string) => {
        if (!list().includes(name)) self.className = [...list(), name].join(" ");
      },
      remove: (name: string) => {
        self.className = list().filter((c) => c !== name).join(" ");
      },
      toggle: (name: string, on?: boolean) => {
        const want = on ?? !list().includes(name);
        if (want) this.classList.add(name);
        else this.classList.remove(name);
      },
    };
  }
  append(...kids: (StubElement | string)[]): void {
    for (const kid of kids) {
      if (typeof kid !== "string") {
        kid.parent?.removeChild(kid);
        kid.parent = this;
      }
      this.childNodes.push(kid);
    }
  }
  replaceChildren(...kids: (StubElement | string)[]): void {
    for (const kid of this.children) kid.parent = null;
    this.childNodes = [];
    this.append(...kids);
  }
  removeChild(kid: StubElement): void {
    this.childNodes = this.childNodes.filter((n) => n !== kid);
  }
  remove(): void {
    this.parent?.removeChild(this);
    this.parent = null;
  }
  contains(other: unknown): boolean {
    if (other === this) return true;
    return this.children.some((c) => c.contains(other));
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
  addEventListener(type: string, fn: Handler): void {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push(fn);
    this.listeners.set(type, bucket);
  }
  removeEventListener(type: string, fn: Handler): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((h) => h !== fn));
  }
  getBoundingClientRect() {
    return { height: this.tagName === "ARTICLE" ? 200 : 0, width: 300, top: 0, left: 0 };
  }
  focus(): void {
    stubDocument.activeElement = this;
  }
  querySelectorAll(): StubElement[] {
    return [];
  }
}

function fire(node: StubElement, type: string): void {
  const event: StubEvent = { type, target: node, preventDefault() {} };
  for (const handler of [...(node.listeners.get(type) ?? [])]) handler(event);
}

const stubDocument = {
  activeElement: null as StubElement | null,
  root: new StubElement("div"),
  getElementById(id: string) {
    return id === "app" ? this.root : null;
  },
  createElement(tag: string) {
    return new StubElement(tag);
  },
  createElementNS(_ns: string, tag: string) {
    return new StubElement(tag);
  },
  addEventListener() {},
  removeEventListener() {},
};

const stubWindow = {
  innerHeight: 900,
  addEventListener() {},
  removeEventListener() {},
  prompt: () => null,
};

Object.assign(globalThis, {
  document: stubDocument,
  window: stubWindow,
  getComputedStyle: () => ({ gridTemplateColumns: "1fr 1fr 1fr", rowGap: "16px" }),
  requestAnimationFrame: (fn: () => void) => {
    fn();
    return 1;
  },
});

const { adoptContacts, render } = await import("./app.ts");

function findAll(node: StubElement, predicate: (n: StubElement) => boolean, out: StubElement[] = []): StubElement[] {
  if (predicate(node)) out.push(node);
  for (const kid of node.children) findAll(kid, predicate, out);
  return out;
}

function hasClass(node: StubElement, name: string): boolean {
  return node.className.split(" ").includes(name);
}

function visible(node: StubElement): boolean {
  for (let cursor: StubElement | null = node; cursor; cursor = cursor.parent) {
    if (hasClass(cursor, "hidden")) return false;
  }
  return true;
}

function byClass(name: string): StubElement[] {
  return findAll(stubDocument.root, (n) => hasClass(n, name));
}

function ancestorWithClass(node: StubElement, name: string): StubElement | null {
  for (let cursor: StubElement | null = node; cursor; cursor = cursor.parent) {
    if (hasClass(cursor, name)) return cursor;
  }
  return null;
}

function cards(): StubElement[] {
  return byClass("card").filter((n) => n.tagName === "ARTICLE");
}

function book(count: number): BookContact[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `c${i}`,
    displayName: `Acme ${i} Roofing`,
    organization: `Acme ${i} Roofing`,
    website: `https://acme${i}.example`,
  }));
}

test("the landing page gives way to the review stage", () => {
  stubDocument.root = new StubElement("div");
  created = [];
  render();
  const headings = findAll(stubDocument.root, (n) => n.tagName === "H2" && visible(n)).map((n) => n.textContent);
  assert.ok(headings.includes("How it works"), `landing headings: ${headings.join(" | ")}`);
  assert.ok(headings.includes("Nothing changes without your approval"));
  assert.ok(headings.includes("Your contacts stay in this browser"));

  const copy = findAll(stubDocument.root, (n) => visible(n))
    .map((n) => n.textContent)
    .join(" ");
  for (const jargon of ["ContactLogoKit", "backups/", "BadgeBook", "Crest"]) {
    assert.ok(!copy.includes(jargon), `customer copy leaked "${jargon}"`);
  }

  adoptContacts(book(3), "Test");
  const afterHeadings = findAll(stubDocument.root, (n) => n.tagName === "H2" && visible(n)).map((n) => n.textContent);
  assert.ok(!afterHeadings.includes("How it works"), "landing copy still showing during review");
  assert.ok(afterHeadings.some((h) => h.startsWith("Ready to apply (")));
});

test("a 300-contact book mounts a window of cards, not all of them", () => {
  stubDocument.root = new StubElement("div");
  adoptContacts(book(300), "Test");
  const mounted = cards();
  assert.ok(mounted.length > 0, "nothing rendered");
  assert.ok(mounted.length <= 40, `mounted ${mounted.length} of 300 cards`);
  // Which section the book lands in depends on the confidence its candidates
  // earn, so the first viewport in the document is not necessarily the one
  // holding cards.  Walk up from a card that actually mounted.
  const list = ancestorWithClass(mounted[0], "virtual-list");
  const spacer = ancestorWithClass(mounted[0], "virtual-list-spacer");
  assert.ok(list, "mounted cards are not inside a virtual-list viewport");
  assert.ok(spacer, "mounted cards are not inside a virtual-list spacer");
  assert.ok(parseFloat(spacer.style.height) > parseFloat(list.style.height), "spacer must reserve full height");
});

test("typing in search keeps the same input, its value and the focus", () => {
  stubDocument.root = new StubElement("div");
  adoptContacts(book(12), "Test");
  const input = byClass("search-input")[0];
  stubDocument.activeElement = input;

  for (const value of ["a", "ac", "acm"]) {
    input.value = value;
    fire(input, "input");
    assert.equal(byClass("search-input")[0], input, "search input was rebuilt");
    assert.equal(input.value, value, "search input lost characters");
    assert.equal(stubDocument.activeElement, input, "search input lost focus");
  }

  const shown = cards().filter(visible);
  assert.ok(shown.length > 0, "search matched nothing it should have matched");
});

test("ticking a card checkbox updates the approved count immediately", () => {
  stubDocument.root = new StubElement("div");
  adoptContacts(book(12), "Test");
  const approvedBtn = () =>
    findAll(stubDocument.root, (n) => n.tagName === "BUTTON" && n.textContent.startsWith("Download "))[0];
  const before = approvedBtn().textContent;

  const boxes = cards()
    .flatMap((c) => c.children)
    .filter((n) => n.getAttribute("type") === "checkbox" && !n.disabled);
  assert.ok(boxes.length >= 2, "expected at least two selectable cards");

  const start = Number(before.replace(/\D+/g, ""));
  boxes[0].checked = !boxes[0].checked;
  fire(boxes[0], "change");
  const afterOne = Number(approvedBtn().textContent.replace(/\D+/g, ""));
  assert.equal(afterOne, boxes[0].checked ? start + 1 : start - 1);

  boxes[1].checked = !boxes[1].checked;
  fire(boxes[1], "change");
  const afterTwo = Number(approvedBtn().textContent.replace(/\D+/g, ""));
  assert.equal(afterTwo, boxes[1].checked ? afterOne + 1 : afterOne - 1);
});

test("re-rendering reuses card elements instead of re-requesting every logo", () => {
  stubDocument.root = new StubElement("div");
  adoptContacts(book(12), "Test");
  const first = cards()[0];
  const images = created.filter((n) => n.tagName === "IMG").length;
  render();
  render();
  assert.equal(cards()[0], first, "card element was rebuilt");
  assert.equal(created.filter((n) => n.tagName === "IMG").length, images, "re-render created new <img> elements");
});

test("a card whose candidates all fail lands in Not found, unchecked and disabled", () => {
  stubDocument.root = new StubElement("div");
  adoptContacts(book(1), "Test");
  const card = cards()[0];
  const check = card.children.find((n) => n.getAttribute("type") === "checkbox")!;
  const thumb = card.children.find((n) => n.tagName === "IMG")!;

  for (let guard = 0; guard < 20 && thumb.getAttribute("src"); guard += 1) {
    fire(thumb, "error");
  }

  assert.ok(hasClass(card, "card--exhausted"), `card class was ${card.className}`);
  assert.ok(hasClass(card, "skip"), "exhausted card must not stay in a confidence tier");
  assert.equal(check.checked, false, "exhausted card stayed checked");
  assert.equal(check.disabled, true, "exhausted card stayed selectable");
  assert.equal(check.getAttribute("aria-label"), "No logo available for Acme 0 Roofing");

  const notFound = byClass("section--notfound")[0];
  assert.ok(notFound.contains(card), "exhausted card is not in the Not found section");
  assert.ok(
    findAll(card, (n) => hasClass(n, "exhausted-label")).some((n) => visible(n) && n.textContent === "No logo found"),
    "no 'No logo found' label",
  );
  const approved = findAll(stubDocument.root, (n) => n.tagName === "BUTTON" && n.textContent.startsWith("Download "))[0];
  assert.equal(approved.textContent, "Download 0 Approved Updates");
});

test("filter chips narrow the sections and track aria-pressed", () => {
  stubDocument.root = new StubElement("div");
  adoptContacts(book(12), "Test");
  const chips = byClass("chip");
  assert.deepEqual(chips.map((c) => c.textContent), [
    "All",
    "Ready to apply",
    "Needs review",
    "Not found",
    "Missing photo",
  ]);

  const notFoundChip = chips.find((c) => c.getAttribute("data-filter") === "notfound")!;
  fire(notFoundChip, "click");
  assert.equal(notFoundChip.getAttribute("aria-pressed"), "true");
  assert.ok(hasClass(notFoundChip, "chip--active"));
  assert.equal(chips.filter((c) => c.getAttribute("aria-pressed") === "true").length, 1);
  assert.equal(cards().filter(visible).length, 0, "nothing should survive the Not found filter yet");

  const all = chips.find((c) => c.getAttribute("data-filter") === "all")!;
  fire(all, "click");
  assert.ok(cards().filter(visible).length > 0);
});

test("card checkboxes and candidate buttons carry accessible names", () => {
  stubDocument.root = new StubElement("div");
  adoptContacts(book(3), "Test");
  const card = cards()[0];
  const check = card.children.find((n) => n.getAttribute("type") === "checkbox")!;
  assert.equal(check.getAttribute("aria-label"), "Apply logo to Acme 0 Roofing");

  const altButtons = findAll(card, (n) => hasClass(n, "alts-btn"));
  assert.ok(altButtons.length > 0, "no candidate buttons");
  for (const button of altButtons) {
    const label = button.getAttribute("aria-label") ?? "";
    assert.ok(label.startsWith("Use ") && label.endsWith(" logo"), `bad label ${label}`);
    assert.ok(["true", "false"].includes(button.getAttribute("aria-pressed") ?? ""));
    for (const img of button.children) assert.equal(img.getAttribute("alt"), "");
  }
  assert.equal(altButtons.filter((b) => b.getAttribute("aria-pressed") === "true").length, 1);

  const banner = byClass("notice-banner")[0];
  assert.equal(banner.getAttribute("aria-live"), "polite");
  assert.equal(banner.getAttribute("aria-atomic"), "true");
  assert.equal(banner.getAttribute("role"), "status");
});
