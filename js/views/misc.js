import * as S from "../store.js";
import { acts } from "../actions.js";
import { icon, openModal, closeModal, confirmModal } from "../ui.js";
import { esc, fmtPct, fmtDate, toast, uid, rng, hash } from "../util.js";
import * as C from "../metric-catalog.js";

export function renderMetrics() {
  const st = S.get();
  const used = (id) => st.experiments.filter((e) => e.primaryMetric === id || e.secondaryMetrics.includes(id) || e.guardrailMetrics.includes(id) || e.activationMetric === id).length;
  return `<div class="page-head"><div><h1>Metrics</h1><div class="sub">What experiments measure. ${st.metrics.length} metrics.</div></div>
    <button type="button" class="btn primary lg" data-act="metric-new" ${S.canEdit() ? "" : "disabled"}>${icon.plus()} New metric</button></div>
  <div class="card"><div class="table-wrap"><table class="t" style="min-width:860px"><thead><tr><th>Metric</th><th>Group</th><th>Type</th><th>Goal</th><th>Window</th><th class="num">Used in</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
  ${st.metrics.map((m) => `<tr><td><a class="exp-name" href="#/metric/${m.id}">${esc(m.name)}</a><div class="small" style="margin:2px 0 0">${esc(m.desc || "")}${m.requires === "leadForm" ? " · needs a page with a lead form" : ""}</div></td><td>${esc(m.group)}</td>
    <td>${esc(C.kindLabel(m))}<div class="small" style="margin:2px 0 0">${esc(C.countsLabel(m))}${C.countsLabel(m) ? " · " : ""}baseline ${m.type === "binomial" ? fmtPct(m.base, m.base < 0.1 ? 2 : 1) : `${m.unit === "₹" ? "₹" + Math.round(m.base).toLocaleString("en-IN") : m.base + (m.unit || "")}`}</div></td><td>${m.higherIsBetter === false ? "Lower is better" : "Higher is better"}</td><td>${m.windowHours ? `${m.windowHours >= 48 ? `${Math.round(m.windowHours / 24)} days` : `${m.windowHours}h`}` : "No limit"}</td>
    <td class="num">${used(m.id)} experiment${used(m.id) === 1 ? "" : "s"}</td>
    <td><div class="actions"><button type="button" class="btn xs" data-act="metric-edit" data-mid="${m.id}" ${S.canEdit() ? "" : "disabled"}>Edit</button>${m.custom && S.canEdit() ? `<button type="button" class="btn xs" data-act="metric-delete" data-mid="${m.id}" ${used(m.id) ? 'disabled title="In use by an experiment"' : ""}>Delete</button>` : ""}</div></td></tr>`).join("")}
  </tbody></table></div></div>`;
}

export function renderMetric(id) {
  const m = S.metric(id);
  if (!m) return `<div class="card"><div class="empty"><h3>Metric not found</h3></div></div>`;
  const st = S.get();
  const exps = st.experiments.filter((e) => [e.primaryMetric, ...e.secondaryMetrics, ...e.guardrailMetrics, e.activationMetric].includes(m.id));
  return `<div class="crumbs"><a href="#/metrics">Metrics</a></div>
    <div class="page-head"><div><h1 style="font-size:28px">${esc(m.name)}</h1><div class="sub">${esc(m.desc || "")}</div></div><button type="button" class="btn sm" data-act="metric-edit" data-mid="${m.id}" ${S.canEdit() ? "" : "disabled"}>${icon.edit()} Edit</button></div>
    <div class="grid2"><section class="card pad"><h2>Definition</h2><dl class="kv">
      <dt>Type</dt><dd>${esc(C.kindLabel(m))}</dd>
      ${m.def ? `<dt>Counts</dt><dd>${esc(C.countsLabel(m))}</dd>` : ""}
      <dt>Group</dt><dd>${esc(m.group)}</dd><dt>Goal</dt><dd>${m.higherIsBetter === false ? "Lower is better" : "Higher is better"}</dd>
      <dt>Baseline</dt><dd>${m.type === "binomial" ? fmtPct(m.base, 2) : `${m.base}${m.unit || ""}`} <span class="faint">(used for planning)</span></dd>
      <dt>Conversion window</dt><dd>${m.windowHours ? `Within ${m.windowHours} hours of first exposure` : "Any time during the experiment"}</dd>
      <dt>Minimum data</dt><dd>${m.minSample ?? 100} ${m.type === "binomial" ? "conversions" : "visitors"} across baseline and variant before showing results</dd>
      <dt>Suspicious change</dt><dd>Flag changes over ${fmtPct(m.maxChange ?? 0.5, 0)}</dd>
      <dt>Default guardrail cutoff</dt><dd>${fmtPct(m.guardrailCutoff ?? 0.02, 0)} worse; suggested when added as a guardrail, set per experiment</dd>
      <dt>Planning lift</dt><dd>${fmtPct(m.targetMde ?? 0.1, 0)}</dd></dl></section>
    <section class="card"><div class="toolbar"><b>Experiments using it</b></div><div class="table-wrap"><table class="t compact"><thead><tr><th>Experiment</th><th>Role</th><th>Status</th></tr></thead><tbody>
      ${exps.length ? exps.map((e) => `<tr><td><a href="#/experiment/${e.id}/results">${esc(e.name)}</a></td><td>${e.primaryMetric === m.id ? "Primary" : e.guardrailMetrics.includes(m.id) ? "Guardrail" : e.activationMetric === m.id ? "Activation" : "Secondary"}</td><td>${esc(e.archived ? "archived" : e.status)}</td></tr>`).join("") : `<tr><td colspan="3" class="faint">Not used yet</td></tr>`}</tbody></table></div></section></div>`;
}

// New / edit metric: name, single event or ratio, the event(s); smart defaults
// under More options; live preview of the last 28 days on the right.
function metricModal(m) {
  const isNew = !m;
  const TEMPLATES = {
    v2p: { label: "V2P", name: "V2P (visit to payment)", def: { kind: "ratio", num: C.ref("pay:payment_success"), den: C.ref("site:session_start") } },
    ctr: { label: "Enroll click-through", name: "Enroll CTA click-through", def: { kind: "ratio", num: C.ref("site:cta_click", "cta_id", "enroll_now"), den: C.ref("site:session_start") } },
    wa: { label: "WhatsApp chat", name: "WhatsApp chat started", def: { kind: "single", ev: C.ref("site:contact_click", "channel", "whatsapp"), measure: "count" } },
    pay: { label: "Payment amount", name: "Payment amount per visitor", def: { kind: "single", ev: C.ref("pay:payment_success"), measure: "mean" } },
  };
  const blankDef = () => ({ kind: "single", ev: C.ref("lead:form_submit"), measure: "count", num: C.ref("lead:form_submit"), den: C.ref("site:session_start") });
  const st = {
    name: m?.name || "",
    desc: m?.desc || "",
    def: m?.def ? { ...blankDef(), ...structuredClone(m.def) } : blankDef(),
    more: m ? { group: m.group, window: m.windowHours ?? 72, lower: m.higherIsBetter === false, minSample: m.minSample ?? 100, maxChange: m.maxChange ?? 0.5, guardCut: m.guardrailCutoff ?? 0.02 } : {},
    isNew: false, active: "",
  };
  if (st.def.kind === "single" && !st.def.ev) st.def.ev = C.ref("lead:form_submit");
  const lockKind = !isNew;
  const lead = () => (st.def.kind === "ratio" ? st.def.num : st.def.ev);
  const auto = () => { const src = C.srcOf(lead()), e = C.evOf(lead()); return { group: e?.group || src?.group || "Clicks", window: src?.window || (st.def.kind === "ratio" && C.srcOf(st.def.den)?.window) || 72, lower: !!(src?.lower || e?.lower), minSample: 100, maxChange: 0.5, guardCut: 0.02 }; };
  const setting = (k) => (st.more[k] !== undefined ? st.more[k] : auto()[k]);
  const measure = () => { const e = C.evOf(st.def.ev); if (C.srcOf(st.def.ev)?.averageOnly) return "mean"; return e?.value ? st.def.measure || "count" : "count"; };
  const evalNow = () => C.evaluate({ ...st.def, measure: measure() });
  const fmtBase = (r) => {
    if (r.ratio) return { big: r.has ? fmtPct(r.base, r.base < 0.1 ? 2 : 1) : "—", note: "", small: r.has ? `${Math.round(r.nTot).toLocaleString("en-IN")} ÷ ${Math.round(r.dTot).toLocaleString("en-IN")} in 28 days` : "" };
    if (r.type === "mean") { const f = (x) => (r.unit === "₹" ? `₹${Math.round(x).toLocaleString("en-IN")}` : `${Math.round(x * 100) / 100}${r.unit}`); return { big: f(r.base), note: "per visitor" + (r.perEvent !== r.base ? ` · ${f(r.perEvent)} per payment` : ""), small: `${Math.round(r.total).toLocaleString("en-IN")} events in 28 days` }; }
    return { big: r.has ? fmtPct(r.base, r.base < 0.1 ? 2 : 1) : "—", note: "of visitors", small: `${Math.round(r.total).toLocaleString("en-IN")} events in 28 days` };
  };
  const sentence = () => {
    const win = setting("window") ? `within ${setting("window")} h of first seeing the test` : "any time during the test";
    const dir = setting("lower") ? " Lower is better." : "";
    if (st.def.kind === "ratio") return `<b>${esc(C.nameOf(st.def.num))}</b> ÷ <b>${esc(C.nameOf(st.def.den))}</b> per visitor, ${win}.${dir}`;
    if (measure() === "mean") return `Average <b>${esc(Object.keys(C.evOf(st.def.ev).value)[0])}</b> from <b>${esc(C.nameOf(st.def.ev))}</b> per visitor, ${win}.${dir}`;
    return `Share of visitors with at least one <b>${esc(C.nameOf(st.def.ev))}</b>, ${win}.${dir}`;
  };
  const problems = (r) => {
    const p = [];
    const nm = st.name.trim().toLowerCase();
    if (!nm) p.push("add a name");
    else if (S.get().metrics.some((x) => x !== m && x.name.toLowerCase() === nm)) p.push("that name is taken");
    if (st.def.kind === "ratio") {
      if (JSON.stringify(st.def.num) === JSON.stringify(st.def.den)) p.push("pick two different events");
      else if (!C.cpvOf(st.def.den)) p.push("the “divided by” event has no data");
      else if (!C.cpvOf(st.def.num) && !st.isNew) p.push("the event has no data in 28 days");
    } else if (!r.has && !st.isNew) p.push("this event has no data in 28 days");
    return p;
  };
  const spark = (r) => {
    const rnd = rng(hash(JSON.stringify(st.def)));
    const vals = Array.from({ length: 28 }, (_, i) => ((i % 7 === 5 || i % 7 === 6) ? 0.78 : 1.06) * (1 + (rnd() - 0.5) * 0.16));
    const W = 300, H = 52, max = Math.max(...vals), bw = W / vals.length;
    return `<svg viewBox="0 0 ${W} ${H}" class="mm-spark" role="img" aria-label="Last 28 days">${vals.map((v, i) => { const h = (v / max) * (H - 4); return `<rect x="${i * bw + 1}" y="${H - h}" width="${bw - 2}" height="${h}" rx="1.5"/>`; }).join("")}</svg>`;
  };
  const eventSelect = (id, cur) => `<select id="${id}" class="inp" data-mm="${id}">${Object.entries(C.SOURCES).filter(([, src]) => !(src.averageOnly && st.def.kind === "ratio")).map(([k, src]) => `<optgroup label="${esc(src.label)}">${Object.entries(src.events).map(([e, ev]) => `<option value="${k}:${e}" ${`${k}:${e}` === cur ? "selected" : ""}>${esc(ev.label)}${ev.cpv ? "" : " · no data yet"}</option>`).join("")}</optgroup>`).join("")}</select>`;
  const refFor = (w) => (w === "ev" ? st.def.ev : w === "num" ? st.def.num : st.def.den);
  const filterRow = (w) => {
    const r = refFor(w), e = C.evOf(r), props = Object.keys(e?.props || {});
    if (!props.length) return "";
    if (!r.prop) return `<button type="button" class="link-btn mm-addf" data-mm-addf="${w}">+ Add filter</button>`;
    return `<div class="mm-filter"><span>where</span><select class="inp" data-mm="${w}-prop" aria-label="Property">${props.map((x) => `<option ${x === r.prop ? "selected" : ""}>${x}</option>`).join("")}</select><span>is</span><select class="inp" data-mm="${w}-val" aria-label="Value">${Object.keys(e.props[r.prop]).map((x) => `<option ${x === r.val ? "selected" : ""}>${x}</option>`).join("")}</select><button type="button" class="btn xs ghost" data-mm-rmf="${w}" aria-label="Remove filter">${icon.x(14)}</button></div>`;
  };
  const seg = (attr, items, cur, disabled) => `<div class="mm-seg" role="radiogroup">${items.map(([v, l]) => `<button type="button" ${attr}="${v}" class="${v === cur ? "on" : ""}" ${disabled ? "disabled" : ""}>${esc(l)}</button>`).join("")}</div>`;
  const body = () => {
    const r = evalNow(), b = fmtBase(r), probs = problems(r), ratio = st.def.kind === "ratio";
    const e = !ratio ? C.evOf(st.def.ev) : null;
    return `<div class="mm">
      ${isNew ? `<div class="mm-tpl"><span>Start from</span>${Object.entries(TEMPLATES).map(([k, t]) => `<button type="button" class="${st.active === k ? "on" : ""}" data-mm-tpl="${k}">${esc(t.label)}</button>`).join("")}</div>` : ""}
      <div class="mm-grid"><div class="mm-form">
        <div class="field"><label for="mm-name">Name</label><input id="mm-name" class="inp" value="${esc(st.name)}" placeholder="e.g. V2L (visit to lead)" autocomplete="off"></div>
        <div class="field"><span class="label">What to measure</span>${seg("data-mm-kind", [["single", "Single event"], ["ratio", "Ratio"]], st.def.kind, lockKind)}${lockKind ? `<div class="hint">Locked after the first save.</div>` : ""}</div>
        ${ratio
          ? `<div class="field"><label for="mm-num">Count</label>${eventSelect("mm-num", st.def.num.key)}${filterRow("num")}</div><div class="mm-div">÷</div><div class="field"><label for="mm-den">Divided by</label>${eventSelect("mm-den", st.def.den.key)}${filterRow("den")}</div>`
          : `<div class="field"><label for="mm-ev">Event</label>${eventSelect("mm-ev", st.def.ev.key)}${filterRow("ev")}</div>${e?.value && !C.srcOf(st.def.ev).averageOnly ? `<div class="field"><span class="label">Count as</span>${seg("data-mm-measure", [["count", "% of visitors who did it"], ["mean", `Average ${Object.keys(e.value)[0]} per visitor`]], measure())}</div>` : ""}`}
        ${!r.has ? `<label class="check"><input type="checkbox" data-mm="isNew" ${st.isNew ? "checked" : ""}><span><span class="t1">New event, not live yet</span><span class="t2">Save without data; the baseline is set once data arrives</span></span></label>` : ""}
        <p class="hint mm-auto">Set automatically: ${esc(setting("group"))} group, ${setting("window")} h window${setting("lower") ? ", lower is better" : ""}.</p>
      </div>
      <aside class="mm-card"><div class="eyebrow">Last 28 days</div>
        ${r.has ? `<div class="mm-big">${b.big}${b.note ? `<span>${esc(b.note)}</span>` : ""}</div>${spark(r)}<div class="mm-small">${b.small}</div>` : `<div class="mm-empty">No data in the last 28 days.</div>`}
        <p class="mm-def">${sentence()}</p>
        <div class="mm-why" data-mm-why>${probs.length ? `To save: ${probs.map(esc).join(", ")}` : `<span class="ok">Ready to save</span>`}</div>
      </aside></div></div>`;
  };
  const save = () => {
    const r = evalNow();
    if (problems(r).length) return;
    const def = st.def.kind === "ratio" ? { kind: "ratio", num: st.def.num, den: st.def.den } : { kind: "single", ev: st.def.ev, measure: measure() };
    const usesLead = [def.ev, def.num, def.den].some((x) => x && x.key.startsWith("lead:"));
    const rec = {
      name: st.name.trim(), desc: st.desc.trim(), group: setting("group"), def,
      type: r.type, base: r.has ? Math.max(0.0001, r.base) : (r.type === "binomial" ? 0.05 : 1), ...(r.type === "mean" ? { sd: r.sd || Math.max(0.0001, r.base) * 0.4, unit: r.unit || "" } : {}),
      higherIsBetter: !setting("lower"), windowHours: setting("window"), minSample: setting("minSample"), maxChange: Math.max(0.01, setting("maxChange")), guardrailCutoff: Math.max(0, setting("guardCut")),
      ...(usesLead ? { requires: "leadForm" } : {}),
    };
    if (isNew) S.get().metrics.push({ id: uid("m"), custom: true, tags: [], targetMde: 0.1, ...rec });
    else { if (!usesLead) delete m.requires; Object.assign(m, rec); }
    S.save();
    closeModal();
    toast(isNew ? `Created ${rec.name}` : "Metric saved. Results recalculate.", "good");
  };
  openModal({
    title: isNew ? "New metric" : `Edit ${m.name}`,
    wide: true,
    body: body(),
    footer: `<button type="button" class="btn sm" data-act="modal-close">Cancel</button><button type="submit" class="btn sm primary" data-mm-save>${isNew ? "Create metric" : "Save"}</button>`,
    onOpen: (form) => {
      form.classList.add("metric-modal");
      const paint = () => {
        const focusId = document.activeElement?.id;
        form.querySelector(".modal-b").innerHTML = body();
        const pr = problems(evalNow());
        form.querySelector("[data-mm-save]").disabled = pr.length > 0;
        if (focusId) form.querySelector(`#${focusId}`)?.focus();
      };
      const touch = () => { st.active = ""; };
      form.querySelector("[data-mm-save]").disabled = problems(evalNow()).length > 0;
      form.addEventListener("click", (ev) => {
        const t = (q) => ev.target.closest(q);
        let b;
        if ((b = t("[data-mm-tpl]"))) { const tp = TEMPLATES[b.dataset.mmTpl]; st.active = b.dataset.mmTpl; st.name = tp.name; st.def = { ...blankDef(), ...structuredClone(tp.def) }; st.more = {}; return paint(); }
        if ((b = t("[data-mm-kind]")) && !b.disabled) { st.def.kind = b.dataset.mmKind; if (st.def.kind === "ratio" && C.srcOf(st.def.num)?.averageOnly) st.def.num = C.ref("lead:form_submit"); touch(); return paint(); }
        if ((b = t("[data-mm-measure]"))) { st.def.measure = b.dataset.mmMeasure; touch(); return paint(); }
        if ((b = t("[data-mm-addf]"))) { const r = refFor(b.dataset.mmAddf), e = C.evOf(r), p0 = Object.keys(e.props)[0]; r.prop = p0; r.val = Object.keys(e.props[p0])[0]; touch(); return paint(); }
        if ((b = t("[data-mm-rmf]"))) { const r = refFor(b.dataset.mmRmf); r.prop = ""; r.val = ""; touch(); return paint(); }
      });
      form.addEventListener("change", (ev) => {
        const el = ev.target, k = el.dataset.mm;
        if (!k) return;
        if (k === "mm-ev") st.def.ev = C.ref(el.value);
        else if (k === "mm-num") st.def.num = C.ref(el.value);
        else if (k === "mm-den") st.def.den = C.ref(el.value);
        else if (/^(ev|num|den)-prop$/.test(k)) { const r = refFor(k.split("-")[0]); r.prop = el.value; r.val = Object.keys(C.evOf(r).props[el.value])[0]; }
        else if (/^(ev|num|den)-val$/.test(k)) refFor(k.split("-")[0]).val = el.value;
        else if (k === "group") st.more.group = el.value;
        else if (k === "window") st.more.window = Math.max(0, Math.min(720, Number(el.value) || 0));
        else if (k === "lower") st.more.lower = el.value === "1";
        else if (k === "minSample") st.more.minSample = Math.max(0, Number(el.value) || 0);
        else if (k === "maxChange") st.more.maxChange = Math.max(1, Number(el.value) || 50) / 100;
        else if (k === "guardCut") st.more.guardCut = Math.max(0, Number(el.value) || 0) / 100;
        else if (k === "isNew") st.isNew = el.checked;
        touch();
        paint();
      });
      form.addEventListener("input", (ev) => {
        if (ev.target.id === "mm-name") st.name = ev.target.value;
        else if (ev.target.id === "mm-desc") { st.desc = ev.target.value; return; }
        else return;
        const pr = problems(evalNow());
        form.querySelector("[data-mm-why]").innerHTML = pr.length ? `To save: ${pr.map(esc).join(", ")}` : `<span class="ok">Ready to save</span>`;
        form.querySelector("[data-mm-save]").disabled = pr.length > 0;
      });
    },
    onSubmit: () => save(),
  });
}

const pctSel = (k, opts, v) => `<select class="inp" data-setting="${k}">${opts.map(([a, b]) => `<option value="${a}" ${String(a) === String(v) ? "selected" : ""}>${b}</option>`).join("")}</select>`;

export function renderSettings() {
  const st = S.get();
  const s = st.settings;
  const ed = st.role === "admin";
  return `<div class="page-head"><div><h1>Settings</h1><div class="sub">Organization experiment settings and prototype controls</div></div></div>
  <div class="stack" style="max-width:820px">
    <section class="card pad"><h2>Your role</h2><div class="card-sub">Try the app as a different role. Viewers can see everything but can't change anything. Only Admins change organization settings.</div>
      <div class="row"><div class="grow field"><label for="set-user">Signed in as</label><select id="set-user" class="inp" data-set="currentUserId">${S.USERS.map((u) => `<option value="${u.id}" ${u.id === st.currentUserId ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></div>
      <div class="grow field"><label for="set-role">Role</label><select id="set-role" class="inp" data-set="role">${[["admin", "Admin"], ["editor", "Editor"], ["viewer", "Viewer"]].map(([k, l]) => `<option value="${k}" ${st.role === k ? "selected" : ""}>${l}</option>`).join("")}</select></div></div></section>
    <fieldset class="card pad" ${ed ? "" : "disabled"} style="border:1px solid var(--border)"><h2>Statistics</h2><div class="card-sub">Defaults for every experiment's analysis.${ed ? "" : " Admins only."}</div>
      <div class="field"><span class="label">Default stats engine</span><div class="seg" role="group" style="display:inline-flex">${[["bayesian", "Bayesian"], ["frequentist", "Frequentist"]].map(([k, l]) => `<button type="button" aria-pressed="${s.statsEngine === k}" data-act="set-engine" data-engine="${k}" ${ed ? "" : "disabled"}>${l}</button>`).join("")}</div></div>
      <div class="row"><div class="grow field"><label>Interval level</label>${pctSel("ciLevel", [[0.9, "90%"], [0.95, "95%"], [0.99, "99%"]], s.ciLevel)}</div>
        <div class="grow field"><label>Bayesian: call a winner at</label>${pctSel("ctw", [[0.9, "90% chance to beat"], [0.95, "95% chance to beat"], [0.99, "99% chance to beat"]], s.ctw)}</div>
        <div class="grow field"><label>Frequentist: significant at</label>${pctSel("alpha", [[0.1, "p < 0.10"], [0.05, "p < 0.05"], [0.01, "p < 0.01"]], s.alpha)}</div></div>
      <div class="row"><div class="grow field"><label>Multiple-testing correction</label>${pctSel("correction", [["none", "None"], ["holm", "Holm-Bonferroni (strict)"], ["bh", "Benjamini-Hochberg (false discovery rate)"]], s.correction)}<div class="hint">Frequentist only. Applied across the primary and secondary metrics of an experiment.</div></div>
        <div class="grow field"><label>Sequential tuning</label><input class="inp" type="number" min="100" step="100" data-setting="tuning" value="${s.tuning}"><div class="hint">Visitors where intervals are tightest. Lower = narrower early.</div></div></div>
      <label class="check" style="margin-bottom:8px"><input type="checkbox" data-setting="cupedDefault" ${s.cupedDefault ? "checked" : ""}><span><span class="t1">Turn on CUPED for new experiments</span></span></label>
      <label class="check"><input type="checkbox" data-setting="sequentialDefault" ${s.sequentialDefault ? "checked" : ""}><span><span class="t1">Turn on sequential testing for new frequentist experiments</span></span></label></fieldset>
    <fieldset class="card pad" ${ed ? "" : "disabled"} style="border:1px solid var(--border)"><h2>Decisions &amp; health</h2><div class="card-sub">When the Results page says “Ship now”, and when it raises a warning.</div>
      <div class="row"><div class="grow field"><label>Minimum run time before a call</label>${pctSel("minDays", [[3, "3 days"], [7, "7 days"], [14, "14 days"]], s.minDays)}</div>
        <div class="grow field"><label>Traffic-split (SRM) alert below</label>${pctSel("srmThreshold", [[0.01, "p < 0.01"], [0.001, "p < 0.001"], [0.0001, "p < 0.0001"]], s.srmThreshold)}</div>
        <div class="grow field"><label>Multiple-exposure alert above</label>${pctSel("multiExposureThreshold", [[0.005, "0.5%"], [0.01, "1%"], [0.02, "2%"]], s.multiExposureThreshold)}</div></div>
      <label class="check" style="margin-bottom:8px"><input type="checkbox" data-setting="guardrailsBlockShip" ${s.guardrailsBlockShip ? "checked" : ""}><span><span class="t1">A failing guardrail blocks “Ship now”</span></span></label>
      <label class="check"><input type="checkbox" data-setting="requireHypothesis" ${s.requireHypothesis ? "checked" : ""}><span><span class="t1">Require a hypothesis before starting</span></span></label></fieldset>
    <fieldset class="card pad" ${ed ? "" : "disabled"} style="border:1px solid var(--border)"><h2>Assignment</h2>
      <div class="row"><div class="grow field"><label>Default hash attribute</label>${pctSel("hashAttribute", [["visitor_id", "Visitor ID (cookie)"], ["lead_id", "Lead ID"], ["session_id", "Session ID"]], s.hashAttribute)}</div><div class="grow"></div></div>
      <label class="check"><input type="checkbox" data-setting="stickyDefault" ${s.stickyDefault ? "checked" : ""}><span><span class="t1">Sticky bucketing by default</span></span></label></fieldset>
    <fieldset class="card pad" ${ed ? "" : "disabled"} style="border:1px solid var(--border)"><div class="card-head"><div><h2>Launch checklist</h2><div class="card-sub">Manual QA items every experiment shows before it can start. Required items block Start.</div></div><button type="button" class="btn xs" data-act="cl-add" ${ed ? "" : "disabled"}>${icon.plus(14)} Add item</button></div>
      <div class="stack-sm">${st.launchChecklist.map((c) => `<div class="row"><input class="inp grow" data-cl-text="${c.id}" value="${esc(c.text)}" aria-label="Checklist item"><label class="row" style="gap:6px;font-size:14px"><input type="checkbox" data-cl-req="${c.id}" ${c.required ? "checked" : ""}> Required</label><button type="button" class="btn xs ghost" data-act="cl-del" data-cid="${c.id}" aria-label="Remove">${icon.x(16)}</button></div>`).join("") || `<div class="faint">No manual items</div>`}</div></fieldset>
    <fieldset class="card pad" ${ed ? "" : "disabled"} style="border:1px solid var(--border)"><div class="card-head"><div><h2>Custom fields</h2><div class="card-sub">Extra details collected on every experiment, like team or ticket.</div></div><button type="button" class="btn xs" data-act="cf-add" ${ed ? "" : "disabled"}>${icon.plus(14)} Add field</button></div>
      <div class="stack-sm">${st.customFields.map((f) => `<div class="row"><b class="grow">${esc(f.name)}</b><span class="faint" style="font-size:14px">${f.type === "select" ? `Choice: ${esc(f.options.join(", "))}` : "Text"}</span><label class="row" style="gap:6px;font-size:14px"><input type="checkbox" data-cf-req="${f.id}" ${f.required ? "checked" : ""}> Required</label><button type="button" class="btn xs ghost" data-act="cf-del" data-fid="${f.id}" aria-label="Remove ${esc(f.name)}">${icon.x(16)}</button></div>`).join("") || `<div class="faint">No custom fields</div>`}</div></fieldset>
    <section class="card pad"><h2>Simulated clock</h2><div class="card-sub">Move time forward to watch experiments collect data, scheduled tests start, bandits re-weight and stop dates arrive. Today in the prototype: <b>${fmtDate(S.now())}</b>${st.clockOffsetDays ? ` (+${st.clockOffsetDays} days)` : ""}.</div>
      <div class="row"><button type="button" class="btn sm" data-act="clock" data-d="1">+1 day</button><button type="button" class="btn sm" data-act="clock" data-d="7">+7 days</button><button type="button" class="btn sm" data-act="clock" data-d="0" ${st.clockOffsetDays ? "" : "disabled"}>Back to today</button></div></section>
    <section class="card pad"><h2>Demo data</h2><div class="card-sub">Everything you do is saved in this browser only. Reset to start over with the sample pages and experiments.</div>
      <button type="button" class="btn sm danger" data-act="reset-demo">Reset demo data</button></section>
  </div>`;
}

export function bindSettings(root) {
  const st = S.get();
  root.querySelectorAll("[data-setting]").forEach((el) =>
    el.addEventListener("change", () => {
      const k = el.dataset.setting;
      const cur = st.settings[k];
      st.settings[k] = el.type === "checkbox" ? el.checked : typeof cur === "number" ? Number(el.value) : el.value;
      S.save();
      toast("Setting saved. Results recalculate.");
    }),
  );
  root.querySelectorAll("[data-cl-text]").forEach((el) => el.addEventListener("change", () => {
    const c = st.launchChecklist.find((x) => x.id === el.dataset.clText);
    c.text = el.value.trim() || c.text;
    S.save();
  }));
  root.querySelectorAll("[data-cl-req]").forEach((el) => el.addEventListener("change", () => {
    st.launchChecklist.find((x) => x.id === el.dataset.clReq).required = el.checked;
    S.save();
  }));
  root.querySelectorAll("[data-cf-req]").forEach((el) => el.addEventListener("change", () => {
    st.customFields.find((x) => x.id === el.dataset.cfReq).required = el.checked;
    S.save();
  }));
  root.querySelectorAll("[data-set]").forEach((sel) =>
    sel.addEventListener("change", () => {
      S.get()[sel.dataset.set] = sel.value;
      S.save();
      toast(sel.dataset.set === "role" ? `You're now ${sel.value === "viewer" ? "a Viewer" : `an ${sel.value[0].toUpperCase()}${sel.value.slice(1)}`}` : `Signed in as ${S.user(sel.value).name}`);
    }),
  );
}

Object.assign(acts, {
  "set-engine": (el) => {
    S.get().settings.statsEngine = el.dataset.engine;
    S.save();
  },
  clock: (el) => {
    const d = Number(el.dataset.d);
    const st = S.get();
    st.clockOffsetDays = d === 0 ? 0 : st.clockOffsetDays + d;
    S.save();
    S.reconcile();
    toast(d === 0 ? "Back to today" : `Moved forward ${d} day${d > 1 ? "s" : ""} · ${fmtDate(S.now())}`);
  },
  "reset-demo": () =>
    confirmModal({
      title: "Reset demo data?", danger: true, tone: "red", confirm: "Reset",
      text: "All experiments, pages and metrics go back to the sample data. Your changes in this browser are lost.",
      onConfirm: () => {
        S.resetDemo();
        toast("Demo data reset");
        location.hash = "#/experiments";
      },
    }),
  "metric-new": () => metricModal(null),
  "metric-edit": (el) => metricModal(S.metric(el.dataset.mid)),
  "cl-add": () => {
    S.get().launchChecklist.push({ id: uid("lc"), text: "New checklist item", required: false });
    S.save();
  },
  "cl-del": (el) => {
    S.get().launchChecklist = S.get().launchChecklist.filter((c) => c.id !== el.dataset.cid);
    S.save();
  },
  "cf-add": () =>
    openModal({
      title: "Add custom field",
      body: `<div class="field"><label for="cfn">Name</label><input id="cfn" name="name" class="inp" placeholder="e.g. Campaign"><div data-err="name"></div></div>
        <div class="field"><label for="cft">Type</label><select id="cft" name="type" class="inp"><option value="text">Text</option><option value="select">Choice</option></select></div>
        <div class="field"><label for="cfo">Choices <span class="opt">· comma separated, for Choice</span></label><input id="cfo" name="options" class="inp"></div>`,
      footer: `<button type="button" class="btn sm" data-act="modal-close">Cancel</button><button type="submit" class="btn sm primary">Add</button>`,
      onSubmit: (fd, form) => {
        const name = String(fd.get("name")).trim();
        if (!name) return (form.querySelector("[data-err]").innerHTML = `<div class="err">Enter a name</div>`);
        const options = String(fd.get("options")).split(",").map((x) => x.trim()).filter(Boolean);
        S.get().customFields.push({ id: uid("cf"), name, type: fd.get("type") === "select" && options.length ? "select" : "text", options, required: false });
        S.save();
        closeModal();
      },
    }),
  "cf-del": (el) => {
    S.get().customFields = S.get().customFields.filter((f) => f.id !== el.dataset.fid);
    S.save();
  },
  "metric-delete": (el) => {
    const st = S.get();
    st.metrics = st.metrics.filter((m) => m.id !== el.dataset.mid);
    S.save();
  },
});
