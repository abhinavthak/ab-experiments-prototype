// Holdouts,
// shareable reports.
import * as S from "../store.js";
import { acts, go } from "../actions.js";
import { analyze, statusPill } from "../analysis.js";
import { icon, pill, avatar, variantChip, openModal, closeModal, confirmModal, emptyRow, callout } from "../ui.js";
import { esc, fmtDate, fmtInt, fmtPct, fmtLift, DAY, toast, uid, copyText, startOfDay } from "../util.js";
import { resultsBody, bindResults, defaultRes } from "./detail.js";
import { RESULT_LABEL } from "../store.js";

/* ---------- Holdouts ---------- */
// A holdout keeps a slice of visitors on every page's default from the
// holdout's start, so the combined effect of everything shipped since can
// be measured: Holdout (A) vs General population (B).
export function holdoutExperiment(h) {
  const st = S.get();
  const pages = h.pageIds.map(S.page).filter(Boolean);
  const traffic = pages.reduce((a, p) => a + p.traffic, 0) || 1;
  const shipped = st.experiments.filter((e) => h.pageIds.includes(e.pageId) && e.result === "won" && e.endedAt >= h.startedAt && (!h.endedAt || e.endedAt <= h.endedAt));
  const lifts = {};
  h.metrics.forEach((mid) => {
    lifts[mid] = shipped.reduce((acc, e) => {
      const key = S.variantsOf(e).find((v) => v.id === e.winnerVariantId)?.key;
      const l = e.sim?.lifts?.[key]?.[mid] ?? 0;
      return acc + l * (S.page(e.pageId).traffic / traffic);
    }, 0);
  });
  const targeting = { audience: "all", device: "all", excludeLeads: false, conditions: [] };
  return {
    id: h.id, name: h.name, status: h.endedAt ? "stopped" : "holdout", startedAt: h.startedAt, endedAt: h.endedAt, weights: [h.percent, 100 - h.percent], coverage: 100, targeting,
    type: "standard", primaryMetric: h.metrics[0], secondaryMetrics: h.metrics.slice(1), guardrailMetrics: [], activationMetric: null, statsEngine: st.settings.statsEngine, sequential: false, cuped: false,
    traffic, pageId: pages[0]?.id, namespace: null, midTestEdits: [], result: null, analysisSummary: "",
    virtualVariants: [{ id: "hv_a", key: "A", name: "Holdout", changes: 0 }, { id: "hv_b", key: "B", name: "General population", changes: 0 }],
    sim: { seed: h.seed, lifts: { B: lifts } },
    phases: [{ start: h.startedAt, end: h.endedAt, weights: [h.percent, 100 - h.percent], coverage: 100, targeting, reason: "Holdout" }],
    shipped,
  };
}

export function renderHoldouts() {
  const st = S.get();
  return `<div class="page-head"><div><h1>Holdouts</h1><div class="sub">Measure the combined, long-term impact of everything you ship</div></div>
    <button type="button" class="btn primary lg" data-act="ho-new" ${S.canEdit() ? "" : "disabled"}>${icon.plus()} New holdout</button></div>
    ${callout("info", "A holdout keeps a small share of visitors on each page's original default, even after experiments ship winners. Comparing them with everyone else shows the real, combined effect of your experiment program. Experiments on these pages run on the remaining traffic.")}
    <div class="card" style="margin-top:16px"><div class="table-wrap"><table class="t" style="min-width:760px"><thead><tr><th>Holdout</th><th>Pages</th><th class="num">Held out</th><th>Status</th><th>Shipped since start</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
    ${st.holdouts.length ? st.holdouts.map((h) => {
      const he = holdoutExperiment(h);
      return `<tr><td><a class="exp-name" href="#/holdout/${h.id}">${esc(h.name)}</a><div class="small" style="margin:2px 0 0">Since ${fmtDate(h.startedAt)} · ${avatar(h.ownerId)}</div></td><td>${h.pageIds.map((id) => esc(S.page(id)?.name || "")).join("<br>")}</td><td class="num">${h.percent}%</td>
        <td>${h.endedAt ? pill("gray", "Stopped") : pill("green", "Running")}</td><td>${he.shipped.length} winner${he.shipped.length === 1 ? "" : "s"}</td><td><a class="btn sm" href="#/holdout/${h.id}">Results</a></td></tr>`;
    }).join("") : emptyRow(6, "No holdouts")}</tbody></table></div></div>`;
}

const hoUi = new Map();
export function renderHoldout(id) {
  const h = S.holdout(id);
  if (!h) return `<div class="card"><div class="empty"><h3>Holdout not found</h3></div></div>`;
  const he = holdoutExperiment(h);
  if (!hoUi.has(id)) hoUi.set(id, defaultRes());
  return `<div class="crumbs"><a href="#/holdouts">Holdouts</a></div>
    <div class="page-head"><div><div class="row" style="gap:12px"><h1 style="font-size:28px">${esc(h.name)}</h1>${h.endedAt ? pill("gray", "Stopped") : pill("green", "Running")}</div>
      <div class="sub">${h.percent}% held out since ${fmtDate(h.startedAt)}${h.endedAt ? ` until ${fmtDate(h.endedAt)}` : ""} · ${esc(h.pageIds.map((x) => S.page(x)?.name).join(", "))}</div></div>
      <div class="head-actions">${!h.endedAt && S.canEdit() ? `<button type="button" class="btn sm" data-act="ho-stop" data-hid="${h.id}">${icon.stop()} Stop holdout</button>` : ""}${S.canEdit() ? `<button type="button" class="btn sm" data-act="ho-delete" data-hid="${h.id}">${icon.trash()} Delete</button>` : ""}</div></div>
    ${h.desc ? `<p class="muted" style="margin-top:0">${esc(h.desc)}</p>` : ""}
    <section class="card pad"><h2>Shipped since the holdout started</h2><div class="card-sub">General population sees these winners; the holdout doesn't.</div>
      ${he.shipped.length ? `<ul class="timeline">${he.shipped.map((e) => `<li>${variantChip(S.variantsOf(e).find((v) => v.id === e.winnerVariantId) || { key: "?", name: "" })}<div><a href="#/experiment/${e.id}/results">${esc(e.name)}</a><div class="when">Shipped ${fmtDate(e.endedAt)}</div></div></li>`).join("")}</ul>` : `<p class="faint">Nothing shipped yet. Until then the two groups should look the same.</p>`}</section>
    <div data-holdout="${h.id}">${resultsBody(he, hoUi.get(id), { report: true })}</div>`;
}
export function bindHoldout(root, rr, id) {
  if (hoUi.has(id)) bindResults(root, hoUi.get(id), () => rr());
}

/* ---------- Reports ---------- */
export function renderReport(id) {
  const r = S.report(id);
  const e = r && S.exp(r.expId);
  if (!r || !e) return `<div class="card"><div class="empty"><h3>Report not found</h3><div>It, or its experiment, may have been deleted.</div></div></div>`;
  const s = r.settings;
  const mine = S.canEdit();
  return `<div class="crumbs"><a href="#/experiments">Experiments</a> / <a href="#/experiment/${e.id}/results">${esc(e.name)}</a> / Report</div>
    <div class="page-head"><div style="min-width:0"><h1 style="font-size:28px">${esc(r.title)}</h1>
      <div class="sub">Report on <a href="#/experiment/${e.id}/results">${esc(e.name)}</a> · ${avatar(r.by)} ${esc(S.user(r.by).name)} · ${fmtDate(r.createdAt)} · ${esc(S.page(e.pageId)?.name || "")}</div></div>
      <div class="head-actions"><button type="button" class="btn sm" data-act="rep-copy">${icon.copy()} Copy link</button>${mine ? `<button type="button" class="btn sm" data-act="rep-edit" data-rid="${r.id}">${icon.edit()} Edit</button><button type="button" class="btn sm" data-act="rep-delete" data-rid="${r.id}">${icon.trash()} Delete</button>` : ""}</div></div>
    ${r.note ? `<section class="card pad"><p style="margin:0;white-space:pre-wrap">${esc(r.note)}</p></section>` : ""}
    ${e.hypothesis ? `<p><b>Hypothesis:</b> ${esc(e.hypothesis)}</p>` : ""}
    <div class="small" style="margin-bottom:12px">Saved settings: phase ${(s.phase ?? 0) + 1} · baseline ${esc(S.variantsOf(e)[s.baseline]?.key || "A")} · ${esc(s.difference)} difference${s.dimension ? ` · by ${esc(s.dimension)}` : ""}. ${mine ? "Changing the controls below updates the report." : ""}</div>
    <div data-report="${r.id}">${resultsBody(e, r.settings, { report: true })}</div>`;
}
export function bindReport(root, rr, id) {
  const r = S.report(id);
  if (!r) return;
  bindResults(root, r.settings, () => {
    if (S.canEdit()) S.save();
    else rr();
  });
}

Object.assign(acts, {
  "rep-copy": () => copyText(location.href),
  "rep-edit": (el) => {
    const r = S.report(el.dataset.rid);
    openModal({
      title: "Edit report",
      wide: true,
      body: `<div class="field"><label for="rp-t">Title</label><input id="rp-t" name="title" class="inp" value="${esc(r.title)}"></div><div class="field"><label for="rp-n">Note for readers</label><textarea id="rp-n" name="note" class="inp">${esc(r.note || "")}</textarea></div>`,
      footer: `<button type="button" class="btn sm" data-act="modal-close">Cancel</button><button type="submit" class="btn sm primary">Save</button>`,
      onSubmit: (fd) => {
        r.title = String(fd.get("title")).trim() || r.title;
        r.note = String(fd.get("note")).trim();
        S.save();
        closeModal();
      },
    });
  },
  "rep-delete": (el) => confirmModal({ title: "Delete report?", danger: true, tone: "red", confirm: "Delete", text: "The report link stops working. The experiment isn't affected.", onConfirm: () => {
    const r = S.report(el.dataset.rid);
    S.get().reports = S.get().reports.filter((x) => x.id !== r.id);
    S.save();
    go(`#/experiment/${r.expId}/results`);
  } }),
  "ho-new": () => {
    const st = S.get();
    openModal({
      title: "New holdout",
      wide: true,
      body: `<div class="field"><label for="ho-n">Name</label><input id="ho-n" name="name" class="inp" placeholder="e.g. 2027 H1 holdout"><div data-err="name"></div></div>
        <div class="field"><label for="ho-d">Description <span class="opt">· optional</span></label><input id="ho-d" name="desc" class="inp"></div>
        <div class="field"><label for="ho-p">Share of visitors to hold out</label><div class="pct-input"><input id="ho-p" name="percent" type="number" class="inp" min="1" max="20" value="5"><span>%</span></div><div class="hint">Usually 2–10%. These visitors never see experiment variants on the chosen pages.</div></div>
        <div class="field"><span class="label">Pages</span><div class="stack-sm">${st.pages.filter((p) => p.status === "live").map((p) => `<label class="check"><input type="checkbox" name="page" value="${p.id}"><span><span class="t1">${esc(p.name)}</span><span class="t2">${esc(p.path)}</span></span></label>`).join("")}</div><div data-err="page"></div></div>
        <div class="field"><span class="label">Metrics</span><div class="row" style="gap:8px">${st.metrics.map((m) => `<label class="badge" style="padding:6px 10px;cursor:pointer;font-weight:500"><input type="checkbox" name="metric" value="${m.id}"> ${esc(m.name)}</label>`).join("")}</div><div data-err="metric"></div></div>`,
      footer: `<button type="button" class="btn sm" data-act="modal-close">Cancel</button><button type="submit" class="btn sm primary">Start holdout</button>`,
      onSubmit: (fd, form) => {
        const errs = {};
        const name = String(fd.get("name")).trim();
        if (!name) errs.name = "Enter a name";
        if (!fd.getAll("page").length) errs.page = "Pick at least one page";
        if (!fd.getAll("metric").length) errs.metric = "Pick at least one metric";
        form.querySelectorAll("[data-err]").forEach((x) => (x.innerHTML = errs[x.dataset.err] ? `<div class="err">${icon.warn(14)} ${esc(errs[x.dataset.err])}</div>` : ""));
        if (Object.keys(errs).length) return;
        const h = { id: uid("h"), name, desc: String(fd.get("desc")).trim(), percent: Math.max(1, Math.min(20, Number(fd.get("percent")) || 5)), pageIds: fd.getAll("page"), metrics: fd.getAll("metric"), status: "running", startedAt: S.now(), endedAt: null, ownerId: st.currentUserId, seed: Math.floor(Math.random() * 1000) };
        st.holdouts.unshift(h);
        S.save();
        closeModal();
        toast("Holdout started. Results build up as experiments ship winners.", "good");
        go(`#/holdout/${h.id}`);
      },
    });
  },
  "ho-stop": (el) => confirmModal({ title: "Stop this holdout?", confirm: "Stop", tone: "amber", ic: icon.warn(18), text: "Held-out visitors start seeing the current page defaults. Results stay readable.", onConfirm: () => {
    S.holdout(el.dataset.hid).endedAt = S.now();
    S.save();
  } }),
  "ho-delete": (el) => confirmModal({ title: "Delete holdout?", danger: true, tone: "red", confirm: "Delete", text: "This can't be undone.", onConfirm: () => {
    S.get().holdouts = S.get().holdouts.filter((h) => h.id !== el.dataset.hid);
    S.save();
    go("#/holdouts");
  } }),
});
export const _int = fmtInt;
