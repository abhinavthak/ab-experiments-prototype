// Small shared helpers: escaping, formatting, dates, PRNG, DOM.

export const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const DAY = 86400000;

export function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtDate(t) {
  if (t == null) return "";
  const d = new Date(t);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
export function fmtDateTime(t) {
  if (t == null) return "";
  const d = new Date(t);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${fmtDate(t)}, ${h}:${m} ${ap}`;
}
export function timeAgo(t, now) {
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
export const daysBetween = (a, b) => Math.floor((startOfDay(b) - startOfDay(a)) / DAY);

export const fmtInt = (n) => Math.round(n).toLocaleString("en-IN");
export const fmtPct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
export function fmtLift(x, d = 1) {
  if (x == null || !isFinite(x)) return "—";
  const s = (x * 100).toFixed(d);
  return x > 0 ? `+${s}%` : x < 0 ? `−${s.replace("-", "")}%` : `${s}%`;
}

export function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export const uid = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

export function initials(name) {
  return String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

// Deterministic PRNG (mulberry32) and string hash, so simulated data is stable.
export function hash(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h ^ (h >>> 16)) >>> 0;
}
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function gauss(r) {
  let u = 0;
  while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

// Variant colours from the design accents: A neutral, then breeze, sunset, twilight, sunset-soft.
export const VARIANT_COLORS = ["#9a9ea5", "#a0c3ec", "#ff7a17", "#c4b5fd", "#ffc285"];
export const letter = (i) => String.fromCharCode(65 + i);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let toastTimer;
export function toast(msg, tone = "") {
  let el = $("#toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.className = `toast show ${tone}`;
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = "toast"), 2600);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied ${text}`);
  } catch {
    toast("Couldn't copy to the clipboard", "bad");
  }
}
