/**
 * Masscience — Canvas chart rendering
 */
import { round } from './utils.js';

const COLORS = {
  measured: '#4ade80',
  estimated: '#64748b',
  trend: '#38bdf8',
  target: '#a78bfa',
  bf: '#f472b6',
  bfTarget: '#fb923c',
  calories: '#fbbf24',
  grid: 'rgba(148, 163, 184, 0.1)',
  text: '#94a3b8',
  bg: 'transparent',
};

export function renderWeightChart(canvas, data, options = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const pad = { top: 20, right: 16, bottom: 30, left: 48 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);

  const { series = [], trajectory = [] } = data;
  if (!series.length) {
    drawEmptyState(ctx, w, h, 'Your trend starts here.');
    return;
  }

  const allWeights = [
    ...series.map(s => s.measured ?? s.estimated ?? s.trend),
    ...trajectory.map(t => t.weight),
  ].filter(v => v != null);

  const minW = Math.min(...allWeights) - 0.5;
  const maxW = Math.max(...allWeights) + 0.5;
  const range = maxW - minW || 1;

  const xScale = (i, total) => pad.left + (i / Math.max(total - 1, 1)) * chartW;
  const yScale = (val) => pad.top + chartH - ((val - minW) / range) * chartH;

  drawGrid(ctx, pad, chartW, chartH, minW, maxW, 4);

  if (trajectory.length) {
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = COLORS.target;
    ctx.lineWidth = 1.5;
    trajectory.forEach((t, i) => {
      const x = xScale(i, trajectory.length);
      const y = yScale(t.weight);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  series.forEach((s, i) => {
    if (s.estimated != null) {
      ctx.beginPath();
      ctx.fillStyle = COLORS.estimated;
      ctx.globalAlpha = 0.5;
      ctx.arc(xScale(i, series.length), yScale(s.estimated), 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (s.measured != null) {
      ctx.beginPath();
      ctx.fillStyle = s.isOutlier ? '#f87171' : COLORS.measured;
      ctx.arc(xScale(i, series.length), yScale(s.measured), s.isOutlier ? 5 : 4, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  ctx.beginPath();
  ctx.strokeStyle = COLORS.trend;
  ctx.lineWidth = 2.5;
  series.forEach((s, i) => {
    const x = xScale(i, series.length);
    const y = yScale(s.trend);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  drawLegend(ctx, w, pad.top, [
    { color: COLORS.measured, label: 'Measured' },
    { color: COLORS.estimated, label: 'Estimated', alpha: 0.5 },
    { color: COLORS.trend, label: 'Trend' },
    { color: COLORS.target, label: 'Target', dashed: true },
  ]);
}

export function renderBFChart(canvas, bfHistory, maxBf) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const pad = { top: 20, right: 16, bottom: 30, left: 48 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);

  if (!bfHistory.length) {
    drawEmptyState(ctx, w, h, 'Add a Body Check to improve your estimate.');
    return;
  }

  const values = bfHistory.map(b => b.bf);
  const minBf = Math.min(...values, maxBf) - 1;
  const maxVal = Math.max(...values, maxBf) + 1;
  const range = maxVal - minBf || 1;

  const xScale = (i) => pad.left + (i / Math.max(bfHistory.length - 1, 1)) * chartW;
  const yScale = (val) => pad.top + chartH - ((val - minBf) / range) * chartH;

  drawGrid(ctx, pad, chartW, chartH, minBf, maxVal, 4);

  if (maxBf) {
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = COLORS.bfTarget;
    ctx.lineWidth = 1.5;
    const y = yScale(maxBf);
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + chartW, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.beginPath();
  ctx.strokeStyle = COLORS.bf;
  ctx.lineWidth = 2;
  bfHistory.forEach((b, i) => {
    const x = xScale(i);
    const y = yScale(b.bf);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  bfHistory.forEach((b, i) => {
    ctx.beginPath();
    ctx.fillStyle = COLORS.bf;
    ctx.arc(xScale(i), yScale(b.bf), 3, 0, Math.PI * 2);
    ctx.fill();
  });
}

export function renderCalorieChart(canvas, history, currentTarget) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const pad = { top: 20, right: 16, bottom: 30, left: 56 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);

  if (!history.length) {
    drawEmptyState(ctx, w, h, 'Calorie adjustments will appear here.');
    return;
  }

  const values = history.map(c => c.new);
  const minC = Math.min(...values) - 100;
  const maxC = Math.max(...values) + 100;
  const range = maxC - minC || 1;

  const barW = Math.min(chartW / history.length - 4, 40);
  const gap = (chartW - barW * history.length) / (history.length + 1);

  history.forEach((c, i) => {
    const x = pad.left + gap + i * (barW + gap);
    const barH = ((c.new - minC) / range) * chartH;
    const y = pad.top + chartH - barH;

    ctx.fillStyle = c.adjustment > 0 ? '#4ade80' : c.adjustment < 0 ? '#f87171' : COLORS.calories;
    ctx.fillRect(x, y, barW, barH);

    ctx.fillStyle = COLORS.text;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(c.new, x + barW / 2, y - 4);
  });
}

export function renderProjectionChart(canvas, milestones) {
  if (!canvas || !milestones.length) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const pad = { top: 30, right: 16, bottom: 40, left: 16 };
  const stepW = (w - pad.left - pad.right) / Math.max(milestones.length - 1, 1);
  const centerY = h / 2;

  ctx.clearRect(0, 0, w, h);

  ctx.beginPath();
  ctx.strokeStyle = COLORS.trend;
  ctx.lineWidth = 2;
  milestones.forEach((m, i) => {
    const x = pad.left + i * stepW;
    i === 0 ? ctx.moveTo(x, centerY) : ctx.lineTo(x, centerY);
  });
  ctx.stroke();

  milestones.forEach((m, i) => {
    const x = pad.left + i * stepW;
    ctx.beginPath();
    ctx.fillStyle = i === 0 ? COLORS.measured : COLORS.trend;
    ctx.arc(x, centerY, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${m.weight}${m.weightRange ? '' : ''}`, x, centerY - 16);
    ctx.fillStyle = COLORS.text;
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillText(typeof m.bf === 'string' ? m.bf : `~${m.bf}%`, x, centerY + 24);
    ctx.fillText(m.label, x, h - 10);
  });
}

function drawGrid(ctx, pad, chartW, chartH, min, max, lines) {
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.fillStyle = COLORS.text;
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';

  for (let i = 0; i <= lines; i++) {
    const val = min + (max - min) * (i / lines);
    const y = pad.top + chartH - (i / lines) * chartH;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + chartW, y);
    ctx.stroke();
    ctx.fillText(round(val, 1), pad.left - 6, y + 3);
  }
}

function drawEmptyState(ctx, w, h, text) {
  ctx.fillStyle = COLORS.text;
  ctx.font = '13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, w / 2, h / 2);
}

function drawLegend(ctx, w, y, items) {
  let x = 16;
  ctx.font = '10px system-ui, sans-serif';
  items.forEach(item => {
    ctx.beginPath();
    if (item.dashed) ctx.setLineDash([3, 3]);
    ctx.strokeStyle = item.color;
    ctx.lineWidth = 2;
    ctx.moveTo(x, y);
    ctx.lineTo(x + 16, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'left';
    ctx.fillText(item.label, x + 20, y + 3);
    x += ctx.measureText(item.label).width + 40;
  });
}
