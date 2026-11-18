import * as S from "../store.js";
import { acts } from "../actions.js";
import { icon, openModal, closeModal, confirmModal } from "../ui.js";
import { esc, fmtPct, fmtDate, toast, uid } from "../util.js";

export function renderMetrics() {
  const st = S.get();
  const used = (id) => st.experiments.filter((e) => e.primaryMetric === id || e.secondaryMetrics.includes(id) || e.guardrailMetrics.includes(id)).length;
  return `<div class="page-head"><div><h1>Metrics</h1><div class="sub">What experiments measure. ${st.metrics.length} metrics.</div></div>
    <button type="button" class="btn primary lg" data-act="metric-new" ${S.canEdit() ? "" : "disabled"}>${icon.plus()} New metric</button></div>
  <div class="card"><div class="table-wrap"><table class="t" style="min-width:760px"><thead><tr><th>Metric</th><th>Group</th><th>Type</th><th>Goal</th><th class="num">Used in</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
  ${st.metrics.map((m) => `<tr><td><b>${esc(m.name)}</b><div class="small" style="margin:2px 0 0">${esc(m.desc || "")}${m.requires === "leadForm" ? " · needs a page with a lead form" : ""}</div></td><td>${esc(m.group)}</td>
    <td>${m.type === "binomial" ? `Conversion · baseline ${fmtPct(m.base, 1)}` : `Average · baseline ${m.base}${m.unit || ""}`}</td><td>${m.higherIsBetter === false ? "Lower is better" : "Higher is better"}</td>
    <td class="num">${used(m.id)} experiment${used(m.id) === 1 ? "" : "s"}</td>
    <td>${m.custom && S.canEdit() ? `<button type="button" class="btn xs" data-act="metric-delete" data-mid="${m.id}" ${used(m.id) ? 'disabled title="In use by an experiment"' : ""}>Delete</button>` : ""}</td></tr>`).join("")}
  </tbody></table></div></div>`;
}

export function renderSettings() {
  const st = S.get();
  return `<div class="page-head"><div><h1>Settings</h1><div class="sub">Experiment defaults and prototype controls</div></div></div>
  <div class="stack" style="max-width:760px">
    <section class="card pad"><h2>Your role</h2><div class="card-sub">Try the app as a different role. Viewers can see everything but can't create or change experiments.</div>
      <div class="row"><div class="grow field"><label for="set-user">Signed in as</label><select id="set-user" class="inp" data-set="currentUserId">${S.USERS.map((u) => `<option value="${u.id}" ${u.id === st.currentUserId ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></div>
      <div class="grow field"><label for="set-role">Role</label><select id="set-role" class="inp" data-set="role">${[["admin", "Admin"], ["editor", "Editor"], ["viewer", "Viewer"]].map(([k, l]) => `<option value="${k}" ${st.role === k ? "selected" : ""}>${l}</option>`).join("")}</select></div></div></section>
    <section class="card pad"><h2>Experiment defaults</h2><div class="card-sub">Used for new experiments. Each experiment can change it under Analysis.</div>
      <div class="field"><span class="label">Default stats engine</span><div class="seg" role="group" style="display:inline-flex">${[["bayesian", "Bayesian"], ["frequentist", "Frequentist"]].map(([k, l]) => `<button type="button" aria-pressed="${st.settings.statsEngine === k}" data-act="set-engine" data-engine="${k}">${l}</button>`).join("")}</div></div></section>
    <section class="card pad"><h2>Simulated clock</h2><div class="card-sub">Move time forward to watch experiments collect data, scheduled tests start and stop dates arrive. Today in the prototype: <b>${fmtDate(S.now())}</b>${st.clockOffsetDays ? ` (+${st.clockOffsetDays} days)` : ""}.</div>
      <div class="row"><button type="button" class="btn sm" data-act="clock" data-d="1">+1 day</button><button type="button" class="btn sm" data-act="clock" data-d="7">+7 days</button><button type="button" class="btn sm" data-act="clock" data-d="0" ${st.clockOffsetDays ? "" : "disabled"}>Back to today</button></div></section>
    <section class="card pad"><h2>Demo data</h2><div class="card-sub">Everything you do is saved in this browser only. Reset to start over with the sample pages and experiments.</div>
      <button type="button" class="btn sm danger" data-act="reset-demo">Reset demo data</button></section>
  </div>`;
}

export function bindSettings(root) {
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
  "metric-new": () =>
    openModal({
      title: "New metric",
      body: `<div class="field"><label for="mn">Metric name</label><input id="mn" name="name" class="inp" placeholder="e.g. WhatsApp chat started"><div data-err="name"></div></div>
        <div class="row"><div class="grow field"><label for="mg">Group</label><select id="mg" name="group" class="inp">${S.METRIC_GROUPS.map((g) => `<option>${g}</option>`).join("")}</select></div>
        <div class="grow field"><label for="mb">Expected baseline rate</label><div class="pct-input"><input id="mb" name="base" type="number" class="inp" min="0.1" max="90" step="0.1" value="5"><span>%</span></div></div></div>
        <div class="field"><label for="md">Description <span class="opt">· optional</span></label><input id="md" name="desc" class="inp" placeholder="Custom event: whatsapp_click"></div>
        <label class="check"><input type="checkbox" name="lower"><span><span class="t1">Lower is better</span><span class="t2">For metrics like bounce rate, where a drop is good</span></span></label>`,
      footer: `<button type="button" class="btn sm" data-act="modal-close">Cancel</button><button type="submit" class="btn sm primary">Create metric</button>`,
      onSubmit: (fd, form) => {
        const name = String(fd.get("name")).trim();
        const err = !name ? "Enter a name" : S.get().metrics.some((m) => m.name.toLowerCase() === name.toLowerCase()) ? "A metric with this name already exists" : "";
        if (err) return (form.querySelector("[data-err]").innerHTML = `<div class="err">${icon.warn(14)} ${esc(err)}</div>`);
        S.get().metrics.push({ id: uid("m"), name, group: fd.get("group"), desc: String(fd.get("desc")).trim() || "Custom event", type: "binomial", base: Math.max(0.001, Number(fd.get("base")) / 100), higherIsBetter: !fd.get("lower"), custom: true });
        S.save();
        closeModal();
        toast(`Created ${name}`, "good");
      },
    }),
  "metric-delete": (el) => {
    const st = S.get();
    st.metrics = st.metrics.filter((m) => m.id !== el.dataset.mid);
    S.save();
  },
});
