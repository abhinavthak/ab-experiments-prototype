// App state: pages, variants, metrics, experiments. Persisted in localStorage.
import { DAY, uid, hash, rng, startOfDay } from "./util.js";

const KEY = "abx-prototype-v1";
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
  const ms = { id: "pg_ms", name: "Generative AI Foundations Certificate By Microsoft", path: "/ytcourses/microsoft-certification", type: "Program", status: "live", sections: 20, editedAt: now - 21 * DAY, traffic: 700, hasLeadForm: false,
    variants: [v("A", "Original", 0), v("B", "“Start free” CTA", 1), v("C", "“Get certified” CTA", 1)] };
  const prof = { id: "pg_prof", name: "My Profile", path: "/my-profile", type: "Others", status: "live", sections: 2, editedAt: now - 21 * DAY, traffic: 300, hasLeadForm: false,
    variants: [v("A", "Original", 0)] };
  const dsa = { id: "pg_dsa", name: "DSA Free Course", path: "/complete_dsa_free_course", type: "Others", status: "draft", sections: 1, editedAt: now - 15 * DAY, traffic: 800, hasLeadForm: true,
    variants: [v("A", "Original", 0), v("B", "Signup CTA copy", 1)] };
  const pages = [bba, py, ai, ms, prof, dsa];
  pages.forEach((p) => (p.defaultVariantId = p.variants[0].id));
  dsa.defaultVariantId = dsa.variants[1].id; // B shipped by the completed test

  const metrics = [
    { id: "m_lead", name: "Lead form submitted", group: "Lead forms", desc: "Enquiry form on the page", type: "binomial", base: 0.075, requires: "leadForm" },
    { id: "m_brochure", name: "Brochure download", group: "Lead forms", desc: "Brochure request form", type: "binomial", base: 0.03, requires: "leadForm" },
    { id: "m_payment", name: "Payment completed", group: "Payments", desc: "From Lead Payments, within 7 days of first visit", type: "binomial", base: 0.006 },
    { id: "m_enroll", name: "Enroll Now click", group: "Clicks", desc: "Any Enroll Now button", type: "binomial", base: 0.12 },
    { id: "m_counsel", name: "Talk to counsellor click", group: "Clicks", desc: "Call and WhatsApp buttons", type: "binomial", base: 0.04 },
    { id: "m_cta", name: "CTA click", group: "Clicks", desc: "Primary call to action", type: "binomial", base: 0.09 },
    { id: "m_scroll", name: "Scroll to Fee section", group: "Engagement", desc: "Section comes into view", type: "binomial", base: 0.45 },
    { id: "m_bounce", name: "Bounce rate", group: "Engagement", desc: "Single-page sessions", type: "binomial", base: 0.48, higherIsBetter: false },
    { id: "m_lcp", name: "Page load (LCP, p75)", group: "Performance", desc: "From Core Web Vitals, seconds", type: "mean", base: 2.1, sd: 0.8, unit: "s", higherIsBetter: false },
  ];

  const ids = (p, keys) => keys.map((k) => p.variants.find((x) => x.key === k).id);
  const base = (o) => ({
    hypothesis: "", description: "", tags: [], ownerId: "u_at", watched: false, coverage: 100,
    targeting: { audience: "all", device: "all", source: "", excludeLeads: false }, sticky: true,
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
    status: "scheduled", scheduledStart: d(3) - 3600000, stopAfterDays: 14, createdAt: d(-3) });
  const e4 = base({ id: "e_ai", name: "AI-Native SE — fee block layout", trackingKey: "ai-native-fee-block", pageId: ai.id, variantIds: ids(ai, ["A", "B"]), weights: [50, 50],
    hypothesis: "Showing fees and EMI options before the curriculum reduces drop-off.", tags: ["fees"], primaryMetric: null, status: "draft", createdAt: d(-1) });
  const e5 = base({ id: "e_dsa", name: "DSA free course — signup CTA copy", trackingKey: "dsa-signup-cta-copy", pageId: dsa.id, variantIds: ids(dsa, ["A", "B"]), weights: [50, 50],
    hypothesis: "“Start learning free” beats “Sign up”.", tags: ["copy", "cta"], primaryMetric: "m_lead", secondaryMetrics: ["m_enroll", "m_scroll"],
    status: "stopped", startedAt: d(-36), endedAt: d(-15), stopAfterDays: 21, result: "won", createdAt: d(-38), sim: { seed: 55, lifts: { B: { m_lead: 0.16, m_enroll: 0.05 } } } });
  e5.winnerVariantId = e5.variantIds[1];
  e5.releasedVariantId = e5.variantIds[1];
  const e6 = base({ id: "e_pyf", name: "Python — fee display", trackingKey: "python-fee-display", pageId: py.id, variantIds: ids(py, ["A", "B"]), weights: [50, 50],
    hypothesis: "Showing the monthly price instead of the total increases payments.", tags: ["fees"], primaryMetric: "m_payment",
    status: "stopped", startedAt: d(-42), endedAt: d(-28), result: "inconclusive", createdAt: d(-44), sim: { seed: 66, lifts: { B: { m_payment: 0.0 } } } });
  e6.releasedVariantId = e6.variantIds[0];
  const e7 = base({ id: "e_old", name: "BBA — hero image test", trackingKey: "bba-hero-image", pageId: bba.id, variantIds: ids(bba, ["A", "C"]), weights: [50, 50],
    primaryMetric: "m_lead", status: "stopped", archived: true, startedAt: d(-90), endedAt: d(-70), result: "lost", createdAt: d(-92), sim: { seed: 77, lifts: { C: { m_lead: -0.08 } } } });
  e7.releasedVariantId = e7.variantIds[0];

  const exps = [e1, e2, e3, e4, e5, e6, e7];
  exps.forEach((e) => {
    e.history.push({ at: e.createdAt, by: e.ownerId, text: "Created the experiment" });
    if (e.status === "scheduled") e.history.push({ at: e.createdAt + 3600000, by: e.ownerId, text: `Scheduled the start` });
    if (e.startedAt) e.history.push({ at: e.startedAt, by: e.ownerId, text: "Started the experiment" });
    if (e.endedAt) e.history.push({ at: e.endedAt, by: e.ownerId, text: `Stopped the experiment and recorded “${RESULT_LABEL[e.result]}”` });
    if (e.archived) e.history.push({ at: e.endedAt + DAY, by: e.ownerId, text: "Archived the experiment" });
    e.updatedAt = Math.max(...e.history.map((h) => h.at));
  });
  e1.comments.push({ id: uid("c"), at: d(-2), by: "u_tu", text: "B is pulling ahead on mobile. Let's keep it to the full 21 days before calling it." });

  return { v: 1, pages, metrics, experiments: exps, currentUserId: "u_at", role: "admin", settings: { statsEngine: "bayesian" }, clockOffsetDays: 0, notices: [], seededAt: now };
}

export const RESULT_LABEL = { won: "Won", lost: "Lost", inconclusive: "No clear winner", dnf: "Did not finish" };

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = JSON.parse(raw);
  } catch {
    state = null;
  }
  if (!state || state.v !== 1) state = seed(Date.now());
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

export function variantsOf(e) {
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
  const warns = vs.slice(1).filter((v) => v.changes === 0).map((v) => ({ warn: true, label: `Variant ${v.key} has no changes vs ${vs[0].key}, so it will look the same as Control` }));
  return { items: [...items, ...warns], blocked: items.some((i) => !i.ok) };
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
    watched: true, coverage: 100, targeting: { audience: "all", device: "all", source: "", excludeLeads: false }, sticky: true, primaryMetric: null,
    secondaryMetrics: [], guardrailMetrics: [], statsEngine: state.settings.statsEngine, sequential: false, cuped: false, leadAttribution: true,
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
