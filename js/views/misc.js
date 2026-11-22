import * as S from "../store.js";
import { acts } from "../actions.js";
import { icon, openModal, closeModal, confirmModal } from "../ui.js";
import { esc, fmtPct, fmtDate, toast, uid } from "../util.js";

export function renderMetrics() {
  const st = S.get();
  const used = (id) => st.experiments.filter((e) => e.primaryMetric === id || e.secondaryMetrics.includes(id) || e.guardrailMetrics.includes(id) || e.activationMetric === id).length;
  return `<div class="page-head"><div><h1>Metrics</h1><div class="sub">What experiments measure. ${st.metrics.length} metrics.</div></div>
    <button type="button" class="btn primary lg" data-act="metric-new" ${S.canEdit() ? "" : "disabled"}>${icon.plus()} New metric</button></div>
  <div class="card"><div class="table-wrap"><table class="t" style="min-width:860px"><thead><tr><th>Metric</th><th>Group</th><th>Type</th><th>Goal</th><th>Window</th><th class="num">Used in</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
  ${st.metrics.map((m) => `<tr><td><a class="exp-name" href="#/metric/${m.id}">${esc(m.name)}</a><div class="small" style="margin:2px 0 0">${esc(m.desc || "")}${m.requires === "leadForm" ? " · needs a page with a lead form" : ""}</div></td><td>${esc(m.group)}</td>
    <td>${m.type === "binomial" ? `Conversion · baseline ${fmtPct(m.base, 1)}` : `Average · baseline ${m.base}${m.unit || ""}`}</td><td>${m.higherIsBetter === false ? "Lower is better" : "Higher is better"}</td><td>${m.windowHours ? `${m.windowHours >= 48 ? `${Math.round(m.windowHours / 24)} days` : `${m.windowHours}h`}` : "No limit"}</td>
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
      <dt>Type</dt><dd>${m.type === "binomial" ? "Conversion (did the visitor do it?)" : `Average value${m.unit ? ` in ${esc(m.unit)}` : ""}`}</dd>
      <dt>Group</dt><dd>${esc(m.group)}</dd><dt>Goal</dt><dd>${m.higherIsBetter === false ? "Lower is better" : "Higher is better"}</dd>
      <dt>Baseline</dt><dd>${m.type === "binomial" ? fmtPct(m.base, 2) : `${m.base}${m.unit || ""}`} <span class="faint">(used for planning)</span></dd>
      <dt>Conversion window</dt><dd>${m.windowHours ? `Within ${m.windowHours} hours of first exposure` : "Any time during the experiment"}</dd>
      <dt>Minimum data</dt><dd>${m.minSample ?? 100} ${m.type === "binomial" ? "conversions" : "visitors"} across baseline and variant before showing results</dd>
      <dt>Suspicious change</dt><dd>Flag changes over ${fmtPct(m.maxChange ?? 0.5, 0)}</dd>
      <dt>Default guardrail cutoff</dt><dd>${fmtPct(m.guardrailCutoff ?? 0.02, 0)} worse; suggested when added as a guardrail, set per experiment</dd>
      <dt>Planning lift</dt><dd>${fmtPct(m.targetMde ?? 0.1, 0)}</dd></dl></section>
    <section class="card"><div class="toolbar"><b>Experiments using it</b></div><div class="table-wrap"><table class="t compact"><thead><tr><th>Experiment</th><th>Role</th><th>Status</th></tr></thead><tbody>
      ${exps.length ? exps.map((e) => `<tr><td><a href="#/experiment/${e.id}/results">${esc(e.name)}</a></td><td>${e.primaryMetric === m.id ? "Primary" : e.guardrailMetrics.includes(m.id) ? "Guardrail" : e.activationMetric === m.id ? "Activation" : "Secondary"}</td><td>${esc(e.archived ? "archived" : e.status)}</td></tr>`).join("") : `<tr><td colspan="3" class="faint">Not used yet</td></tr>`}</tbody></table></div>
      <div style="padding:12px 20px"><a class="btn xs" href="#/insights" data-act="nav" data-href="#/insights">See its effects in Insights</a></div></section></div>`;
}

function metricModal(m) {
  const isNew = !m;
  m = m || { name: "", group: S.METRIC_GROUPS[0], desc: "", type: "binomial", base: 0.05, higherIsBetter: true, windowHours: 72, minSample: 100, maxChange: 0.5, targetMde: 0.1, unit: "" };
  openModal({
    title: isNew ? "New metric" : `Edit ${m.name}`,
    wide: true,
    body: `<div class="field"><label for="mn">Metric name</label><input id="mn" name="name" class="inp" value="${esc(m.name)}" placeholder="e.g. WhatsApp chat started"><div data-err="name"></div></div>
      <div class="field"><label for="md">Description <span class="opt">· optional</span></label><input id="md" name="desc" class="inp" value="${esc(m.desc || "")}" placeholder="Custom event: whatsapp_click"></div>
      <div class="row"><div class="grow field"><label for="mg">Group</label><select id="mg" name="group" class="inp">${S.METRIC_GROUPS.map((g) => `<option ${g === m.group ? "selected" : ""}>${g}</option>`).join("")}</select></div>
        <div class="grow field"><label for="mt">Type</label><select id="mt" name="type" class="inp" ${isNew ? "" : "disabled"}><option value="binomial" ${m.type === "binomial" ? "selected" : ""}>Conversion (yes / no)</option><option value="mean" ${m.type === "mean" ? "selected" : ""}>Average value</option></select>${isNew ? "" : `<div class="hint">Type can't change once created.</div>`}</div></div>
      <div class="row"><div class="grow field"><label for="mb">Expected baseline ${m.type === "binomial" ? "rate (%)" : "value"}</label><input id="mb" name="base" type="number" class="inp" step="any" min="0" value="${m.type === "binomial" ? +(m.base * 100).toFixed(3) : m.base}"></div>
        <div class="grow field"><label for="mw">Conversion window (hours)</label><input id="mw" name="window" type="number" class="inp" min="0" value="${m.windowHours ?? 72}"><div class="hint">0 = any time during the test</div></div></div>
      <div class="row"><div class="grow field"><label for="ms">Minimum data before results</label><input id="ms" name="minSample" type="number" class="inp" min="0" value="${m.minSample ?? 100}"></div>
        <div class="grow field"><label for="mx">Flag changes above</label><div class="pct-input"><input id="mx" name="maxChange" type="number" class="inp" min="1" value="${Math.round((m.maxChange ?? 0.5) * 100)}"><span>%</span></div></div>
        <div class="grow field"><label for="mg">Default guardrail cutoff</label><div class="pct-input"><input id="mg" name="guardCut" type="number" class="inp" min="0" max="100" step="0.5" value="${Math.round((m.guardrailCutoff ?? 0.02) * 1000) / 10}"><span>%</span></div><div class="hint">Suggested when this metric is added as a guardrail; each experiment sets its own</div></div>
        <div class="grow field"><label for="mm">Planning lift</label><div class="pct-input"><input id="mm" name="mde" type="number" class="inp" min="1" value="${Math.round((m.targetMde ?? 0.1) * 100)}"><span>%</span></div></div></div>
      <label class="check"><input type="checkbox" name="lower" ${m.higherIsBetter === false ? "checked" : ""}><span><span class="t1">Lower is better</span><span class="t2">For metrics like bounce rate or load time, where a drop is good</span></span></label>`,
    footer: `<button type="button" class="btn sm" data-act="modal-close">Cancel</button><button type="submit" class="btn sm primary">${isNew ? "Create metric" : "Save"}</button>`,
    onSubmit: (fd, form) => {
      const name = String(fd.get("name")).trim();
      const err = !name ? "Enter a name" : S.get().metrics.some((x) => x !== m && x.name.toLowerCase() === name.toLowerCase()) ? "A metric with this name already exists" : "";
      if (err) return (form.querySelector("[data-err]").innerHTML = `<div class="err">${icon.warn(14)} ${esc(err)}</div>`);
      const type = isNew ? fd.get("type") : m.type;
      const base = Number(fd.get("base"));
      const rec = { name, group: fd.get("group"), desc: String(fd.get("desc")).trim(), type, base: type === "binomial" ? Math.max(0.0001, Math.min(0.95, base / 100)) : Math.max(0.0001, base), higherIsBetter: !fd.get("lower"),
        windowHours: Number(fd.get("window")) || 0, minSample: Number(fd.get("minSample")) || 0, maxChange: Math.max(0.01, Number(fd.get("maxChange")) / 100), guardrailCutoff: Math.max(0, Number(fd.get("guardCut")) || 0) / 100, targetMde: Math.max(0.01, Number(fd.get("mde")) / 100) };
      if (isNew) S.get().metrics.push({ id: uid("m"), custom: true, tags: [], ...(type === "mean" ? { sd: rec.base * 0.4 } : {}), ...rec });
      else Object.assign(m, rec);
      S.save();
      closeModal();
      toast(isNew ? `Created ${name}` : "Metric saved. Results recalculate.", "good");
    },
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
