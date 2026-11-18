// Minimal SVG line chart. series: [{ label, color, values: [number|null] }], x: [timestamps]
import { esc, fmtDate } from "./util.js";

export function lineChart({ x, series, fmt = (v) => v, height = 240, title = "" }) {
  const W = 760, H = height, L = 56, R = 16, T = 12, B = 30;
  const vals = series.flatMap((s) => s.values).filter((v) => v != null && isFinite(v));
  if (!x.length || !vals.length) return `<div class="empty" style="padding:32px">Not enough data to chart yet</div>`;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= Math.abs(lo) * 0.1 || 1; hi += Math.abs(hi) * 0.1 || 1; }
  const pad = (hi - lo) * 0.1;
  lo = Math.max(0, lo - pad); hi += pad;
  const sx = (i) => L + (x.length === 1 ? (W - L - R) / 2 : (i / (x.length - 1)) * (W - L - R));
  const sy = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = 4;
  let grid = "";
  for (let k = 0; k <= ticks; k++) {
    const v = lo + ((hi - lo) * k) / ticks;
    const y = sy(v);
    grid += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="#EEF0F3"/><text x="${L - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#6B7280">${esc(fmt(v))}</text>`;
  }
  const step = Math.max(1, Math.ceil(x.length / 6));
  let xl = "";
  x.forEach((t, i) => {
    if (i % step === 0 || i === x.length - 1) xl += `<text x="${sx(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#6B7280">${esc(fmtDate(t).replace(/, \d{4}$/, ""))}</text>`;
  });
  const lines = series
    .map((s) => {
      let d = "";
      s.values.forEach((v, i) => {
        if (v == null || !isFinite(v)) return;
        d += `${d ? "L" : "M"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`;
      });
      const last = s.values.length - 1;
      const dot = s.values[last] != null ? `<circle cx="${sx(last)}" cy="${sy(s.values[last])}" r="3.5" fill="${s.color}"/>` : "";
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>${dot}`;
    })
    .join("");
  const legend = `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join("")}</div>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${grid}${xl}${lines}</svg>${legend}`;
}
