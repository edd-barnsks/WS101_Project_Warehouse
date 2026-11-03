import { esc, peso } from './api';

/* A small monochrome column chart for the Reports page, drawn as inline SVG (no chart library).
   One series, so there is no legend: the heading above names it. Every column also has a hover/focus readout,
   and the Reports page offers the same numbers as a table. Text is set with textContent, never innerHTML. */

export type ChartPoint = { label: string; fullLabel: string; value: number; note: string };

const HEIGHT = 260;
const PAD = { top: 28, right: 12, bottom: 30, left: 60 };
const MAX_BAR = 24;     // columns never fill their slot: leftover width stays empty
const BAR_GAP = 2;

/** 1, 2, 5 x 10^n: round numbers for axis steps. */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const exp = Math.floor(Math.log10(raw));
  const f = raw / 10 ** exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * 10 ** exp;
}

/** ₱950 / ₱1,200 / ₱12K / ₱1.5M: one style per axis. */
export function compactPeso(v: number): string {
  if (v >= 1_000_000) return `₱${+(v / 1_000_000).toFixed(1)}M`;
  if (v >= 10_000) return `₱${+(v / 1_000).toFixed(1)}K`;
  return `₱${v.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
}

export function drawBarChart(host: HTMLElement, points: ChartPoint[], ariaLabel: string): void {
  host.textContent = '';
  const total = points.reduce((sum, p) => sum + p.value, 0);
  if (!points.length || !(total > 0)) {
    const empty = document.createElement('p');
    empty.className = 'report-chart-empty';
    empty.textContent = 'No sales recorded in this date range.';
    host.appendChild(empty);
    return;
  }

  const width = Math.max(320, host.clientWidth || 640);
  const plotW = width - PAD.left - PAD.right, plotH = HEIGHT - PAD.top - PAD.bottom;
  const max = Math.max(...points.map((p) => p.value));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const band = plotW / points.length;
  const barW = Math.max(2, Math.min(MAX_BAR, band - BAR_GAP));
  const yOf = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const peak = points.findIndex((p) => p.value === max);

  const parts: string[] = [];
  for (let t = 0; t <= top + step / 1000; t += step) {
    const y = yOf(t);
    parts.push(`<line class="grid${t === 0 ? ' base' : ''}" x1="${PAD.left}" x2="${width - PAD.right}" y1="${y}" y2="${y}"/>`);
    parts.push(`<text class="tick" x="${PAD.left - 8}" y="${y + 3.5}" text-anchor="end">${esc(compactPeso(t))}</text>`);
  }
  const maxLabels = Math.max(2, Math.floor(plotW / 78));
  const every = Math.ceil(points.length / maxLabels);
  points.forEach((p, i) => {
    const cx = PAD.left + band * i + band / 2;
    const h = (p.value / top) * plotH;
    if (h > 0) parts.push(`<rect class="bar" data-bar="${i}" x="${cx - barW / 2}" y="${PAD.top + plotH - h}" width="${barW}" height="${h}"/>`);
    if (i % every === 0) parts.push(`<text class="tick" x="${cx}" y="${HEIGHT - 10}" text-anchor="middle">${esc(p.label)}</text>`);
  });
  // The one direct label: the biggest column (the axis and the readout carry the rest)
  const peakX = Math.min(Math.max(PAD.left + band * peak + band / 2, PAD.left + 34), width - PAD.right - 34);
  parts.push(`<text class="peak" x="${peakX}" y="${yOf(max) - 7}" text-anchor="middle">${esc(peso(max))}</text>`);
  // Hit areas are the whole column slot, wider and taller than the painted bar
  points.forEach((p, i) => {
    parts.push(`<rect class="hit" data-hit="${i}" x="${PAD.left + band * i}" y="${PAD.top}" width="${band}" height="${plotH}" tabindex="0" role="img" aria-label="${esc(`${p.fullLabel}: ${peso(p.value)}${p.note ? `, ${p.note}` : ''}`)}"/>`);
  });

  host.insertAdjacentHTML('beforeend', `<svg class="report-svg" viewBox="0 0 ${width} ${HEIGHT}" width="${width}" height="${HEIGHT}" role="group" aria-label="${esc(ariaLabel)}">${parts.join('')}</svg>`);

  const tip = document.createElement('div');
  tip.className = 'report-tip';
  const value = document.createElement('strong'), when = document.createElement('span'), note = document.createElement('span');
  tip.append(value, when, note);
  host.appendChild(tip);

  const svg = host.querySelector('svg')!;
  const show = (i: number) => {
    const p = points[i];
    value.textContent = peso(p.value); when.textContent = p.fullLabel; note.textContent = p.note;
    // Beside the column (never over it): to the right in the left half of the chart, to the left in the right half
    const cx = PAD.left + band * i + band / 2;
    const toLeft = cx > width / 2;
    tip.classList.toggle('to-left', toLeft);
    tip.style.left = `${cx + (toLeft ? -1 : 1) * (barW / 2 + 10)}px`;
    tip.style.top = `${PAD.top}px`;
    tip.classList.add('on'); host.classList.add('reading');
    svg.querySelectorAll('.bar.lift').forEach((el) => el.classList.remove('lift'));
    svg.querySelector(`.bar[data-bar="${i}"]`)?.classList.add('lift');
  };
  const hide = () => { tip.classList.remove('on'); host.classList.remove('reading'); svg.querySelectorAll('.bar.lift').forEach((el) => el.classList.remove('lift')); };
  const indexOf = (target: EventTarget | null) => {
    const el = (target as Element | null)?.closest?.('[data-hit]');
    return el ? Number(el.getAttribute('data-hit')) : -1;
  };
  svg.addEventListener('pointermove', (e) => { const i = indexOf(e.target); if (i >= 0) show(i); else hide(); });
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('focusin', (e) => { const i = indexOf(e.target); if (i >= 0) show(i); });
  svg.addEventListener('focusout', hide);
}
