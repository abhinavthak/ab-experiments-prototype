import * as S from "../store.js";
import { analyze, statusPill } from "../analysis.js";
import { can, why, stateOf } from "../rules.js";
import { acts } from "../actions.js";
import { icon, pill, variantChip, avatar, menu, menuItem, emptyRow } from "../ui.js";
import { esc, fmtDate, fmtLift, fmtPct, DAY, daysBetween } from "../util.js";
import { openCreate, openImport } from "./create.js";

const PER_PAGE = 20;
let ui = { tab: "all", q: "", pages: [], owners: [], tags: [], types: [], sort: "updated", page: 1 };
try {
  ui = { ...ui, ...JSON.parse(sessionStorage.getItem("abx-list") || "{}") };
} catch { /* ignore */ }
const persist = () => {
  try { sessionStorage.setItem("abx-list", JSON.stringify(ui)); } catch { /* ignore */ }
};

const TABS = [["all", "All"], ["running", "Running"], ["drafts", "Drafts"], ["stopped", "Stopped"], ["archived", "Archived"]];
const tabOf = (e) => (e.archived ? "archived" : e.status === "running" ? "running" : e.status === "stopped" ? "stopped" : "drafts");
const SORTS = { updated: "Recently updated", name: "Name", status: "Status", started: "Start date" };
const STATUS_ORDER = { running: 0, scheduled: 1, draft: 2, stopped: 3, archived: 4 };

function matches(e, q) {
  if (!q) return true;
  const p = S.page(e.pageId);
  const owner = S.user(e.ownerId).name.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((tok) => {
    const [k, ...rest] = tok.split(":");
    const val = rest.join(":");
    if (rest.length && val) {
      if (k === "is") return stateOf(e) === val || (val === "watched" && e.watched) || (val === "bandit" && e.type === "bandit") || (val === "mine" && e.ownerId === S.get().currentUserId);
      if (k === "owner") return owner.includes(val);
      if (k === "tag") return e.tags.some((t) => t.toLowerCase().includes(val));
      if (k === "page") return (p?.name || "").toLowerCase().includes(val) || (p?.path || "").includes(val);
      if (k === "key") return e.trackingKey.includes(val);
    }
    const hay = `${e.name} ${e.trackingKey} ${e.tags.join(" ")} ${p?.name || ""} ${p?.path || ""} ${e.hypothesis}`.toLowerCase();
    return hay.includes(tok);
  });
}

function statusCell(e) {
  const st = statusPill(e);
  let detail = "";
  let bar = "";
  const now = S.now();
  if (e.status === "running" && !e.archived) {
    const day = daysBetween(e.startedAt, now) + 1;
    const sd = S.stopDate(e);
    if (sd) {
      const total = Math.max(1, Math.round((sd - e.startedAt) / DAY));
      detail = `Day ${Math.min(day, total)} of ${total}`;
      bar = `<div class="track" aria-hidden="true"><div class="fill ${st.tone}" style="width:${Math.min(100, ((now - e.startedAt) / (sd - e.startedAt)) * 100)}%"></div></div>`;
    } else detail = `Day ${day} · started ${fmtDate(e.startedAt)}`;
  } else if (e.status === "scheduled") detail = `Starts ${fmtDate(e.scheduledStart)}`;
  else if (e.status === "draft") detail = `Created ${fmtDate(e.createdAt)}`;
  else if (e.status === "stopped") {
    const days = Math.max(1, Math.round((e.endedAt - e.startedAt) / DAY));
    detail = `${st.label === "Completed" ? "Ended" : "Stopped"} ${fmtDate(e.endedAt)} · ${days} days`;
  }
  return `${pill(st.tone, st.label)}<div class="small">${esc(detail)}</div>${bar}`;
}

function resultCell(e) {
  const vs = S.variantsOf(e);
  if (e.status === "draft" || e.status === "scheduled") return `<span class="muted">Not started</span>`;
  if (e.status === "stopped") {
    const rel = vs.find((v) => v.id === e.releasedVariantId);
    if (!e.result) return `<b>Record a result</b><div class="small">Stopped on its stop date</div>`;
    if (e.result === "won") {
      const w = vs.find((v) => v.id === e.winnerVariantId);
      return `<div class="row" style="gap:8px">${w ? variantChip(w) : ""}<span class="up">Won</span></div>${rel ? `<div class="small">${esc(rel.key)} made the default</div>` : ""}`;
    }
    if (e.result === "lost") return `<span class="down">Lost</span><div class="small">${esc(rel?.key || "A")} kept as default</div>`;
    return `<b style="font-weight:500">${e.result === "dnf" ? "Did not finish" : "No clear winner"}</b>${rel ? `<div class="small">${esc(rel.key)} kept as default</div>` : ""}`;
  }
  const a = analyze(e);
  const d = a.decision;
  if (!d) return "";
  const tone = d.kind === "ship" ? "up" : d.kind === "unhealthy" || d.kind === "rollback" ? "down" : "";
  const best = d.best?.r ? ` <span class="faint">· ${esc(d.best.v.key)} ${fmtLift(d.best.r.lift)}</span>` : "";
  return `<b class="${tone}" style="font-weight:600">${esc(d.label)}</b>${d.kind === "running" || d.kind === "early" ? best : ""}<div class="small">${esc(d.text)}</div>`;
}

function rowActions(e) {
  const href = `#/experiment/${e.id}`;
  const draftish = e.status === "draft" || e.status === "scheduled";
  const primary = draftish && !e.archived
    ? `<a class="btn sm" href="${href}/overview">Continue setup</a>`
    : e.status === "stopped" && !e.result && !e.archived
      ? `<button type="button" class="btn sm" data-act="exp-stop">Record result</button>`
      : `<a class="btn sm" href="${href}/results">Results</a>`;
  const items = [
    menuItem("nav", "View overview", { ic: icon.eye(), data: `data-href="${href}/overview"` }),
    !draftish ? menuItem("nav", "View results", { ic: icon.pulse(18), data: `data-href="${href}/results"` }) : "",
    !draftish ? menuItem("nav", "View health", { ic: icon.target(18), data: `data-href="${href}/health"` }) : "",
    "<hr>",
    draftish && !e.archived ? menuItem("exp-start", "Start now", { ic: icon.play(), disabled: why(e, "startNow") }) : "",
    draftish && !e.archived ? menuItem("exp-schedule", e.status === "scheduled" ? "Reschedule" : "Schedule start", { ic: icon.calendar(), disabled: why(e, "schedule") }) : "",
    e.status === "scheduled" && !e.archived ? menuItem("exp-unschedule", "Unschedule", { ic: icon.clock(), disabled: why(e, "unschedule") }) : "",
    e.status === "running" ? menuItem("exp-stop", "Stop experiment", { ic: icon.stop(), disabled: why(e, "stop") }) : "",
    menuItem("exp-duplicate", "Duplicate", { ic: icon.copy(), disabled: S.canEdit() ? "" : "You need Editor access" }),
    menuItem("exp-copykey", "Copy tracking key", { ic: icon.copy() }),
    e.archived ? menuItem("exp-unarchive", "Unarchive", { ic: icon.archive(), disabled: why(e, "unarchive") }) : menuItem("exp-archive", "Archive", { ic: icon.archive(), disabled: why(e, "archive") }),
    "<hr>",
    menuItem("exp-delete", "Delete", { ic: icon.trash(), danger: true, disabled: S.canEdit() ? "" : "You need Editor access" }),
  ].join("");
  return `<div class="actions">${primary}${menu("⋯", items, { label: `More actions for ${e.name}` })}</div>`;
}

function filterMenu(kind, label, options) {
  const sel = ui[kind] || (ui[kind] = []);
  const items = options.length
    ? options.map(([v, l]) => `<label><input type="checkbox" data-filter="${kind}" value="${esc(v)}" ${sel.includes(v) ? "checked" : ""}> ${esc(l)}</label>`).join("")
    : `<div class="faint" style="padding:8px 12px">None</div>`;
  return `<div class="menu-wrap" data-fmenu="${kind}"><button type="button" class="btn sm" data-menu aria-haspopup="true" aria-expanded="false">${esc(label)}${sel.length ? ` <span class="badge blue">${sel.length}</span>` : ""} ${icon.down()}</button><div class="menu filter-menu" hidden>${items}${sel.length ? `<hr><button type="button" data-act="list-clear-filter" data-kind="${kind}">Clear</button>` : ""}</div></div>`;
}

export function render() {
  const st = S.get();
  const all = st.experiments;
  const nonArchived = all.filter((e) => !e.archived);
  const now = S.now();
  const in30 = (t) => t && now - t <= 30 * DAY && t <= now;
  const sum = {
    running: nonArchived.filter((e) => e.status === "running").length,
    started: nonArchived.filter((e) => in30(e.startedAt)).length,
    ended: nonArchived.filter((e) => e.status === "stopped" && in30(e.endedAt)).length,
    winners: nonArchived.filter((e) => e.status === "stopped" && in30(e.endedAt) && e.result === "won").length,
  };

  const filtered = all.filter(
    (e) =>
      matches(e, ui.q) &&
      (!ui.pages.length || ui.pages.includes(e.pageId)) &&
      (!ui.owners.length || ui.owners.includes(e.ownerId)) &&
      (!ui.tags.length || e.tags.some((t) => ui.tags.includes(t))) &&
      (!(ui.types || []).length || ui.types.includes(e.type || "standard")),
  );
  const counts = Object.fromEntries(TABS.map(([k]) => [k, k === "all" ? filtered.filter((e) => !e.archived).length : filtered.filter((e) => tabOf(e) === k).length]));
  let rows = ui.tab === "all" ? filtered.filter((e) => !e.archived) : filtered.filter((e) => tabOf(e) === ui.tab);
  const sorters = {
    updated: (a, b) => b.updatedAt - a.updatedAt,
    name: (a, b) => a.name.localeCompare(b.name),
    status: (a, b) => STATUS_ORDER[stateOf(a)] - STATUS_ORDER[stateOf(b)] || b.updatedAt - a.updatedAt,
    started: (a, b) => (b.startedAt ?? b.scheduledStart ?? 0) - (a.startedAt ?? a.scheduledStart ?? 0),
  };
  rows = [...rows].sort(sorters[ui.sort]);
  // Watched experiments first, as in GrowthBook.
  rows.sort((a, b) => (b.watched ? 1 : 0) - (a.watched ? 1 : 0));
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  ui.page = Math.min(ui.page, pages);
  const shown = rows.slice((ui.page - 1) * PER_PAGE, ui.page * PER_PAGE);
  const anyFilter = ui.q || ui.pages.length || ui.owners.length || ui.tags.length || (ui.types || []).length;

  const canCreate = S.canEdit();
  const newBtn = canCreate
    ? `<div class="split-btn"><button type="button" class="btn primary lg" data-act="exp-new">${icon.plus()} New experiment</button>${menu(icon.down(18), [
        menuItem("exp-new", "A/B test", { ic: icon.flask(18) }),
        menuItem("exp-new-bandit", "Multi-armed bandit", { ic: icon.pulse(18) }),
        S.get().templates.length ? "<hr>" + S.get().templates.map((t) => menuItem("tpl-use", `From template: ${t.name}`, { ic: icon.form(18), data: `data-tid="${t.id}"` })).join("") : "",
        "<hr>",
        menuItem("exp-import", "Analyze a past experiment", { ic: icon.archive(18) }),
      ].join(""), { label: "More ways to create", cls: "btn primary lg icon-btn" })}</div>`
    : `<button type="button" class="btn primary lg" data-act="exp-new" aria-disabled="true" title="You need Editor access to create experiments">${icon.plus()} New experiment</button>`;

  if (!all.length) {
    return `<div class="page-head"><div><h1>Experiments</h1><div class="sub">Test page variants against the default and ship the winner</div></div>${newBtn}</div>
      <div class="card"><div class="empty"><h3>No experiments yet</h3><div>Test page variants against the default. You need a live page with at least 2 variants.</div><div style="margin-top:14px">${newBtn}</div></div></div>`;
  }

  const allTags = [...new Set(all.flatMap((e) => e.tags))].sort();
  const usedPages = st.pages.filter((p) => all.some((e) => e.pageId === p.id));
  const usedOwners = S.USERS.filter((u) => all.some((e) => e.ownerId === u.id));

  return `
  <div class="page-head">
    <div><h1>Experiments</h1><div class="sub">Test page variants against the default and ship the winner · ${nonArchived.length} experiment${nonArchived.length === 1 ? "" : "s"}</div></div>
    <div class="head-actions">${newBtn}${canCreate ? "" : `<div class="hint" style="width:100%;text-align:right">You need Editor access to create experiments</div>`}</div>
  </div>
  ${ui.tab !== "archived" ? `<div class="card summary"><span class="eyebrow">Last 30 days</span><span><b>${sum.running}</b> running now</span><span><b>${sum.started}</b> started</span><span><b>${sum.ended}</b> ended</span><span><b>${sum.winners}</b> winner${sum.winners === 1 ? "" : "s"} shipped</span></div>` : ""}
  <div class="card">
    <div class="toolbar">
      <label class="search"><span class="sr-only">Search experiments</span>${icon.search()}<input class="inp" type="search" data-list-search value="${esc(ui.q)}" placeholder="Search name, key, tag · try is:running"></label>
      <div class="seg" role="tablist" aria-label="Status">${TABS.map(([k, l]) => `<button type="button" role="tab" aria-selected="${ui.tab === k}" data-act="list-tab" data-tab="${k}">${l}${k !== "archived" || counts[k] ? `<span class="count">${counts[k]}</span>` : ""}</button>`).join("")}</div>
      <div class="end">
        ${filterMenu("pages", "Page", usedPages.map((p) => [p.id, p.name]))}
        ${filterMenu("owners", "Owner", usedOwners.map((u) => [u.id, u.name]))}
        ${filterMenu("tags", "Tags", allTags.map((t) => [t, t]))}
        ${filterMenu("types", "Type", [["standard", "A/B test"], ["bandit", "Bandit"]])}
        ${menu(`${esc(SORTS[ui.sort])} ${icon.down()}`, Object.entries(SORTS).map(([k, l]) => menuItem("list-sort", `${ui.sort === k ? "✓ " : ""}${l}`, { data: `data-sort="${k}"` })).join(""), { label: "Sort", cls: "btn sm" })}
      </div>
    </div>
    <div class="table-wrap"><table class="t wide">
      <thead><tr><th style="width:44px"><span class="sr-only">Watch</span></th><th>Experiment</th><th style="width:170px">Primary metric</th><th style="width:210px">Status</th><th style="width:220px">Result</th><th style="width:200px"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${shown.length ? shown.map((e) => {
        const p = S.page(e.pageId);
        const vs = S.variantsOf(e);
        const pm = S.metric(e.primaryMetric);
        const extra = e.secondaryMetrics.length;
        return `<tr data-id="${e.id}">
          <td><button type="button" class="star ${e.watched ? "on" : ""}" data-act="exp-watch" aria-pressed="${e.watched}" aria-label="${e.watched ? "Stop watching" : "Watch"} ${esc(e.name)}">${e.watched ? "★" : "☆"}</button></td>
          <td><a class="exp-name" href="#/experiment/${e.id}/${e.status === "draft" || e.status === "scheduled" ? "overview" : "results"}">${esc(e.name)}</a>
            <div class="meta">${e.type === "bandit" ? `<span class="badge blue">Bandit</span>` : ""}${e.imported ? `<span class="badge">Imported</span>` : ""}<span>${esc(p?.name || "Deleted page")}</span><span aria-hidden="true">·</span><span class="mono">${esc(e.trackingKey)}</span>${e.tags.map((t) => `<span class="badge">${esc(t)}</span>`).join("")}</div>
            <div class="chips"><span class="chip-row">${vs.map((v) => variantChip(v)).join("")}</span><span aria-hidden="true" style="color:var(--border)">|</span>${avatar(e.ownerId)}</div></td>
          <td>${pm ? `<b style="font-weight:500;font-size:14px">${esc(pm.name)}</b>${extra ? ` <span class="faint">+${extra}</span>` : ""}` : `<span class="faint">None</span>`}</td>
          <td>${statusCell(e)}</td>
          <td>${resultCell(e)}</td>
          <td>${rowActions(e)}</td></tr>`;
      }).join("") : emptyRow(6, anyFilter ? "No experiments match the current filter." : ui.tab === "archived" ? "No archived experiments" : "Nothing here yet", "", anyFilter ? `<button type="button" class="btn sm" data-act="list-clear-all">Clear filters</button>` : "")}</tbody>
    </table></div>
    ${pages > 1 ? `<div class="toolbar" style="border-top:1px solid var(--border);border-bottom:0;justify-content:flex-end"><div class="pager"><button type="button" class="btn xs" data-act="list-page" data-p="${ui.page - 1}" ${ui.page === 1 ? "disabled" : ""}>‹ Prev</button>${Array.from({ length: pages }, (_, i) => `<button type="button" class="btn xs ${i + 1 === ui.page ? "primary" : ""}" data-act="list-page" data-p="${i + 1}" aria-current="${i + 1 === ui.page}">${i + 1}</button>`).join("")}<button type="button" class="btn xs" data-act="list-page" data-p="${ui.page + 1}" ${ui.page === pages ? "disabled" : ""}>Next ›</button></div></div>` : ""}
  </div>
  <div class="foot"><span>Showing ${shown.length} of ${rows.length}</span><span>One running or scheduled experiment per page at a time</span></div>`;
}

export function bind(root, rerender) {
  const input = root.querySelector("[data-list-search]");
  input?.addEventListener("input", () => {
    ui.q = input.value;
    ui.page = 1;
    persist();
    const pos = input.selectionStart;
    rerender();
    const again = document.querySelector("[data-list-search]");
    again.focus();
    again.setSelectionRange(pos, pos);
  });
  root.querySelectorAll("[data-filter]").forEach((cb) =>
    cb.addEventListener("change", () => {
      const k = cb.dataset.filter;
      ui[k] = cb.checked ? [...ui[k], cb.value] : ui[k].filter((x) => x !== cb.value);
      ui.page = 1;
      persist();
      rerender({ keepMenu: k });
    }),
  );
}

Object.assign(acts, {
  "list-tab": (el, rr) => { ui.tab = el.dataset.tab; ui.page = 1; persist(); rr(); },
  "list-sort": (el, rr) => { ui.sort = el.dataset.sort; persist(); rr(); },
  "list-page": (el, rr) => { ui.page = Number(el.dataset.p); persist(); rr(); },
  "list-clear-filter": (el, rr) => { ui[el.dataset.kind] = []; persist(); rr(); },
  "list-clear-all": (el, rr) => { Object.assign(ui, { q: "", pages: [], owners: [], tags: [], types: [], page: 1 }); persist(); rr(); },
  "exp-new": () => openCreate(),
  "exp-new-bandit": () => openCreate(null, { type: "bandit" }),
  "exp-import": () => openImport(),
});
export const pct = fmtPct;
