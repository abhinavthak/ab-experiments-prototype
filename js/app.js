import * as S from "./store.js";
import { acts } from "./actions.js";
import { icon, closeMenus, closeModal, isModalOpen } from "./ui.js";
import { esc, initials, fmtDate, toast, $ } from "./util.js";
import * as List from "./views/list.js";
import * as Detail from "./views/detail.js";
import * as Pages from "./views/pages.js";
import * as Misc from "./views/misc.js";
import * as Lib from "./views/library.js";
import * as Aud from "./views/targeting.js";

S.load();

function parse() {
  const raw = location.hash.replace(/^#/, "") || "/experiments";
  const [path, qs = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  return { parts, query: new URLSearchParams(qs) };
}

function route() {
  const { parts, query } = parse();
  const [a, b, c] = parts;
  if (a === "experiment" && b) return { nav: "experiments", render: () => Detail.render({ id: b, tab: c }), bind: (r, rr) => Detail.bind(r, rr, { id: b }), title: S.exp(b)?.name };
  if (a === "pages") return { nav: "pages", render: Pages.renderList, bind: Pages.bindList, title: "Pages" };
  if (a === "page" && b) return { nav: "pages", render: () => Pages.renderEditor({ id: b, query }), mount: () => Pages.onEditorMount({ id: b, query }), title: S.page(b)?.name };
  if (a === "metrics") return { nav: "metrics", render: Misc.renderMetrics, title: "Metrics" };
  if (a === "metric" && b) return { nav: "metrics", render: () => Misc.renderMetric(b), title: S.metric(b)?.name };
  if (a === "insights") return { nav: "insights", render: Lib.renderInsights, bind: Lib.bindInsights, title: "Insights" };
  if (a === "holdouts") return { nav: "holdouts", render: Lib.renderHoldouts, title: "Holdouts" };
  if (a === "holdout" && b) return { nav: "holdouts", render: () => Lib.renderHoldout(b), bind: (r, rr) => Lib.bindHoldout(r, rr, b), title: S.holdout(b)?.name };
  if (a === "report" && b) return { nav: "experiments", render: () => Lib.renderReport(b), bind: (r, rr) => Lib.bindReport(r, rr, b), title: S.report(b)?.title };
  if (a === "templates") return { nav: "templates", render: Lib.renderTemplates, title: "Templates" };
  if (a === "audiences") return { nav: "audiences", render: Aud.renderAudiences, title: "Audiences" };
  if (a === "settings") return { nav: "settings", render: Misc.renderSettings, bind: Misc.bindSettings, title: "Settings" };
  return { nav: "experiments", render: List.render, bind: List.bind, title: "Experiments" };
}

const NAV = [
  ["WEBSITE", [["pages", "Pages", icon.page(), "#/pages"], ["", "Widget Blocks", icon.grid()], ["", "Widget Management", icon.layers()], ["", "Live Lectures", icon.screen()], ["", "File Bucket", icon.folder()]]],
  ["GROWTH", [["experiments", "Experiments", icon.flask(), "#/experiments"], ["insights", "Insights", icon.pulse(), "#/insights"], ["holdouts", "Holdouts", icon.layers(), "#/holdouts"], ["metrics", "Metrics", icon.target(), "#/metrics"], ["audiences", "Audiences", icon.users(), "#/audiences"], ["templates", "Templates", icon.form(), "#/templates"]]],
  ["LEADS", [["", "Lead Payments", icon.card()], ["", "MOOC Registrations", icon.cap()]]],
  ["LEAD FORMS", [["", "Form Builder", icon.form()], ["", "Custom Form", icon.form()]]],
  ["ADMIN", [["settings", "Settings", icon.gear(), "#/settings"], ["", "Users", icon.users()], ["", "Core Web Vitals", icon.pulse()]]],
];

function shell(active) {
  const me = S.me();
  const st = S.get();
  return `<aside class="side" id="side">
    <div class="brand"><span class="brand-mark">${icon.page(18)}</span>University CMS</div>
    <nav aria-label="Main">${NAV.map(([h, items]) => `<div class="navh">${h}</div>${items.map(([k, l, ic, href, tag]) => `<a class="nav ${k && k === active ? "on" : ""}" href="${href || "#"}" ${href ? "" : 'data-act="soon"'} ${k === active ? 'aria-current="page"' : ""}>${ic}<span>${l}</span>${tag ? `<span class="tag">${tag}</span>` : ""}</a>`).join("")}`).join("")}</nav>
    <div class="me"><span class="avatar lg">${esc(initials(me.name))}</span><div class="who"><div style="font-weight:500">${esc(me.name)}</div><div class="role">${esc(st.role)}</div></div><a class="btn ghost icon-btn sm" href="#/settings" aria-label="Switch user or role">${icon.gear(18)}</a></div>
  </aside>
  <button type="button" class="btn sm menu-toggle" data-act="toggle-side" aria-controls="side" aria-label="Open menu">${icon.menu()}</button>
  <main class="content" id="main" tabindex="-1"><div class="wrap" id="view"></div></main>`;
}

function protoBar() {
  const st = S.get();
  return `<nav class="proto-bar" aria-label="Prototype controls"><span class="lbl">Prototype · simulated data</span><span class="lbl">${fmtDate(S.now())}${st.clockOffsetDays ? ` (+${st.clockOffsetDays}d)` : ""}</span>
    <button type="button" data-act="clock" data-d="1" title="Move the simulated clock forward one day">+1 day</button>
    ${st.clockOffsetDays ? `<button type="button" data-act="clock" data-d="0">Today</button>` : ""}
    <a href="design/index.html">Design screens</a>
    <button type="button" class="hl" data-act="reset-demo">Reset</button></nav>`;
}

let lastNav = null;
function render(opts = {}) {
  const r = route();
  const app = $("#app");
  if (lastNav !== r.nav || !$("#view")) {
    app.innerHTML = shell(r.nav);
    lastNav = r.nav;
  } else {
    // refresh sidebar user/role
    const side = $("#side");
    side.outerHTML = shell(r.nav).split("</aside>")[0] + "</aside>";
  }
  const view = $("#view");
  const scroll = window.scrollY;
  view.innerHTML = r.render();
  r.bind?.(view, render);
  $("#proto").innerHTML = protoBar();
  document.title = `${r.title ? `${r.title} · ` : ""}University CMS prototype`;
  if (opts.keepMenu) {
    const btn = view.querySelector(`[data-fmenu="${opts.keepMenu}"] [data-menu]`);
    if (btn) openMenu(btn);
  }
  if (opts.scrollTop) window.scrollTo(0, 0);
  else window.scrollTo(0, scroll);
  if (opts.mount) r.mount?.();
}

function openMenu(btn) {
  const m = btn.nextElementSibling;
  closeMenus(m);
  m.hidden = !m.hidden;
  btn.setAttribute("aria-expanded", String(!m.hidden));
  if (!m.hidden) {
    const rect = m.getBoundingClientRect();
    m.classList.toggle("up", rect.bottom > window.innerHeight - 70 && rect.height < btn.getBoundingClientRect().top);
    m.querySelector("button:not([disabled]), a, input")?.focus();
  }
}

document.addEventListener("click", (ev) => {
  const menuBtn = ev.target.closest("[data-menu]");
  if (menuBtn) {
    ev.preventDefault();
    openMenu(menuBtn);
    return;
  }
  if (!ev.target.closest(".menu")) closeMenus();
  const el = ev.target.closest("[data-act]");
  if (!el || el.disabled || el.getAttribute("aria-disabled") === "true") {
    if (el?.getAttribute("aria-disabled") === "true" && el.title) toast(el.title, "bad");
    return;
  }
  const act = el.dataset.act;
  if (act === "modal-close") return closeModal();
  if (act === "modal-close-nav") return closeModal();
  if (act === "nav") {
    ev.preventDefault();
    closeMenus();
    location.hash = el.dataset.href;
    return;
  }
  if (act === "soon") {
    ev.preventDefault();
    toast("Not part of this prototype");
    return;
  }
  if (act === "toggle-side") {
    $("#side").classList.toggle("open");
    return;
  }
  const fn = acts[act];
  if (fn) {
    ev.preventDefault();
    closeMenus();
    fn(el, render);
  }
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    if (isModalOpen()) closeModal();
    else closeMenus();
  }
});

window.addEventListener("hashchange", () => {
  closeModal();
  $("#side")?.classList.remove("open");
  render({ scrollTop: true, mount: true });
  $("#main")?.focus({ preventScroll: true });
});
S.onChange(() => render());
// Pick up scheduled starts / stop dates while the tab stays open.
setInterval(() => S.reconcile(), 60000);

render({ mount: true });
