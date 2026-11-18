// Statistics, modelled on GrowthBook's engines (normal approximations).
//   Bayesian: chance to beat control + 95% credible interval on relative lift.
//   Frequentist: two-sided p-value + 95% confidence interval; optional
//   sequential testing widens intervals so peeking stays valid.
//   SRM: chi-square test of observed vs planned traffic split.

export function normCdf(z) {
  // Abramowitz & Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

// Mean and variance of a metric for one variation.
// binomial: {n, x}  -> rate x/n
// mean:     {n, sum, sumSq}
export function moments(metric, s) {
  if (!s || s.n <= 0) return null;
  if (metric.type === "binomial") {
    const p = s.x / s.n;
    return { mean: p, varMean: (p * (1 - p)) / s.n, n: s.n };
  }
  const mean = s.sum / s.n;
  const v = Math.max(1e-12, s.sumSq / s.n - mean * mean);
  return { mean, varMean: v / s.n, n: s.n };
}

// Sequential testing: an always-valid (mixture SPRT style) boundary.
// Approximation of GrowthBook's tuning: wider than fixed-horizon, shrinking
// toward it as the sample grows past the tuning parameter.
function sequentialZ(n, tuning = 5000, alpha = 0.05) {
  const rho = tuning / Math.max(n, 1);
  const v = (1 + rho) * Math.log((1 + rho) / (rho * alpha * alpha));
  return Math.max(invNorm(1 - alpha / 2), Math.sqrt(v));
}

// Inverse standard normal CDF (Acklam).
export function invNorm(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) return -invNorm(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
const normPdf = (z) => Math.exp(-(z * z) / 2) / Math.sqrt(2 * Math.PI);

// Compare a variation (b) to a baseline (a).
//   lift: relative change; abs: absolute difference in the metric's units.
//   opts.ci: interval level (0.95); opts.tuning: sequential tuning parameter.
//   Bayesian results also carry "risk": the expected relative loss of
//   choosing b (riskB) or staying on a (riskA), as in GrowthBook.
export function compare(metric, a, b, { engine = "bayesian", sequential = false, cuped = false, ci = 0.95, tuning = 5000 } = {}) {
  const ma = moments(metric, a);
  const mb = moments(metric, b);
  if (!ma || !mb || ma.mean <= 0) return null;
  const lift = (mb.mean - ma.mean) / ma.mean;
  const abs = mb.mean - ma.mean;
  // Delta method for the ratio mb/ma.
  const se = Math.sqrt(mb.varMean / ma.mean ** 2 + (mb.mean ** 2 * ma.varMean) / ma.mean ** 4);
  const seAbs = Math.sqrt(mb.varMean + ma.varMean);
  // CUPED: pre-period covariate removes part of the variance (assume ~28%).
  const k = cuped ? 0.85 : 1;
  const seAdj = se * k;
  const seAbsAdj = seAbs * k;
  const better = metric.higherIsBetter === false ? -1 : 1;
  const zFixed = invNorm(1 - (1 - ci) / 2);
  if (engine === "bayesian") {
    const z = seAdj > 0 ? lift / seAdj : 0;
    const ctw = better > 0 ? normCdf(z) : 1 - normCdf(z);
    // Expected loss on the "good" direction, X ~ N(mu, s^2) where mu is the
    // improvement: E[max(0, -X)] = s*phi(mu/s) - mu*Phi(-mu/s).
    const mu = better * lift;
    const t = seAdj > 0 ? mu / seAdj : 0;
    const riskB = seAdj * normPdf(t) - mu * normCdf(-t);
    const riskA = seAdj * normPdf(t) + mu * normCdf(t);
    return { lift, abs, ci: [lift - zFixed * seAdj, lift + zFixed * seAdj], ciAbs: [abs - zFixed * seAbsAdj, abs + zFixed * seAbsAdj], chanceToWin: ctw, riskB: Math.max(0, riskB), riskA: Math.max(0, riskA), se: seAdj };
  }
  const zc = sequential ? sequentialZ(ma.n + mb.n, tuning, 1 - ci) : zFixed;
  const z = seAdj > 0 ? lift / seAdj : 0;
  // Scale z so p < alpha exactly when the (possibly widened) interval excludes 0.
  const p = 2 * (1 - normCdf((Math.abs(z) * zFixed) / zc));
  return { lift, abs, ci: [lift - zc * seAdj, lift + zc * seAdj], ciAbs: [abs - zc * seAbsAdj, abs + zc * seAbsAdj], pValue: p, se: seAdj };
}

// Verdict for one comparison, from the user's point of view (better/worse).
// thresholds: { ctw: 0.95, alpha: 0.05 }. Uses adjusted p-values if present.
export function verdict(metric, r, engine, { ctw = 0.95, alpha = 0.05 } = {}) {
  if (!r) return "none";
  const better = metric.higherIsBetter === false ? -r.lift : r.lift;
  if (engine === "bayesian") {
    if (r.chanceToWin >= ctw) return "won";
    if (r.chanceToWin <= 1 - ctw) return "lost";
    return "neutral";
  }
  const p = r.pAdj ?? r.pValue;
  if (p >= alpha) return "neutral";
  return better > 0 ? "won" : "lost";
}

// Multiple-testing corrections (frequentist): adjusts .pAdj in place.
export function adjustPValues(results, method) {
  const list = results.filter((r) => r && r.pValue != null);
  list.forEach((r) => delete r.pAdj);
  if (method === "none" || list.length < 2) return;
  const m = list.length;
  const sorted = [...list].sort((a, b) => a.pValue - b.pValue);
  if (method === "holm") {
    let prev = 0;
    sorted.forEach((r, i) => {
      prev = Math.max(prev, Math.min(1, (m - i) * r.pValue));
      r.pAdj = prev;
    });
  } else if (method === "bh") {
    let prev = 1;
    for (let i = m - 1; i >= 0; i--) {
      prev = Math.min(prev, Math.min(1, (sorted[i].pValue * m) / (i + 1)));
      sorted[i].pAdj = prev;
    }
  }
}

// Visitors per variant needed to detect a relative change "mde" on a metric.
// Visitors needed in each variant to detect a relative lift `mde` with a
// two-sided test. Conversion metrics use the standard two-proportion formula
// (pooled variance under H0, unpooled under H1); means use 2σ²(zα+zβ)²/Δ².
export function sampleSizePerVariant(metric, mde, { alpha = 0.05, power = 0.8, base = null, sd = null } = {}) {
  const za = invNorm(1 - alpha / 2);
  const zb = invNorm(power);
  const mu = base ?? metric.base;
  if (metric.type === "binomial") {
    const p1 = mu;
    const p2 = Math.min(0.999, mu * (1 + mde));
    const pb = (p1 + p2) / 2;
    const top = za * Math.sqrt(2 * pb * (1 - pb)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
    return Math.ceil(top ** 2 / (p2 - p1) ** 2);
  }
  const s = sd ?? metric.sd ?? mu * 0.4;
  return Math.ceil((2 * (za + zb) ** 2 * s ** 2) / (mu * mde) ** 2);
}

// Chance each arm is best (normal approximation, deterministic Monte Carlo).
export function chanceBest(arms, r, draws = 400) {
  const wins = arms.map(() => 0);
  for (let k = 0; k < draws; k++) {
    let best = -1;
    let bv = -Infinity;
    arms.forEach((a, i) => {
      // Box-Muller with the provided PRNG
      let u = 0;
      while (u === 0) u = r();
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
      const v = a.mean + z * a.sd;
      if (v > bv) {
        bv = v;
        best = i;
      }
    });
    wins[best]++;
  }
  return wins.map((w) => w / draws);
}

// Regularised lower incomplete gamma, for the chi-square CDF.
function gammaP(s, x) {
  if (x <= 0) return 0;
  let sum = 1 / s;
  let term = sum;
  for (let k = 1; k < 200; k++) {
    term *= x / (s + k);
    sum += term;
    if (term < sum * 1e-12) break;
  }
  return Math.exp(-x + s * Math.log(x) - lnGamma(s)) * sum;
}
function lnGamma(z) {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

export function srm(observed, weights) {
  const total = observed.reduce((a, b) => a + b, 0);
  if (total === 0) return { pValue: 1, chi2: 0 };
  const wsum = weights.reduce((a, b) => a + b, 0);
  let chi2 = 0;
  observed.forEach((o, i) => {
    const e = (total * weights[i]) / wsum;
    if (e > 0) chi2 += (o - e) ** 2 / e;
  });
  const df = observed.length - 1;
  const pValue = df > 0 ? 1 - gammaP(df / 2, chi2 / 2) : 1;
  return { pValue: Math.max(0, Math.min(1, pValue)), chi2 };
}
