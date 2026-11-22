// Events a metric can count, grouped by source (simulated volumes).
// any = share of visitors who do it at least once; cpv = events per visitor.
export const SOURCES = {
  lead: { label: "Lead form", group: "Lead forms", events: {
    form_submit: { label: "Lead form submitted", props: { form_type: { enquiry: 0.06, brochure: 0.03, callback: 0.015 } }, any: 0.075, cpv: 0.081 } } },
  pay: { label: "Payment", group: "Payments", window: 168, events: {
    payment_success: { label: "Payment completed", props: { program: { bba: 0.008, mba: 0.006, python: 0.004 } }, any: 0.006, cpv: 0.0062, value: { amount: { avg: 42000, unit: "₹" } } } } },
  site: { label: "Site event", group: "Clicks", events: {
    cta_click: { label: "CTA click", props: { cta_id: { enroll_now: 0.12, apply_now: 0.05, download_brochure: 0.04 } }, any: 0.19, cpv: 0.26 },
    contact_click: { label: "Contact click (call, WhatsApp)", props: { channel: { whatsapp: 0.028, call: 0.012 } }, any: 0.04, cpv: 0.047 },
    section_view: { label: "Section viewed", group: "Engagement", props: { section: { fees: 0.45, curriculum: 0.52, faculty: 0.21 } }, any: 0.71, cpv: 1.9 },
    bounce: { label: "Single-page visit (bounce)", group: "Engagement", props: {}, any: 0.48, cpv: 0.68, lower: true },
    chatbot_open: { label: "Chatbot opened (new)", group: "Engagement", props: {}, any: 0, cpv: 0 },
    session_start: { label: "Visit started", group: "Engagement", props: {}, any: 1, cpv: 1.42 } } },
  perf: { label: "Page performance", group: "Performance", lower: true, averageOnly: true, events: {
    lcp: { label: "Page load (LCP)", props: {}, any: 1, cpv: 1.42, value: { seconds: { avg: 2.1, unit: "s", sd: 0.8 } } } } },
};
export const VISITORS = 5200;
export const ref = (key, prop = "", val = "") => ({ key, prop, val });
const parts = (r) => (r?.key || "").split(":");
export const srcOf = (r) => SOURCES[parts(r)[0]];
export const evOf = (r) => srcOf(r)?.events[parts(r)[1]];
export const rateOf = (r) => { const e = evOf(r); if (!e) return 0; return r.prop && r.val ? e.props[r.prop]?.[r.val] ?? 0 : e.any; };
export const cpvOf = (r) => { const e = evOf(r); if (!e) return 0; return r.prop && r.val ? rateOf(r) * 1.1 : e.cpv; };
export const nameOf = (r) => { const e = evOf(r); return e ? e.label + (r.prop && r.val ? ` (${r.val.replace(/_/g, " ")})` : "") : "Unknown event"; };

// Definitions of the built-in metrics.
export const BUILT_IN_DEFS = {
  m_lead: { kind: "single", ev: ref("lead:form_submit"), measure: "count" },
  m_brochure: { kind: "single", ev: ref("lead:form_submit", "form_type", "brochure"), measure: "count" },
  m_payment: { kind: "single", ev: ref("pay:payment_success"), measure: "count" },
  m_enroll: { kind: "single", ev: ref("site:cta_click", "cta_id", "enroll_now"), measure: "count" },
  m_counsel: { kind: "single", ev: ref("site:contact_click"), measure: "count" },
  m_cta: { kind: "single", ev: ref("site:cta_click"), measure: "count" },
  m_scroll: { kind: "single", ev: ref("site:section_view", "section", "fees"), measure: "count" },
  m_bounce: { kind: "single", ev: ref("site:bounce"), measure: "count" },
  m_lcp: { kind: "single", ev: ref("perf:lcp"), measure: "mean" },
  m_v2l: { kind: "ratio", num: ref("lead:form_submit"), den: ref("site:session_start") },
  m_l2p: { kind: "ratio", num: ref("pay:payment_success"), den: ref("lead:form_submit") },
};

export function kindLabel(m) {
  const d = m.def;
  if (d?.kind === "ratio") return "Ratio";
  return m.type === "mean" ? "Single event · average" : "Single event · % of visitors";
}
export function countsLabel(m) {
  const d = m.def;
  if (!d) return "";
  if (d.kind === "ratio") return `${nameOf(d.num)} ÷ ${nameOf(d.den)}`;
  if (d.measure === "mean") { const e = evOf(d.ev); return `Average ${Object.keys(e?.value || { value: 1 })[0]} from ${nameOf(d.ev)}`; }
  return nameOf(d.ev);
}

// Baseline and analysis type for a definition.
export function evaluate(def) {
  if (def.kind === "ratio") {
    const n = cpvOf(def.num), d = cpvOf(def.den), r = d ? n / d : 0;
    return { type: r > 0 && r < 0.95 ? "binomial" : "mean", base: r, has: n > 0 && d > 0, ratio: true, nTot: n * VISITORS * 28, dTot: d * VISITORS * 28 };
  }
  const e = evOf(def.ev), src = srcOf(def.ev), r = rateOf(def.ev);
  const mean = src?.averageOnly || (def.measure === "mean" && e?.value);
  if (mean) {
    const v = Object.values(e.value)[0];
    const per = r >= 1 ? v.avg : v.avg * r;
    const sd = v.sd ?? Math.sqrt(Math.max(0, r * v.avg * v.avg * 1.2 - per * per));
    return { type: "mean", base: per, sd, unit: v.unit, perEvent: v.avg, has: r > 0, total: r * VISITORS * 28 };
  }
  return { type: "binomial", base: r, has: r > 0, total: r * VISITORS * 28 };
}
