// Simulated traffic for running/stopped experiments. Deterministic per
// experiment + day, so numbers only change as (simulated) time passes.
import { DAY, hash, rng, gauss, startOfDay } from "./util.js";
import * as S from "./store.js";

const MOBILE_SHARE = 0.62;
const cache = new Map();

function trueLift(e, vKey, mid) {
  const l = e.sim?.lifts?.[vKey]?.[mid];
  if (l != null) return l;
  // Anything not seeded has no real effect: differences are noise only.
  return 0;
}

// Binomial draw: exact Poisson (Knuth) for small means, normal otherwise.
function binomial(r, n, p) {
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
  return [...new Set([e.primaryMetric, ...e.secondaryMetrics, ...e.guardrailMetrics].filter(Boolean))].map(S.metric).filter(Boolean);
}

// Returns { days: [ { t, rows: [ { variantIndex, device, n, m: { [mid]: stats } } ] } ] }
export function generate(e) {
  if (!e.startedAt) return { days: [] };
  const now = S.now();
  const end = Math.min(e.endedAt ?? now, now);
  const ck = `${e.id}|${Math.floor(end / 600000)}|${e.weights.join(",")}|${e.coverage}|${metricsOf(e).map((m) => m.id).join(",")}`;
  if (cache.has(ck)) return cache.get(ck);

  const p = S.page(e.pageId);
  const vs = S.variantsOf(e);
  const ms = metricsOf(e);
  const wsum = e.weights.reduce((a, b) => a + Number(b), 0) || 1;
  const skew = e.sim?.skew || [];
  const days = [];
  for (let t = startOfDay(e.startedAt); t < end; t += DAY) {
    const from = Math.max(t, e.startedAt);
    const to = Math.min(t + DAY, end);
    const frac = Math.max(0, (to - from) / DAY);
    if (frac <= 0) continue;
    const r = rng(hash(`${e.id}|${t}`) ^ (e.sim?.seed || 1));
    const weekday = new Date(t).getDay();
    const dayFactor = (weekday === 0 || weekday === 6 ? 0.78 : 1.07) * (1 + gauss(r) * 0.06);
    const traffic = (p?.traffic ?? 500) * (e.coverage / 100) * dayFactor * frac;
    const rows = [];
    vs.forEach((v, i) => {
      const share = (Number(e.weights[i]) / wsum) * (skew[i] ?? 1);
      // Visitors per variant, then an exact device split, so device mix
      // doesn't add variance the stats engine doesn't model.
      const nVar = Math.max(0, Math.round(traffic * share + gauss(r) * Math.sqrt(traffic * share)));
      const nMobile = Math.round(nVar * MOBILE_SHARE);
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
        rows.push({ variantIndex: i, device, n, m });
      });
    });
    days.push({ t, rows });
  }
  const out = { days };
  cache.set(ck, out);
  return out;
}

function add(a, b) {
  if (!a) return { ...b };
  const o = { n: a.n + b.n };
  if ("x" in b) o.x = a.x + b.x;
  else {
    o.sum = a.sum + b.sum;
    o.sumSq = a.sumSq + b.sumSq;
  }
  return o;
}

// Totals per variant, optionally for one device and up to a day index.
export function totals(e, { device = "all", uptoDay = Infinity } = {}) {
  const { days } = generate(e);
  const per = S.variantsOf(e).map(() => ({ n: 0, m: {} }));
  days.forEach((d, di) => {
    if (di > uptoDay) return;
    d.rows.forEach((row) => {
      if (device !== "all" && row.device !== device) return;
      const t = per[row.variantIndex];
      t.n += row.n;
      Object.entries(row.m).forEach(([mid, s]) => (t.m[mid] = add(t.m[mid], s)));
    });
  });
  return per;
}

export function dailyVisitors(e) {
  const vs = S.variantsOf(e);
  return generate(e).days.map((d) => ({
    t: d.t,
    v: vs.map((_, i) => d.rows.filter((r) => r.variantIndex === i).reduce((a, r) => a + r.n, 0)),
  }));
}

// Cumulative primary-metric value per variant per day (for the chart).
export function cumulative(e, mid, device = "all") {
  const metric = S.metric(mid);
  const vs = S.variantsOf(e);
  const acc = vs.map(() => null);
  return generate(e).days.map((d) => {
    d.rows.forEach((row) => {
      if (device !== "all" && row.device !== device) return;
      const s = row.m[mid];
      if (s) acc[row.variantIndex] = add(acc[row.variantIndex], s);
    });
    return {
      t: d.t,
      v: acc.map((s) => (!s || s.n === 0 ? null : metric.type === "binomial" ? s.x / s.n : s.sum / s.n)),
    };
  });
}
