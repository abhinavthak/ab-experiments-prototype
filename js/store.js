// App state: pages, variants, metrics, experiments. Persisted in localStorage.
import { DAY, uid, hash, rng, startOfDay } from "./util.js";

const KEY = "abx-prototype-v2";
let state = null;
const listeners = new Set();

export const USERS = [
  { id: "u_at", name: "Abhinav Thakur" },
  { id: "u_tu", name: "Tanvi Usmani" },
  { id: "u_rk", name: "Rohan Kapoor" },
];

export const METRIC_GROUPS = ["Lead forms", "Payments", "Clicks", "Engagement", "Performance"];

function seed(now) {
  const d = (n) => startOfDay(now) + n * DAY + 10 * 3600000; // n days from today, 10:00
  const v = (key, name, changes, extra = {}) => ({ id: uid("v"), key, name, changes, ...extra });

  const bba = { id: "pg_bba", name: "BBA", path: "/online-bba", type: "Program", status: "live", sections: 31, editedAt: now - 3600000, traffic: 1550, hasLeadForm: true,
    variants: [v("A", "Original", 0), v("B", "Short banner + sticky CTA", 3), v("C", "Video banner", 1), v("D", "Counsellor-first layout", 5)] };
  const py = { id: "pg_py", name: "Python Programming with Live Mentorship", path: "/ytcourses/python-programming-course", type: "Program", status: "live", sections: 6, editedAt: now - 11 * DAY, traffic: 900, hasLeadForm: false,
    variants: [v("A", "Original", 0), v("B", "Mentorship banner", 2)] };
  const ai = { id: "pg_ai", name: "AI-Native Software Engineering Programme from IIT Mandi & HCi", path: "/ai-native-software-engineering-certificate-programme-iit-mandi-ihub-and-hci", type: "Program", status: "live", sections: 20, editedAt: now - 18 * DAY, traffic: 600, hasLeadForm: true,
    variants: [v("A", "Original", 0), v("B", "Fee block first", 2)] };
  const mba = { id: "pg_mba", name: "Online MBA", path: "/online-mba", type: "Program", status: "live", sections: 24, editedAt: now - 9 * DAY, traffic: 1100, hasLeadForm: true,
    variants: [v("A", "Original", 0), v("B", "Alumni-salary hero", 2), v("C", "Outcome-led headline", 1)] };
  const ms = { id: "pg_ms", name: "Generative AI Foundations Certificate By Microsoft", path: "/ytcourses/microsoft-certification", type: "Program", status: "live", sections: 20, editedAt: now - 21 * DAY, traffic: 700, hasLeadForm: false,
    variants: [v("A", "Original", 0), v("B", "“Start free” CTA", 1), v("C", "“Get certified” CTA", 1)] };
  const prof = { id: "pg_prof", name: "My Profile", path: "/my-profile", type: "Others", status: "live", sections: 2, editedAt: now - 21 * DAY, traffic: 300, hasLeadForm: false,
    variants: [v("A", "Original", 0)] };
  const dsa = { id: "pg_dsa", name: "DSA Free Course", path: "/complete_dsa_free_course", type: "Others", status: "draft", sections: 1, editedAt: now - 15 * DAY, traffic: 800, hasLeadForm: true,
    variants: [v("A", "Original", 0), v("B", "Signup CTA copy", 1)] };
  const pages = [bba, py, ai, mba, ms, prof, dsa];
  pages.forEach((p) => (p.defaultVariantId = p.variants[0].id));
  dsa.defaultVariantId = dsa.variants[1].id; // B shipped by the completed test

  const metrics = [
    { id: "m_lead", name: "Lead form submitted", group: "Lead forms", desc: "Enquiry form on the page", type: "binomial", base: 0.075, requires: "leadForm" },
    { id: "m_brochure", name: "Brochure download", group: "Lead forms", desc: "Brochure request form", type: "binomial", base: 0.03, requires: "leadForm" },
    { id: "m_payment", name: "Payment completed", group: "Payments", desc: "From Lead Payments, within 7 days of first visit", type: "binomial", base: 0.006, windowHours: 168 },
    { id: "m_enroll", name: "Enroll Now click", group: "Clicks", desc: "Any Enroll Now button", type: "binomial", base: 0.12 },
    { id: "m_counsel", name: "Talk to counsellor click", group: "Clicks", desc: "Call and WhatsApp buttons", type: "binomial", base: 0.04 },
    { id: "m_cta", name: "CTA click", group: "Clicks", desc: "Primary call to action", type: "binomial", base: 0.09 },
    { id: "m_scroll", name: "Scroll to Fee section", group: "Engagement", desc: "Section comes into view", type: "binomial", base: 0.45 },
    { id: "m_bounce", name: "Bounce rate", group: "Engagement", desc: "Single-page sessions", type: "binomial", base: 0.48, higherIsBetter: false },
    { id: "m_lcp", name: "Page load (LCP, p75)", group: "Performance", desc: "From Core Web Vitals, seconds", type: "mean", base: 2.1, sd: 0.8, unit: "s", higherIsBetter: false },
  ];
  metrics.forEach((m) => Object.assign(m, { windowHours: 72, minSample: 100, maxChange: 0.5, targetMde: 0.1, tags: [], ...m }));

  const ids = (p, keys) => keys.map((k) => p.variants.find((x) => x.key === k).id);
  const base = (o) => ({
    hypothesis: "", description: "", tags: [], ownerId: "u_at", watched: false, coverage: 100,
    targeting: { audience: "all", device: "all", excludeLeads: false, conditions: [], savedGroups: [] },
    assignment: { hashAttribute: "visitor_id", fallback: "", sticky: true }, type: "standard", namespace: null, activationMetric: null,
    customFields: {}, analysisSummary: "", plannedMde: 0.1, phases: [],
    secondaryMetrics: [], guardrailMetrics: [], statsEngine: "bayesian", sequential: false, cuped: false, leadAttribution: true,
    archived: false, scheduledStart: null, stopAfterDays: null, startedAt: null, endedAt: null, result: null, winnerVariantId: null, releasedVariantId: null,
    stoppedAutomatically: false, midTestEdits: [], comments: [], history: [], sim: null, createdAt: now, updatedAt: now, ...o,
  });

  const e1 = base({ id: "e_bba", name: "Online BBA — banner & sticky CTA", trackingKey: "online-bba-banner-cta", pageId: bba.id, variantIds: ids(bba, ["A", "B", "C"]), weights: [34, 33, 33],
    hypothesis: "A shorter banner with a sticky Apply Now bar will increase enquiry form submissions on mobile.", tags: ["banner", "mobile"], watched: true,
    primaryMetric: "m_lead", secondaryMetrics: ["m_enroll", "m_payment"], guardrailMetrics: ["m_lcp", "m_bounce"],
    status: "running", startedAt: d(-8), stopAfterDays: 21, createdAt: d(-10),
    sim: { seed: 11, lifts: { B: { m_lead: 0.177, m_enroll: 0.32, m_payment: 0.12, m_bounce: -0.06 }, C: { m_lead: 0.04, m_lcp: 0.38, m_enroll: 0.04 } } } });
  e1.midTestEdits.push({ variantKey: "B", section: "Banner", at: d(-4) + 6 * 3600000 });
  const e2 = base({ id: "e_pym", name: "Python — mentorship banner", trackingKey: "python-mentorship-banner", pageId: py.id, variantIds: ids(py, ["A", "B"]), weights: [50, 50],
    hypothesis: "Showing the live mentor's photo in the banner will lift Enroll Now clicks.", tags: ["banner"], primaryMetric: "m_enroll", secondaryMetrics: ["m_payment"],
    status: "running", startedAt: d(-4), createdAt: d(-6), sim: { seed: 22, skew: [1.17, 1], lifts: { B: { m_enroll: -0.021 } } } });
  const e3 = base({ id: "e_ms", name: "Microsoft GenAI — Enroll CTA copy", trackingKey: "msft-genai-enroll-copy", pageId: ms.id, variantIds: ids(ms, ["A", "B", "C"]), weights: [34, 33, 33],
    hypothesis: "Copy that names the certificate outcome will get more clicks than “Enroll now”.", tags: ["copy", "cta"], ownerId: "u_tu", primaryMetric: "m_cta",
    status: "scheduled", scheduledStart: d(3) - 3600000, stopAfterDays: 14, createdAt: d(-3), namespace: { id: "ns_programs", range: [50, 100] }, customFields: { cf_team: "Marketing" } });
  const e4 = base({ id: "e_ai", name: "AI-Native SE — fee block layout", trackingKey: "ai-native-fee-block", pageId: ai.id, variantIds: ids(ai, ["A", "B"]), weights: [50, 50],
    hypothesis: "Showing fees and EMI options before the curriculum reduces drop-off.", tags: ["fees"], primaryMetric: null, status: "draft", createdAt: d(-1),
    namespace: { id: "ns_programs", range: [0, 50] }, customFields: { cf_team: "Admissions" } });
  const e5 = base({ id: "e_dsa", name: "DSA free course — signup CTA copy", trackingKey: "dsa-signup-cta-copy", pageId: dsa.id, variantIds: ids(dsa, ["A", "B"]), weights: [50, 50],
    hypothesis: "“Start learning free” beats “Sign up”.", tags: ["copy", "cta"], primaryMetric: "m_lead", secondaryMetrics: ["m_enroll", "m_scroll"],
    status: "stopped", startedAt: d(-36), endedAt: d(-15), stopAfterDays: 21, result: "won", createdAt: d(-38), sim: { seed: 55, lifts: { B: { m_lead: 0.16, m_enroll: 0.05 } } },
    analysisSummary: "B (“Start learning free”) lifted signups by about 16% with no change in scroll depth. Shipped B as the default. Next: test the same copy on the Python course page." });
  // Two phases: a 50% rollout for the first week, then 100% (re-randomized).
  e5.phases = [
    { start: e5.startedAt, end: d(-29), weights: [50, 50], coverage: 50, targeting: e5.targeting, reason: "Initial rollout at 50%" },
    { start: d(-29), end: e5.endedAt, weights: [50, 50], coverage: 100, targeting: e5.targeting, reason: "Increased rollout to 100% and re-randomized" },
  ];
  e5.coverage = 100;
  e5.winnerVariantId = e5.variantIds[1];
  e5.releasedVariantId = e5.variantIds[1];
  const e6 = base({ id: "e_pyf", name: "Python — fee display", trackingKey: "python-fee-display", pageId: py.id, variantIds: ids(py, ["A", "B"]), weights: [50, 50],
    hypothesis: "Showing the monthly price instead of the total increases payments.", tags: ["fees"], primaryMetric: "m_payment",
    status: "stopped", startedAt: d(-42), endedAt: d(-28), result: "inconclusive", createdAt: d(-44), sim: { seed: 66, lifts: { B: { m_payment: 0.0 } } } });
  e6.releasedVariantId = e6.variantIds[0];
  const e7 = base({ id: "e_old", name: "BBA — hero image test", trackingKey: "bba-hero-image", pageId: bba.id, variantIds: ids(bba, ["A", "C"]), weights: [50, 50],
    primaryMetric: "m_lead", status: "stopped", archived: true, startedAt: d(-90), endedAt: d(-70), result: "lost", createdAt: d(-92), sim: { seed: 77, lifts: { C: { m_lead: -0.08 } } } });
  e7.releasedVariantId = e7.variantIds[0];

  const e8 = base({ id: "e_aib", name: "Online MBA — hero layout bandit", trackingKey: "online-mba-hero-bandit", pageId: mba.id, variantIds: ids(mba, ["A", "B", "C"]), weights: [34, 33, 33], type: "bandit",
    hypothesis: "Sending more traffic to the best hero layout while we learn will get more Enroll Now clicks during the admissions window.", tags: ["banner"], ownerId: "u_rk",
    primaryMetric: "m_enroll", status: "running", startedAt: d(-9), stopAfterDays: 28, createdAt: d(-10), customFields: { cf_team: "Growth" },
    sim: { seed: 88, lifts: { B: { m_enroll: 0.03 }, C: { m_enroll: 0.16 } } } });

  const exps = [e1, e2, e3, e4, e5, e6, e7, e8];
  exps.forEach((e) => {
    if (e.startedAt && !e.phases.length) e.phases = [{ start: e.startedAt, end: e.endedAt, weights: [...e.weights], coverage: e.coverage, targeting: structuredClone(e.targeting), reason: "Started" }];
  });
  e1.customFields = { cf_team: "Growth" };
  e2.customFields = { cf_team: "Growth" };
  exps.forEach((e) => {
    e.history.push({ at: e.createdAt, by: e.ownerId, text: "Created the experiment" });
    if (e.status === "scheduled") e.history.push({ at: e.createdAt + 3600000, by: e.ownerId, text: `Scheduled the start` });
    if (e.startedAt) e.history.push({ at: e.startedAt, by: e.ownerId, text: "Started the experiment" });
    if (e.endedAt) e.history.push({ at: e.endedAt, by: e.ownerId, text: `Stopped the experiment and recorded “${RESULT_LABEL[e.result]}”` });
    if (e.archived) e.history.push({ at: e.endedAt + DAY, by: e.ownerId, text: "Archived the experiment" });
    e.updatedAt = Math.max(...e.history.map((h) => h.at));
  });
  e1.comments.push({ id: uid("c"), at: d(-2), by: "u_tu", text: "B is pulling ahead on mobile. Let's keep it to the full 21 days before calling it." });

  const savedGroups = [
    { id: "sg_paid", name: "Paid campaign visitors", kind: "condition", condition: "utm_medium is one of cpc, paid_social", reach: 0.34, desc: "Arrived from a paid ad", ownerId: "u_tu", createdAt: d(-120) },
    { id: "sg_india", name: "Visitors in India", kind: "condition", condition: "country is IN", reach: 0.82, desc: "Geo from the CDN header", ownerId: "u_at", createdAt: d(-200) },
    { id: "sg_staff", name: "Staff & counsellors", kind: "list", attribute: "lead_email", values: ["counsellor1@example.edu", "counsellor2@example.edu", "admissions@example.edu"], reach: 0.02, desc: "Exclude internal traffic", ownerId: "u_at", createdAt: d(-200) },
  ];
  const namespaces = [
    { id: "ns_programs", name: "Program page tests", desc: "Visitors are in at most one program-page experiment at a time" },
    { id: "ns_header", name: "Common Header", desc: "Tests that change the shared header block" },
  ];
  const customFields = [
    { id: "cf_team", name: "Team", type: "select", options: ["Growth", "Marketing", "Admissions", "Product"], required: false },
  ];
  const holdouts = [
    { id: "h_h2", name: "H2 2026 holdout", desc: "5% of program-page visitors never see experiment variants, so we can measure the combined impact of everything we ship.", percent: 5, pageIds: [bba.id, py.id, dsa.id], metrics: ["m_lead", "m_enroll", "m_payment"], status: "running", startedAt: d(-60), endedAt: null, ownerId: "u_at", seed: 99 },
  ];
  const reports = [
    { id: "r_dsa", expId: e5.id, title: "DSA signup CTA — final readout", note: "Shared with the admissions team on the weekly call.", settings: { phase: 1, baseline: 0, difference: "relative", dimension: "" }, by: "u_at", createdAt: d(-14) },
  ];

  const launchChecklist = [
    { id: "lc_qa", text: "Checked every variant on mobile and desktop", required: true },
    { id: "lc_form", text: "Submitted the lead form in each variant and saw the lead tagged", required: true },
    { id: "lc_owner", text: "Page owner reviewed the preview links", required: false },
  ];
  e4.checklist = { lc_qa: true };
  e3.checklist = { lc_qa: true, lc_form: true, lc_owner: true };

  return { v: 2, launchChecklist, pages, metrics, experiments: exps, savedGroups, namespaces, customFields, holdouts, reports, currentUserId: "u_at", role: "admin",
    settings: { ...DEFAULT_SETTINGS }, clockOffsetDays: 0, notices: [], seededAt: now };
}

export const DEFAULT_SETTINGS = {
  statsEngine: "bayesian", ciLevel: 0.95, ctw: 0.95, alpha: 0.05, correction: "none", cupedDefault: false, sequentialDefault: false, tuning: 5000,
  minDays: 7, srmThreshold: 0.001, multiExposureThreshold: 0.01, guardrailsBlockShip: true, hashAttribute: "visitor_id", stickyDefault: true, requireHypothesis: false,
};

export const RESULT_LABEL = { won: "Won", lost: "Lost", inconclusive: "No clear winner", dnf: "Did not finish" };

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = JSON.parse(raw);
  } catch {
    state = null;
  }
  if (!state || state.v !== 2) state = seed(Date.now());
  state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
  // The sample "Ticket" custom field was removed; drop it from data saved before that.
  state.customFields = (state.customFields || []).filter((f) => f.id !== "cf_ticket");
  // The free-text "Traffic source" targeting field was removed; UTM rules live in attribute conditions.
  (state.experiments || []).forEach((e) => { if (e.targeting) delete e.targeting.source; });
  reconcile();
  return state;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage may be unavailable; the app still works for this visit */
  }
  listeners.forEach((fn) => fn());
}

export function resetDemo() {
  state = seed(Date.now());
  save();
}

export const get = () => state;
export const onChange = (fn) => listeners.add(fn);
export const now = () => Date.now() + state.clockOffsetDays * DAY;
export const me = () => USERS.find((u) => u.id === state.currentUserId);
export const user = (id) => USERS.find((u) => u.id === id) || { id, name: "Unknown" };
export const page = (id) => state.pages.find((p) => p.id === id);
export const exp = (id) => state.experiments.find((e) => e.id === id);
export const metric = (id) => state.metrics.find((m) => m.id === id);
export const canEdit = () => state.role !== "viewer";
export const savedGroup = (id) => state.savedGroups.find((g) => g.id === id);
export const namespace = (id) => state.namespaces.find((n) => n.id === id);
export const holdout = (id) => state.holdouts.find((h) => h.id === id);
export const report = (id) => state.reports.find((r) => r.id === id);
export const settings = () => state.settings;

// Phases: each start / re-randomization opens a phase with its own split,
// rollout and targeting. Results default to the latest phase.
export function phasesOf(e) {
  if (e.phases?.length) return e.phases;
  if (!e.startedAt) return [];
  return [{ start: e.startedAt, end: e.endedAt, weights: e.weights, coverage: e.coverage, targeting: e.targeting, reason: "Started" }];
}
export function openPhase(e, start, reason) {
  e.phases = e.phases || [];
  const last = e.phases[e.phases.length - 1];
  if (last && !last.end) last.end = start;
  e.phases.push({ start, end: null, weights: [...e.weights.map(Number)], coverage: e.coverage, targeting: structuredClone(e.targeting), reason });
}
export function closePhase(e, end) {
  const last = e.phases?.[e.phases.length - 1];
  if (last && !last.end) last.end = end;
}

export function variantsOf(e) {
  if (e.virtualVariants) return e.virtualVariants;
  const p = page(e.pageId);
  return e.variantIds.map((id) => p?.variants.find((x) => x.id === id) || { id, key: "?", name: "Deleted variant", changes: 0 });
}

export function log(e, text) {
  e.history.push({ at: now(), by: state.currentUserId, text });
  e.updatedAt = now();
}

export function stopDate(e) {
  if (!e.stopAfterDays) return null;
  const start = e.startedAt ?? e.scheduledStart;
  return start ? start + e.stopAfterDays * DAY : null;
}

export function activeExpOnPage(pageId, exceptId) {
  return state.experiments.find((e) => e.pageId === pageId && e.id !== exceptId && !e.archived && (e.status === "running" || e.status === "scheduled"));
}

// Start-time checks (S1). Red items block; amber items warn.
export function startChecks(e) {
  const p = page(e.pageId);
  const vs = variantsOf(e);
  const total = e.weights.reduce((a, b) => a + Number(b || 0), 0);
  const other = activeExpOnPage(e.pageId, e.id);
  const items = [
    { ok: p?.status === "live", label: "Page is live", fix: p ? `${p.name} is a draft page` : "The page was deleted" },
    { ok: !!e.primaryMetric, label: "Primary metric selected" },
    { ok: vs.length >= 2 && vs.every((v) => v.key !== "?"), label: "At least one variant besides Control", fix: "Add a variant" },
    { ok: Math.round(total) === 100, label: "Traffic split adds up to 100%", fix: `Currently ${Math.round(total)}%` },
    { ok: e.coverage > 0, label: "Rollout is above 0%" },
    { ok: !other, label: "No other running or scheduled experiment on this page", fix: other ? `“${other.name}” is ${other.status}` : "" },
  ];
  if (e.namespace?.id) {
    const clash = namespaceClash(e);
    items.push({ ok: !clash, label: `Namespace range ${e.namespace.range[0]}–${e.namespace.range[1]}% is free in “${namespace(e.namespace.id)?.name}”`, fix: clash ? `Overlaps “${clash.name}” (${clash.namespace.range.join("–")}%)` : "" });
  }
  if (e.type === "bandit") items.push({ ok: S_metricType(e) === "binomial", label: "Bandit decision metric is a conversion metric", fix: "Bandits need a conversion (yes/no) primary metric" });
  if (state.settings.requireHypothesis) items.push({ ok: !!e.hypothesis, label: "Hypothesis written", fix: "Your settings require a hypothesis before starting" });
  state.launchChecklist.forEach((c) => items.push(c.required ? { ok: !!e.checklist?.[c.id], manual: c.id, label: c.text, fix: "Tick it in the launch checklist" } : { ok: true, warn: !e.checklist?.[c.id], manual: c.id, label: c.text, optional: true }));
  state.customFields.filter((f) => f.required).forEach((f) => items.push({ ok: !!e.customFields?.[f.id], label: `${f.name} filled in`, fix: "Required custom field" }));
  const warns = vs.slice(1).filter((v) => v.changes === 0).map((v) => ({ warn: true, label: `Variant ${v.key} has no changes vs ${vs[0].key}, so it will look the same as Control` }));
  return { items: [...items, ...warns], blocked: items.some((i) => !i.ok) };
}

function S_metricType(e) {
  return metric(e.primaryMetric)?.type || "binomial";
}

export function namespaceClash(e) {
  if (!e.namespace?.id) return null;
  const [a, b] = e.namespace.range;
  return state.experiments.find((x) => x.id !== e.id && !x.archived && (x.status === "running" || x.status === "scheduled") && x.namespace?.id === e.namespace.id && x.namespace.range[0] < b && a < x.namespace.range[1]);
}

export function simFor(e) {
  // Random but fixed "true effects" for experiments the user starts.
  const r = rng(hash(e.id));
  const lifts = {};
  variantsOf(e).slice(1).forEach((v) => {
    lifts[v.key] = { [e.primaryMetric]: -0.06 + r() * 0.26 };
  });
  return { seed: hash(e.id) % 1000, lifts };
}

// Time-based transitions: scheduled starts and stop dates.
export function reconcile() {
  const t = now();
  let changed = false;
  state.experiments.forEach((e) => {
    if (e.archived) return;
    if (e.status === "scheduled" && e.scheduledStart && e.scheduledStart <= t) {
      e.status = "draft";
      const { blocked, items } = startChecks(e);
      if (blocked) {
        const why = items.find((i) => !i.ok);
        e.scheduledStart = null;
        e.notice = { tone: "warn", text: `Scheduled start skipped: ${why.fix || why.label}. It's back to Draft.` };
        e.history.push({ at: t, by: "system", text: "Scheduled start skipped; back to Draft" });
      } else {
        e.status = "running";
        e.startedAt = e.scheduledStart;
        e.scheduledStart = null;
        openPhase(e, e.startedAt, "Started on schedule");
        e.sim = e.sim || simFor(e);
        e.history.push({ at: e.startedAt, by: "system", text: "Started on schedule" });
      }
      e.updatedAt = t;
      changed = true;
    }
    const sd = stopDate(e);
    if (e.status === "running" && sd && sd <= t) {
      e.status = "stopped";
      e.endedAt = sd;
      closePhase(e, sd);
      e.stoppedAutomatically = true;
      e.releasedVariantId = page(e.pageId)?.defaultVariantId ?? null;
      e.history.push({ at: sd, by: "system", text: "Stopped automatically on its stop date" });
      e.updatedAt = t;
      changed = true;
    }
  });
  if (changed) save();
}

export function newExperimentDraft() {
  return {
    id: uid("e"), name: "", trackingKey: "", pageId: null, variantIds: [], weights: [], hypothesis: "", description: "", tags: [], ownerId: state.currentUserId,
    watched: true, coverage: 100, targeting: { audience: "all", device: "all", excludeLeads: false, conditions: [], savedGroups: [] }, primaryMetric: null,
    assignment: { hashAttribute: state.settings.hashAttribute, fallback: "", sticky: state.settings.stickyDefault }, type: "standard", namespace: null, activationMetric: null,
    customFields: {}, analysisSummary: "", plannedMde: 0.1, phases: [],
    secondaryMetrics: [], guardrailMetrics: [], statsEngine: state.settings.statsEngine, sequential: state.settings.sequentialDefault && state.settings.statsEngine === "frequentist", cuped: state.settings.cupedDefault, leadAttribution: true,
    status: "draft", archived: false, scheduledStart: null, stopAfterDays: 21, startedAt: null, endedAt: null, result: null, winnerVariantId: null,
    releasedVariantId: null, stoppedAutomatically: false, midTestEdits: [], comments: [], history: [], sim: null, createdAt: now(), updatedAt: now(),
  };
}

export function uniqueKey(base, exceptId) {
  let k = base || "experiment";
  let i = 2;
  while (state.experiments.some((e) => e.trackingKey === k && e.id !== exceptId)) k = `${base}-${i++}`;
  return k;
}
