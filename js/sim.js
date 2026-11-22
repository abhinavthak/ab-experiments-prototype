// Simulated traffic for running/stopped experiments. Deterministic per
// experiment + day, so numbers only change as (simulated) time passes.
//
// Supports phases (each phase has its own split, rollout and targeting),
// multi-armed bandits (weights re-computed daily from the data so far),
// dimension breakdowns and multiple-exposure counts.
import { DAY, hash, rng, gauss, startOfDay } from "./util.js";
import { moments, chanceBest } from "./stats.js";
import * as S from "./store.js";

export const MOBILE_SHARE = 0.62;
const cache = new Map();

// Dimensions available for breakdowns (shares sum to 1).
export const DIMENSIONS = {
  device: { label: "Device", values: [["mobile", "Mobile", MOBILE_SHARE], ["desktop", "Desktop", 1 - MOBILE_SHARE]] },
  country: { label: "Country", values: [["in", "India", 0.82], ["ae", "UAE", 0.06], ["us", "United States", 0.05], ["other", "Other", 0.07]] },
  browser: { label: "Browser", values: [["chrome", "Chrome", 0.68], ["safari", "Safari", 0.22], ["other", "Other", 0.1]] },
  source: { label: "Traffic source", values: [["organic", "Organic search", 0.38], ["paid", "Paid ads", 0.34], ["direct", "Direct", 0.18], ["social", "Social", 0.1]] },
  visitor: { label: "New vs returning", values: [["new", "New visitors", 0.7], ["returning", "Returning visitors", 0.3]] },
};

function trueLift(e, vKey, mid) {
  const l = e.sim?.lifts?.[vKey]?.[mid];
  if (l != null) return l;
  // Anything not seeded has no real effect: differences are noise only.
  return 0;
}

// Binomial draw: exact Poisson (Knuth) for small means, normal otherwise.
export function binomial(r, n, p) {
  const mean = n * p;
  if (mean <= 0) return 0;
  if (mean < 30) {
    const L = Math.exp(-mean);
    let k = 0;
    let prod = r();
    while (prod > L) {
      k++;
      prod *= r();
    }
    return Math.min(n, k);
  }
  return Math.max(0, Math.min(n, Math.round(mean + gauss(r) * Math.sqrt(mean * (1 - p)))));
}

function metricsOf(e) {
  return [...new Set([e.primaryMetric, e.activationMetric, ...e.secondaryMetrics, ...e.guardrailMetrics].filter(Boolean))].map(S.metric).filter(Boolean);
}

// How much of the page's traffic a targeting setup lets in.
// Rough share of visitors who match one condition, from the site's traffic mix.
const ATTR_SHARES = {
  country: { in: 0.82, ae: 0.06, us: 0.05 },
  browser: { chrome: 0.68, safari: 0.22, firefox: 0.05, edge: 0.04 },
  utm_source: { google: 0.45, facebook: 0.2, instagram: 0.08, newsletter: 0.04 },
  utm_medium: { cpc: 0.24, paid_social: 0.1, email: 0.04, organic: 0.38 },
  lead_stage: { none: 0.86, enquired: 0.08, counselled: 0.03, applied: 0.02, enrolled: 0.01 },
};
const KNOWN = { country: 1, city: 1, browser: 1, utm_source: 0.62, utm_medium: 0.62, utm_campaign: 0.4, page_visits: 1, lead_stage: 1, is_logged_in: 1 };
export function conditionShare(c) {
  const v = String(c.value || "").trim().toLowerCase();
  const vals = v.split(",").map((x) => x.trim()).filter(Boolean);
  const table = ATTR_SHARES[c.attr];
  const one = (x) => (table ? table[x] ?? 0.02 : c.attr === "city" ? 0.08 : c.attr === "utm_campaign" ? 0.1 : 0.15);
  const known = KNOWN[c.attr] ?? 1;
  switch (c.op) {
    case "is": return v ? one(v) : 1;
    case "not": return v ? 1 - one(v) : 1;
    case "in": return vals.length ? Math.min(1, vals.reduce((a, x) => a + one(x), 0)) : 1;
    case "nin": return vals.length ? Math.max(0, 1 - vals.reduce((a, x) => a + one(x), 0)) : 1;
    case "contains": return v ? 0.2 : 1;
    case "exists": return known;
    case "true": return c.attr === "is_logged_in" ? 0.22 : 0.5;
    case "false": return c.attr === "is_logged_in" ? 0.78 : 0.5;
    case "gt": return c.attr === "page_visits" ? Math.exp(-(Number(v) || 0) / 3) : 0.5;
    case "lt": return c.attr === "page_visits" ? 1 - Math.exp(-((Number(v) || 1) - 1) / 3) : 0.5;
    default: return 1;
  }
}

// How much of the page's traffic a targeting setup lets in.
export function targetingFactor(t = {}, e = {}) {
  let f = 1;
  if (t.audience === "new") f *= 0.7;
  if (t.audience === "returning") f *= 0.3;
  if (t.excludeLeads) f *= 0.95;
  (t.conditions || []).forEach((c) => (f *= Math.max(0.01, conditionShare(c))));
  return f;
}

// Returns { days: [ { t, rows: [ { phase, variantIndex, device, n, multi, w, m: { [mid]: stats } } ] } ] }
export function generate(e) {
  const phases = S.phasesOf(e);
  if (!phases.length) return { days: [] };
  const now = S.now();
  const end = Math.min(e.endedAt ?? now, now);
  const ck = `${e.id}|${Math.floor(end / 600000)}|${e.type}|${hash(JSON.stringify(phases) + JSON.stringify(e.sim || {}) + (e.traffic ?? ""))}|${e.namespace ? e.namespace.range.join("-") : ""}|${metricsOf(e).map((m) => m.id).join(",")}`;
  if (cache.has(ck)) return cache.get(ck);

  const p = S.page(e.pageId);
  const vs = S.variantsOf(e);
  const ms = metricsOf(e);
  const pm = S.metric(e.primaryMetric);
  const skew = e.sim?.skew || [];
  const multiRate = e.sim?.multiExposure ?? 0.003;
  const days = [];
  // Running totals of the primary metric in the current phase, for bandits.
  let banditAcc = null;
  let banditPhase = -1;

  for (let t = startOfDay(phases[0].start); t < end; t += DAY) {
    const rows = [];
    let dayWeights = null;
    phases.forEach((ph, pi) => {
      const from = Math.max(t, ph.start);
      const to = Math.min(t + DAY, ph.end ?? end, end);
      const frac = Math.max(0, (to - from) / DAY);
      if (frac <= 0) return;
      const r = rng(hash(`${e.id}|${t}|${pi}`) ^ (e.sim?.seed || 1));
      const weekday = new Date(t).getDay();
      const dayFactor = (weekday === 0 || weekday === 6 ? 0.78 : 1.07) * (1 + gauss(r) * 0.06);
      const tf = targetingFactor(ph.targeting, e);
      const cov = (ph.steps || []).filter((x) => x.at <= from).reduce((c, x) => x.coverage, ph.coverage);
      const traffic = (e.traffic ?? p?.traffic ?? 500) * (cov / 100) * tf * dayFactor * frac;

      // Weights: fixed, or a bandit's daily update after a 2-day burn-in.
      let weights = ph.weights.map(Number);
      if (e.type === "bandit") {
        if (banditPhase !== pi) {
          banditAcc = vs.map(() => null);
          banditPhase = pi;
        }
        const daysIn = (t - startOfDay(ph.start)) / DAY;
        if (daysIn >= 2 && pm && banditAcc.every((a) => a && a.n > 0)) {
          const arms = banditAcc.map((a) => {
            const mo = moments(pm, a);
            const sign = pm.higherIsBetter === false ? -1 : 1;
            return { mean: sign * mo.mean, sd: Math.sqrt(mo.varMean) };
          });
          const pb = chanceBest(arms, rng(hash(`${e.id}|bandit|${t}`)));
          const floor = 0.02;
          const adj = pb.map((x) => Math.max(floor, x));
          const sum = adj.reduce((a, b) => a + b, 0);
          weights = adj.map((x) => (x / sum) * 100);
        } else {
          // Burn-in: the starting split the team chose.
          weights = ph.weights.map(Number);
        }
        dayWeights = weights;
      }
      const wsum = weights.reduce((a, b) => a + b, 0) || 1;
      const dev = ph.targeting?.device || "all";

      vs.forEach((v, i) => {
        const share = (weights[i] / wsum) * (skew[i] ?? 1);
        // Visitors per variant, then an exact device split, so device mix
        // doesn't add variance the stats engine doesn't model.
        const nVar = Math.max(0, Math.round(traffic * share + gauss(r) * Math.sqrt(traffic * share)));
        const nMobile = dev === "mobile" ? nVar : dev === "desktop" ? 0 : Math.round(nVar * MOBILE_SHARE);
        ["mobile", "desktop"].forEach((device) => {
          const n = device === "mobile" ? nMobile : nVar - nMobile;
          const m = {};
          ms.forEach((metric) => {
            const lift = trueLift(e, v.key, metric.id);
            // Effects skew mobile, as in the design (weights average to 1).
            const dl = lift > 0 ? lift * (device === "mobile" ? 1.25 : 0.6) : lift;
            if (metric.type === "binomial") {
              const rate = Math.min(0.95, metric.base * (1 + dl));
              m[metric.id] = { n, x: binomial(r, n, rate) };
            } else {
              const mu = metric.base * (1 + dl);
              const sd = metric.sd ?? metric.base * 0.4;
              const sampleMean = n > 0 ? mu + (gauss(r) * sd) / Math.sqrt(n) : 0;
              m[metric.id] = { n, sum: sampleMean * n, sumSq: n * (sd * sd + sampleMean * sampleMean) };
            }
          });
          rows.push({ phase: pi, variantIndex: i, device, n, multi: binomial(r, n, multiRate), w: weights[i] / wsum, m });
          if (e.type === "bandit" && pm && m[pm.id]) banditAcc[i] = add(banditAcc[i], m[pm.id]);
        });
      });
    });
    if (rows.length) days.push({ t, rows, weights: dayWeights });
  }
  const out = { days };
  cache.set(ck, out);
  return out;
}

export function add(a, b) {
  if (!a) return { ...b };
  const o = { n: a.n + b.n };
  if ("x" in b) o.x = a.x + b.x;
  else {
    o.sum = a.sum + b.sum;
    o.sumSq = a.sumSq + b.sumSq;
  }
  return o;
}

const inPhase = (row, phase) => phase === "all" || phase == null || row.phase === phase;

// Totals per variant, optionally for one device / phase, up to a day index.
export function totals(e, { device = "all", uptoDay = Infinity, phase = null } = {}) {
  const { days } = generate(e);
  const ph = phase ?? S.phasesOf(e).length - 1;
  const per = S.variantsOf(e).map(() => ({ n: 0, multi: 0, m: {} }));
  days.forEach((d, di) => {
    if (di > uptoDay) return;
    d.rows.forEach((row) => {
      if (device !== "all" && row.device !== device) return;
      if (!inPhase(row, ph)) return;
      const t = per[row.variantIndex];
      t.n += row.n;
      t.multi += row.multi;
      Object.entries(row.m).forEach(([mid, s]) => (t.m[mid] = add(t.m[mid], s)));
    });
  });
  return per;
}

// Per-dimension totals: [{ key, label, per: totals-shaped }]. Device is exact;
// other dimensions split each variant's totals with a seeded draw.
export function dimensionTotals(e, dim, { phase = null } = {}) {
  const D = DIMENSIONS[dim];
  if (!D) return [];
  if (dim === "device") return D.values.map(([k, l]) => ({ key: k, label: l, per: totals(e, { device: k, phase }) }));
  const tot = totals(e, { phase });
  const r = rng(hash(`${e.id}|dim|${dim}|${tot.map((t) => t.n).join(",")}`));
  const out = D.values.map(([k, l]) => ({ key: k, label: l, per: tot.map(() => ({ n: 0, multi: 0, m: {} })) }));
  tot.forEach((t, vi) => {
    let remN = t.n;
    let remShare = 1;
    const remX = Object.fromEntries(Object.entries(t.m).map(([mid, s]) => [mid, s.x ?? 0]));
    D.values.forEach(([, , share], di) => {
      const last = di === D.values.length - 1;
      const nk = last ? remN : binomial(r, remN, Math.min(1, share / remShare));
      const cell = out[di].per[vi];
      cell.n = nk;
      Object.entries(t.m).forEach(([mid, s]) => {
        const metric = S.metric(mid);
        if (metric?.type === "binomial") {
          const xk = last ? remX[mid] : binomial(r, remX[mid], remN ? nk / remN : 0);
          remX[mid] -= xk;
          cell.m[mid] = { n: nk, x: Math.min(nk, xk) };
        } else {
          const mean = s.n ? s.sum / s.n : 0;
          const sd = Math.sqrt(Math.max(0, s.sumSq / Math.max(1, s.n) - mean * mean));
          const mk = nk > 0 ? mean + (gauss(r) * sd * Math.sqrt(Math.max(0, 1 - nk / Math.max(1, s.n)))) / Math.sqrt(nk) : 0;
          cell.m[mid] = { n: nk, sum: mk * nk, sumSq: nk * (sd * sd + mk * mk) };
        }
      });
      remN -= nk;
      remShare -= share;
    });
  });
  return out;
}

export function dailyVisitors(e, { phase = "all" } = {}) {
  const vs = S.variantsOf(e);
  return generate(e).days.map((d) => ({
    t: d.t,
    v: vs.map((_, i) => d.rows.filter((r) => r.variantIndex === i && inPhase(r, phase)).reduce((a, r) => a + r.n, 0)),
    weights: d.weights,
  }));
}

// Per-day (or cumulative) metric stats per variant, for charts.
export function series(e, mid, { device = "all", phase = null, cumulative = true } = {}) {
  const vs = S.variantsOf(e);
  const ph = phase ?? S.phasesOf(e).length - 1;
  let acc = vs.map(() => null);
  return generate(e)
    .days.map((d) => {
      if (!cumulative) acc = vs.map(() => null);
      let any = false;
      d.rows.forEach((row) => {
        if (device !== "all" && row.device !== device) return;
        if (!inPhase(row, ph)) return;
        const s = row.m[mid];
        if (s) {
          acc[row.variantIndex] = add(acc[row.variantIndex], s);
          any = true;
        }
      });
      return any ? { t: d.t, s: acc.map((x) => (x ? { ...x } : null)) } : null;
    })
    .filter(Boolean);
}

// Cumulative primary-metric value per variant per day (for the chart).
export function cumulative(e, mid, device = "all", phase = null) {
  const metric = S.metric(mid);
  return series(e, mid, { device, phase }).map((d) => ({
    t: d.t,
    v: d.s.map((s) => (!s || s.n === 0 ? null : metric.type === "binomial" ? s.x / s.n : s.sum / s.n)),
  }));
}
