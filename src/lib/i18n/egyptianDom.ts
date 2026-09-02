import { EGYPTIAN_DICT } from "./egyptianDict";
import { EGYPTIAN_EXTRA } from "./egyptianExtra";
import { EGYPTIAN_PAGES } from "./egyptianPages";
import { EGYPTIAN_PAGES_2 } from "./egyptianPages2";
import { EGYPTIAN_PAGES_3 } from "./egyptianPages3";
import { EGYPTIAN_PAGES_4 } from "./egyptianPages4";

const DICT: Record<string, string> = {
  ...EGYPTIAN_DICT,
  ...EGYPTIAN_EXTRA,
  ...EGYPTIAN_PAGES,
  ...EGYPTIAN_PAGES_2,
  ...EGYPTIAN_PAGES_3,
  ...EGYPTIAN_PAGES_4,
};



/**
 * Zero-network Egyptian Arabic DOM pass.
 *
 * The dictionary is bundled (plain object literal), so translation is a pure
 * in-memory hash lookup. Nothing is fetched, nothing is parsed at runtime.
 * The pass only ever runs while the user language is `ar-eg`.
 */

const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "CODE",
  "PRE",
  "SVG",
  "CANVAS",
  "TEXTAREA",
  "IFRAME",
]);

const ATTRS = ["placeholder", "aria-label", "title", "alt"] as const;

const MONTHS: Record<string, string> = {
  January: "يناير",
  February: "فبراير",
  March: "مارس",
  April: "أبريل",
  May: "مايو",
  June: "يونيو",
  July: "يوليو",
  August: "أغسطس",
  September: "سبتمبر",
  October: "أكتوبر",
  November: "نوفمبر",
  December: "ديسمبر",
  Jan: "يناير",
  Feb: "فبراير",
  Mar: "مارس",
  Apr: "أبريل",
  Jun: "يونيو",
  Jul: "يوليو",
  Aug: "أغسطس",
  Sep: "سبتمبر",
  Oct: "أكتوبر",
  Nov: "نوفمبر",
  Dec: "ديسمبر",
};

/** Patterns for strings that carry a runtime value and can't be a plain key. */
const patterns: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  // "Add Code Reviewer" (aria-labels built from a skill name)
  [/^Add (.+)$/, (m) => `أضف ${DICT[m[1]] || m[1]}`],
  // "Remove Travel Planner"
  [/^Remove (.+)$/, (m) => `شيل ${DICT[m[1]] || m[1]}`],
  // "August 26, 2026" / "Jul 25, 2026"
  [
    /^([A-Za-z]{3,9}) (\d{1,2}), (\d{4})$/,
    (m) => (MONTHS[m[1]] ? `${m[2]} ${MONTHS[m[1]]} ${m[3]}` : m[0]),
  ],
  // "800 points to go — about 80 more friends."
  [
    /^(\d+) points to go — about (\d+) more friends\.$/,
    (m) => `فاضل ${m[1]} نقطة — يعني حوالي ${m[2]} صاحب كمان.`,
  ],
  // "App Version 4.12.0 • Build 992"
  [/^App Version (.+) • Build (.+)$/, (m) => `إصدار التطبيق ${m[1]} • بيلد ${m[2]}`],
  // "1,500 pts to go"
  [/^([\d,]+) pts? to go$/, (m) => `فاضل ${m[1]} نقطة`],
  // "800 points to go"
  [/^([\d,]+) points? to go$/, (m) => `فاضل ${m[1]} نقطة`],
  // "Credits: 2693"
  [/^Credits:\s*([\d,]+)$/, (m) => `الكريدت: ${m[1]}`],
  // "Upgrade to Pro" / "Upgrade to Max"
  [/^Upgrade to (Pro|Max|Plus|Premium)$/, (m) => `اترقّى لـ ${m[1]}`],
  // "3 months" / "12 months"
  [/^(\d+) months?$/, (m) => (m[1] === "1" ? "شهر واحد" : `${m[1]} شهور`)],
  // "5 days ago" / "2 hours ago"
  [
    /^(\d+) (second|minute|hour|day|week|month|year)s? ago$/,
    (m) =>
      `من ${m[1]} ${
        {
          second: "ثانية",
          minute: "دقيقة",
          hour: "ساعة",
          day: "يوم",
          week: "أسبوع",
          month: "شهر",
          year: "سنة",
        }[m[2]]
      }`,
  ],
];

/** Case-insensitive index (CSS text-transform means the DOM text may be uppercased). */
const LOWER: Record<string, string> = {};
for (const k of Object.keys(DICT)) {
  const lk = k.toLowerCase();
  if (!(lk in LOWER)) LOWER[lk] = DICT[k];
}

const lookup = (raw: string): string | null => {
  const text = raw.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (!text || text.length > 700) return null;
  // Skip pure numbers / symbols — nothing to translate.
  if (!/[A-Za-z]/.test(text)) return null;
  const hit = DICT[text];
  if (hit) return hit;
  // Try without a trailing punctuation mark.
  const stripped = text.replace(/[.:!?]+$/, "");
  if (stripped !== text && DICT[stripped]) return DICT[stripped];
  const lower = LOWER[text.toLowerCase()] || LOWER[stripped.toLowerCase()];
  if (lower) return lower;
  for (const [re, build] of patterns) {
    const m = text.match(re);
    if (m) return build(m);
  }
  return null;
};


/** True when the element only holds text / plain inline markup (safe to flatten). */
const INLINE_OK = new Set(["SPAN", "B", "I", "EM", "STRONG", "SMALL", "S", "DEL"]);
const isFlattenable = (el: Element) => {
  if (el.childNodes.length < 2 || el.children.length > 8) return false;
  const all = el.querySelectorAll("*");
  if (all.length > 12) return false;
  for (const child of Array.from(all)) {
    if (!INLINE_OK.has(child.tagName)) return false;
  }
  return true;
};

const originalText = new WeakMap<Text, string>();
const originalAttrs = new WeakMap<Element, Map<string, string | null>>();

const translateNode = (node: Text) => {
  const parent = node.parentElement;
  if (!parent || SKIP_TAGS.has(parent.tagName)) return;
  // NOTE: <html translate="no"> is set globally, so only element-level opt-outs count.
  const optOut = parent.closest("[data-no-translate], [translate='no']");
  if (optOut && optOut !== document.documentElement) return;
  const original = node.nodeValue || "";
  const hit = lookup(original);
  if (!hit) {
    // The sentence may be split across sibling spans — try the parent as a whole.
    if (isFlattenable(parent)) {
      const whole = lookup(parent.textContent || "");
      if (whole) parent.textContent = whole;
    }
    return;
  }
  if (!originalText.has(node)) originalText.set(node, original);
  // Preserve the surrounding whitespace so inline layouts stay intact.
  const lead = original.match(/^\s*/)?.[0] ?? "";
  const tail = original.match(/\s*$/)?.[0] ?? "";
  node.nodeValue = `${lead}${hit}${tail}`;
};

const translateAttrs = (el: Element) => {
  for (const attr of ATTRS) {
    const value = el.getAttribute(attr);
    if (!value) continue;
    const hit = lookup(value);
    if (hit) {
      const attrs = originalAttrs.get(el) ?? new Map<string, string | null>();
      if (!attrs.has(attr)) attrs.set(attr, value);
      originalAttrs.set(el, attrs);
      el.setAttribute(attr, hit);
    }
  }
};

const walk = (root: Node) => {
  if (root.nodeType === Node.TEXT_NODE) {
    translateNode(root as Text);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  if (SKIP_TAGS.has(el.tagName)) return;

  translateAttrs(el);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    texts.push(current as Text);
    current = walker.nextNode();
  }
  for (const t of texts) translateNode(t);
  el.querySelectorAll("[placeholder], [aria-label], [title], [alt]").forEach(translateAttrs);
};

let observer: MutationObserver | null = null;
let queued: Node[] = [];
let scheduled = false;

const flush = () => {
  scheduled = false;
  const batch = queued;
  queued = [];
  observer?.disconnect();
  for (const node of batch) {
    if (node.isConnected) walk(node);
  }
  observe();
};

const schedule = () => {
  if (scheduled) return;
  scheduled = true;
  // An idle callback WITHOUT a timeout can be starved indefinitely on a busy
  // page (streaming chat, animations, data fetching) — that is why large parts
  // of the UI used to stay in English. The timeout guarantees the pass runs on
  // the next frame-ish, so translated text lands before the user reads it.
  const idle = (
    window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  if (idle) idle(flush, { timeout: 80 });
  else setTimeout(flush, 16);
};

const observe = () => {
  observer?.observe(document.body, { childList: true, subtree: true, characterData: true });
};

export const startEgyptianDom = () => {
  if (typeof document === "undefined" || observer) return;
  walk(document.body);
  observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "characterData") queued.push(record.target);
      else record.addedNodes.forEach((n) => queued.push(n));
    }
    if (queued.length) schedule();
  });
  observe();
};

/**
 * Full re-pass over the document. Route changes swap huge subtrees and pages
 * fill in asynchronously (profile, credits, lists), so a single mutation batch
 * is not enough — call this after navigation to catch everything the observer
 * batch may have missed.
 */
export const retranslateEgyptianDom = () => {
  if (typeof document === "undefined" || !observer) return;
  observer.disconnect();
  try {
    walk(document.body);
  } finally {
    observe();
  }
};

export const stopEgyptianDom = () => {
  observer?.disconnect();
  observer = null;
  queued = [];
  // Restore text and attributes translated by the DOM fallback before English
  // renders again. Without this, switching Arabic → English leaves stale Arabic.
  if (typeof document === "undefined") return;
  // WeakMaps cannot be iterated, so restore tracked nodes while they are still
  // reachable from the document, then let the maps be garbage-collected.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    const original = originalText.get(text);
    if (original !== undefined) text.nodeValue = original;
    node = walker.nextNode();
  }
  document.body.querySelectorAll("*").forEach((el) => {
    const attrs = originalAttrs.get(el);
    attrs?.forEach((value, attr) => {
      if (value === null) el.removeAttribute(attr);
      else el.setAttribute(attr, value);
    });
  });
};
