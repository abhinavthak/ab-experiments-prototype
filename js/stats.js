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
function sequentialZ(n, tuning = 5000) {
  const rho = tuning / Math.max(n, 1);
  const alpha = 0.05;
  const v = (1 + rho) * Math.log((1 + rho) / (rho * alpha * alpha));
  return Math.max(1.96, Math.sqrt(v));
}

// Compare a variation (b) to control (a) on relative lift.
export function compare(metric, a, b, { engine = "bayesian", sequential = false, cuped = false } = {}) {
  const ma = moments(metric, a);
  const mb = moments(metric, b);
  if (!ma || !mb || ma.mean <= 0) return null;
  const lift = (mb.mean - ma.mean) / ma.mean;
  // Delta method for the ratio mb/ma.
  const se = Math.sqrt(mb.varMean / ma.mean ** 2 + (mb.mean ** 2 * ma.varMean) / ma.mean ** 4);
  // CUPED: pre-period covariate removes part of the variance (assume ~28%).
  const seAdj = cuped ? se * 0.85 : se;
  const better = metric.higherIsBetter === false ? -1 : 1;
  if (engine === "bayesian") {
    const z = seAdj > 0 ? lift / seAdj : 0;
    const ctw = better > 0 ? normCdf(z) : 1 - normCdf(z);
    return { lift, ci: [lift - 1.96 * seAdj, lift + 1.96 * seAdj], chanceToWin: ctw, se: seAdj };
  }
  const zc = sequential ? sequentialZ(ma.n + mb.n) : 1.96;
  const z = seAdj > 0 ? lift / seAdj : 0;
  // Scale z so p < 0.05 exactly when the (possibly widened) interval excludes 0.
  const p = 2 * (1 - normCdf((Math.abs(z) * 1.96) / zc));
  return { lift, ci: [lift - zc * seAdj, lift + zc * seAdj], pValue: p, se: seAdj };
}

// Verdict for one comparison, from the user's point of view (better/worse).
export function verdict(metric, r, engine) {
  if (!r) return "none";
  const better = metric.higherIsBetter === false ? -r.lift : r.lift;
  if (engine === "bayesian") {
    if (r.chanceToWin >= 0.95) return "won";
    if (r.chanceToWin <= 0.05) return "lost";
    return "neutral";
  }
  const sig = r.ci[0] > 0 || r.ci[1] < 0;
  if (!sig) return "neutral";
  return better > 0 ? "won" : "lost";
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
