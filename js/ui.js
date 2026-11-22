// Shared UI pieces: icons, pills, chips, menus, modals.
import { esc, VARIANT_COLORS, initials, $, $$ } from "./util.js";
import * as S from "./store.js";

const P = (d, w = 20, sw = 1.75) =>
  `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const icon = {
  page: (w) => P('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>', w),
  grid: (w) => P('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>', w),
  layers: (w) => P('<path d="M12 3 3 8l9 5 9-5z"/><path d="m3 13 9 5 9-5"/>', w),
  screen: (w) => P('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>', w),
  folder: (w) => P('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', w),
  flask: (w) => P('<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"/><path d="M7.5 15h9"/>', w),
  target: (w) => P('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>', w),
  card: (w) => P('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>', w),
  cap: (w) => P('<path d="m2 9 10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/>', w),
  form: (w) => P('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>', w),
  gear: (w) => P('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>', w),
  users: (w) => P('<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 7M21 20a6 6 0 0 0-4-5.6"/>', w),
  pulse: (w) => P('<path d="M3 12h4l3-7 4 14 3-7h4"/>', w),
  search: (w) => P('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', w),
  plus: (w) => P('<path d="M12 5v14M5 12h14"/>', w, 2.25),
  down: (w = 16) => P('<path d="m6 9 6 6 6-6"/>', w),
  info: (w = 17) => P('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>', w, 1.9),
  warn: (w = 17) => P('<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>', w, 1.9),
  check: (w = 17) => P('<path d="m5 12 5 5 9-10"/>', w, 2),
  lock: (w = 14) => P('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', w),
  x: (w = 18) => P('<path d="M6 6l12 12M18 6 6 18"/>', w),
  logout: (w) => P('<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>', w),
  clock: (w = 18) => P('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', w),
  copy: (w = 18) => P('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>', w),
  trash: (w = 18) => P('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', w),
  archive: (w = 18) => P('<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/>', w),
  play: (w = 18) => P('<path d="M7 4v16l13-8z"/>', w),
  stop: (w = 18) => P('<rect x="6" y="6" width="12" height="12" rx="2"/>', w),
  calendar: (w = 18) => P('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>', w),
  eye: (w = 18) => P('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', w),
  edit: (w = 18) => P('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>', w),
  ext: (w = 16) => P('<path d="M7 17 17 7M9 7h8v8"/>', w),
  menu: (w = 20) => P('<path d="M4 6h16M4 12h16M4 18h16"/>', w),
};

export const chip = (i, label, sm = false) =>
  `<span class="chip${sm ? " sm" : ""}" style="background:${VARIANT_COLORS[i % VARIANT_COLORS.length]}" title="${esc(label || "")}">${String.fromCharCode(65 + i)}</span>`;

export const variantChip = (v, sm = false) => {
  const i = Math.max(0, v.key.charCodeAt(0) - 65);
  return `<span class="chip${sm ? " sm" : ""}" style="background:${VARIANT_COLORS[i % VARIANT_COLORS.length]}" title="${esc(v.name)}">${esc(v.key)}</span>`;
};

export const avatar = (userId, lg = false) => {
  const u = S.user(userId);
  return `<span class="avatar${lg ? " lg" : ""}" title="Owner: ${esc(u.name)}">${esc(initials(u.name))}</span>`;
};

export const pill = (tone, label) => `<span class="pill ${tone}"><span class="dot" aria-hidden="true"></span>${esc(label)}</span>`;

export const callout = (tone, html, action = "") => {
  const ic = tone === "bad" || tone === "warn" ? icon.warn() : tone === "good" ? icon.check() : icon.info();
  return `<div class="callout ${tone}" role="${tone === "bad" ? "alert" : "status"}">${ic}<div class="grow">${html}</div>${action}</div>`;
};

export const lock = (text) => `<span class="lock" title="${esc(text)}">${icon.lock()} ${esc(text.split(".")[0])}</span>`;

// Menus: <div class="menu-wrap"><button data-menu>…</button><div class="menu" hidden>…</div></div>
export function menu(triggerHtml, itemsHtml, { label = "More actions", cls = "btn sm icon-btn", up = false } = {}) {
  return `<div class="menu-wrap"><button type="button" class="${cls}" data-menu aria-haspopup="menu" aria-expanded="false" aria-label="${esc(label)}">${triggerHtml}</button><div class="menu${up ? " up" : ""}" role="menu" hidden>${itemsHtml}</div></div>`;
}
export function menuItem(act, label, { ic = "", data = "", disabled = "", danger = false } = {}) {
  // Disabled items keep their name and show the reason on hover and below.
  return `<button type="button" role="menuitem" data-act="${act}" ${data} ${disabled ? `disabled aria-disabled="true" title="${esc(disabled)}"` : ""} class="${danger ? "danger" : ""}">${ic}<span>${esc(label)}</span></button>${disabled ? `<div class="why" aria-hidden="true">${esc(disabled)}</div>` : ""}`;
}

export function closeMenus(except) {
  $$(".menu").forEach((m) => {
    if (m !== except) {
      m.hidden = true;
      m.previousElementSibling?.setAttribute("aria-expanded", "false");
    }
  });
}

// Modal
let modalOnSubmit = null;
let lastFocus = null;
export function openModal({ title, body, footer = "", tone = "", ic = "", wide = false, onSubmit = null, onOpen = null }) {
  const root = $("#modal-root");
  lastFocus = document.activeElement;
  modalOnSubmit = onSubmit;
  root.innerHTML = `<div class="backdrop" data-act="modal-close"></div>
    <form class="modal${wide ? " wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title" novalidate>
      <div class="modal-h">${ic ? `<span class="modal-ic ${tone}">${ic}</span>` : ""}<h2 id="modal-title">${esc(title)}</h2>
        <button type="button" class="btn ghost icon-btn sm" data-act="modal-close" aria-label="Close">${icon.x()}</button></div>
      <div class="modal-b">${body}</div>
      ${footer ? `<div class="modal-f">${footer}</div>` : ""}
    </form>`;
  root.classList.add("open");
  const form = $("form.modal", root);
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (modalOnSubmit) modalOnSubmit(new FormData(form), form, ev.submitter);
  });
  onOpen?.(form);
  const first = $("input:not([type=hidden]):not([disabled]), select, textarea, .modal-f .btn.primary, .modal-f .btn", form);
  first?.focus();
}
export function closeModal() {
  const root = $("#modal-root");
  root.classList.remove("open");
  root.innerHTML = "";
  modalOnSubmit = null;
  lastFocus?.focus?.();
}
export const isModalOpen = () => $("#modal-root").classList.contains("open");

export function confirmModal({ title, text, confirm = "Confirm", tone = "blue", danger = false, ic, onConfirm }) {
  openModal({
    title,
    tone,
    ic: ic || (danger ? icon.warn(18) : icon.info(18)),
    body: `<div style="line-height:1.55">${text}</div>`,
    footer: `<button type="button" class="btn sm" data-act="modal-close">Cancel</button><button type="submit" class="btn sm ${danger ? "danger" : "primary"}">${esc(confirm)}</button>`,
    onSubmit: () => {
      onConfirm();
      closeModal();
    },
  });
}

export function emptyRow(cols, title, text = "", action = "") {
  return `<tr><td colspan="${cols}"><div class="empty"><h3>${esc(title)}</h3>${text ? `<div>${text}</div>` : ""}${action ? `<div style="margin-top:14px">${action}</div>` : ""}</div></td></tr>`;
}

// Tag multi-select: pick existing tags or type a new one and press Enter.
// The selected tags live in a hidden input (comma separated) so forms read them as before.
const normTag = (t) => String(t).trim().toLowerCase().replace(/,/g, "");
const knownTags = () => [...new Set(S.get().experiments.flatMap((e) => e.tags || []))].sort();

export function tagPicker({ id, name = "tags", selected = [], placeholder = "Add tags" }) {
  return `<div class="tagpick" data-tagpick data-create="1" data-ph="${esc(placeholder)}">
    <input type="hidden" name="${esc(name)}" value="${esc(selected.join(","))}">
    <div class="tp-box">${selected.map((t) => tpChip(t)).join("")}<input id="${esc(id)}" class="tp-in" autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list" placeholder="${selected.length ? "" : esc(placeholder)}"></div>
    <div class="tp-menu" role="listbox" aria-multiselectable="true" hidden></div>
  </div>`;
}
// Same control for a fixed list of options ([value, label] pairs), e.g. metrics.
export function multiPicker({ id, name, options, selected = [], placeholder = "Add" }) {
  const label = (v) => options.find(([x]) => x === v)?.[1] || v;
  return `<div class="tagpick" data-tagpick data-create="0" data-ph="${esc(placeholder)}" data-opts="${esc(JSON.stringify(options))}">
    <input type="hidden" name="${esc(name)}" value="${esc(selected.join(","))}">
    <div class="tp-box">${selected.map((v) => tpChip(v, label(v))).join("")}<input id="${esc(id)}" class="tp-in" autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list" placeholder="${selected.length ? "" : esc(placeholder)}"></div>
    <div class="tp-menu" role="listbox" aria-multiselectable="true" hidden></div>
  </div>`;
}
const tpOpts = (w) => (w.dataset.opts ? JSON.parse(w.dataset.opts) : null);
const tpLabel = (w, v) => tpOpts(w)?.find(([x]) => x === v)?.[1] || v;
const tpChip = (t, label = t) => `<span class="tp-chip">${esc(label)}<button type="button" class="tp-x" data-tag="${esc(t)}" aria-label="Remove ${esc(label)}">×</button></span>`;
const tpGet = (w) => (w.querySelector("input[type=hidden]").value || "").split(",").filter(Boolean);

function tpSet(w, tags, keepOpen = true) {
  const hid = w.querySelector("input[type=hidden]");
  hid.value = tags.join(",");
  hid.dispatchEvent(new Event("change", { bubbles: true }));
  const inp = w.querySelector(".tp-in");
  w.querySelectorAll(".tp-chip").forEach((c) => c.remove());
  inp.insertAdjacentHTML("beforebegin", tags.map((t) => tpChip(t, tpLabel(w, t))).join(""));
  inp.placeholder = tags.length ? "" : w.dataset.ph || "";
  if (keepOpen) tpPaint(w);
}

function tpPaint(w) {
  const inp = w.querySelector(".tp-in");
  const m = w.querySelector(".tp-menu");
  const q = normTag(inp.value);
  const sel = tpGet(w);
  const fixed = tpOpts(w);
  const all = fixed || [...new Set([...knownTags(), ...sel])].map((t) => [t, t]);
  const opts = all.filter(([, l]) => !q || l.toLowerCase().includes(q));
  const create = w.dataset.create === "1" && q && !opts.some(([v]) => v === q) ? `<button type="button" class="tp-opt" data-tp-add="${esc(q)}">${icon.plus(16)} Create “${esc(q)}”</button>` : "";
  m.innerHTML = opts.map(([v, l]) => {
    const on = sel.includes(v);
    return `<button type="button" class="tp-opt${on ? " on" : ""}" role="option" aria-selected="${on}" data-tp-toggle="${esc(v)}"><span class="tp-box2" aria-hidden="true">${on ? "✓" : ""}</span>${esc(l)}</button>`;
  }).join("") + create || `<div class="tp-empty">${w.dataset.create === "1" ? "Type a tag and press Enter" : "No matches"}</div>`;
  const wasHidden = m.hidden;
  m.hidden = false;
  inp.setAttribute("aria-expanded", "true");
  if (wasHidden) m.scrollIntoView({ block: "nearest" });
}

function tpClose(w) {
  const m = w.querySelector(".tp-menu");
  if (m.hidden) return;
  m.hidden = true;
  w.querySelector(".tp-in").setAttribute("aria-expanded", "false");
}

function tpAdd(w, raw) {
  if (w.dataset.create !== "1") {
    const q = normTag(raw);
    const hit = q && tpOpts(w)?.find(([, l]) => l.toLowerCase().includes(q));
    w.querySelector(".tp-in").value = "";
    if (hit && !tpGet(w).includes(hit[0])) return tpSet(w, [...tpGet(w), hit[0]]);
    return tpPaint(w);
  }
  const t = normTag(raw);
  const inp = w.querySelector(".tp-in");
  inp.value = "";
  if (!t) return tpPaint(w);
  const sel = tpGet(w);
  if (!sel.includes(t)) sel.push(t);
  tpSet(w, sel);
}

if (typeof document !== "undefined") {
document.addEventListener("mousedown", (ev) => {
  // Keep focus in the input while clicking an option.
  if (ev.target.closest(".tp-menu")) ev.preventDefault();
});
document.addEventListener("click", (ev) => {
  document.querySelectorAll("[data-tagpick]").forEach((w) => { if (!w.contains(ev.target)) tpClose(w); });
  const w = ev.target.closest("[data-tagpick]");
  if (!w) return;
  const x = ev.target.closest(".tp-x");
  const tog = ev.target.closest("[data-tp-toggle]");
  const add = ev.target.closest("[data-tp-add]");
  if (x) tpSet(w, tpGet(w).filter((t) => t !== x.dataset.tag), !w.querySelector(".tp-menu").hidden);
  else if (tog) {
    const t = tog.dataset.tpToggle;
    const sel = tpGet(w);
    tpSet(w, sel.includes(t) ? sel.filter((s) => s !== t) : [...sel, t]);
    w.querySelector(".tp-in").value = "";
    tpPaint(w);
  } else if (add) tpAdd(w, add.dataset.tpAdd);
  else if (ev.target.closest(".tp-box")) { w.querySelector(".tp-in").focus(); tpPaint(w); }
});
document.addEventListener("focusin", (ev) => {
  if (ev.target.classList?.contains("tp-in")) tpPaint(ev.target.closest("[data-tagpick]"));
});
document.addEventListener("focusout", (ev) => {
  const w = ev.target.closest?.("[data-tagpick]");
  if (w && ev.target.classList.contains("tp-in")) {
    if (ev.target.value.trim()) {
      if (w.dataset.create === "1") tpAdd(w, ev.target.value);
      else ev.target.value = "";
    }
    setTimeout(() => { if (!w.contains(document.activeElement)) tpClose(w); }, 0);
  }
});
document.addEventListener("input", (ev) => {
  if (!ev.target.classList?.contains("tp-in")) return;
  const w = ev.target.closest("[data-tagpick]");
  if (ev.target.value.includes(",")) tpAdd(w, ev.target.value.replace(/,/g, ""));
  else tpPaint(w);
});
document.addEventListener("keydown", (ev) => {
  if (!ev.target.classList?.contains("tp-in")) return;
  const w = ev.target.closest("[data-tagpick]");
  const m = w.querySelector(".tp-menu");
  if (ev.key === "Enter") {
    ev.preventDefault();
    const q = normTag(ev.target.value);
    if (q) tpAdd(w, q);
  } else if (ev.key === "Backspace" && !ev.target.value) {
    const sel = tpGet(w);
    if (sel.length) tpSet(w, sel.slice(0, -1));
  } else if (ev.key === "Escape" && !m.hidden) {
    ev.stopImmediatePropagation();
    tpClose(w);
  } else if (ev.key === "ArrowDown" && !m.hidden) {
    ev.preventDefault();
    m.querySelector("button")?.focus();
  }
});
}

// ⓘ info button: toggles a short explanation under the label it sits in.
export function infoTip(title, bullets) {
  const body = Array.isArray(bullets) ? `<ul>${bullets.map((b) => `<li>${b}</li>`).join("")}</ul>` : `<p>${bullets}</p>`;
  return `<span class="info-wrap"><button type="button" class="info-btn" aria-expanded="false" aria-label="About ${esc(title)}" data-info>i</button><span class="info-pop" role="note" hidden><b>${esc(title)}</b>${body}</span></span>`;
}
if (typeof document !== "undefined") {
  document.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-info]");
    document.querySelectorAll(".info-pop:not([hidden])").forEach((p) => {
      if (!btn || p !== btn.nextElementSibling) {
        p.hidden = true;
        p.previousElementSibling?.setAttribute("aria-expanded", "false");
      }
    });
    if (!btn) return;
    ev.preventDefault();
    const pop = btn.nextElementSibling;
    pop.hidden = !pop.hidden;
    btn.setAttribute("aria-expanded", String(!pop.hidden));
  });
}
