const fs = require('fs');
const path = require('path');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return escapeHtml(String(value));
  return d.toISOString().slice(0, 10);
}

function asMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function normalizePdfText(value) {
  const text = String(value ?? '').normalize('NFKC').replace(/\uFFFD/g, ' - ');
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
}

function getLogoDataUri() {
  const candidatePaths = [
    path.resolve(__dirname, '../../../frontend/public/silver-foundation-logo.png'),
    path.resolve(__dirname, '../../../frontend/public/sfcc-logo.png'),
  ];

  const logoPath = candidatePaths.find((p) => fs.existsSync(p));
  if (!logoPath) return '';

  const raw = fs.readFileSync(logoPath);
  return `data:image/png;base64,${raw.toString('base64')}`;
}

function renderLogoMarkup(logoDataUri) {
  if (!logoDataUri) return '<div class="logo-fallback">SILVER FOUNDATION</div>';
  return `<img src="${logoDataUri}" class="logo" alt="Silver Foundation"/><div class="logo-fallback" style="display:none">SILVER FOUNDATION</div>`;
}

function normalizeStatus(task) {
  const pct = Math.max(0, Math.min(100, Number(task.progress_percent || 0)));
  if (pct >= 100) return 'Complete';
  if (String(task.status || '').trim() === 'On Hold') return 'On Hold';
  const today = new Date().toISOString().slice(0, 10);
  if (task.planned_finish && task.planned_finish < today) return 'Overdue';
  if (pct > 0) return 'In Progress';
  return 'Not Started';
}

function statusColor(status) {
  if (status === 'Complete') return '#22A06B';
  if (status === 'In Progress') return '#2563EB';
  if (status === 'Overdue') return '#DC2626';
  if (status === 'On Hold') return '#F59E0B';
  return '#94A3B8';
}

function buildHeader(project, reportTitle, logo, generatedDate) {
  const dateRange = `${formatDate(project.start_date)} → ${formatDate(project.target_completion_date || project.finish_date || project.end_date)}`;
  const info = [
    ['Project Name', project.name || '—'],
    ['Project Code', project.code || project.project_no || '—'],
    ['Client', project.client || '—'],
    ['Consultant', project.consultant || '—'],
    ['Main Contractor', project.main_contractor || '—'],
    ['Contract Value', asMoney(project.contract_value)],
    ['Project Start Date', formatDate(project.start_date)],
    ['Finish / Target Completion', formatDate(project.target_completion_date || project.finish_date || project.end_date)],
    ['Schedule Date Range', dateRange],
    ['Generated Date', generatedDate],
  ];
  const metaRows = info.map(([label, value]) => `<div class="meta-item"><span class="meta-label">${label}</span><span class="meta-value">${escapeHtml(normalizePdfText(value || '—'))}</span></div>`).join('');
  return `<div class="header"><div class="hgrid"><div class="logo-wrap">${renderLogoMarkup(logo)}</div><div><div class="brand">SILVER FOUNDATION CONTRACTING COMPANY</div><div class="sub">Quality Management System</div><h1>${reportTitle}</h1></div></div>
  <div class="meta-section"><div class="meta-title">Project Information</div><div class="meta">${metaRows}</div></div></div>`;
}

function renderScheduleTablePdf({ project = {}, activities = [] }) {
  const logo = getLogoDataUri();
  const generatedDate = formatDate(new Date());
  const rows = activities.map((a) => {
    const progress = Math.max(0, Math.min(100, Number(a.progress_percent || 0)));
    const status = normalizeStatus(a);
    return `<tr>
      <td>${escapeHtml(a.wbs || '—')}</td>
      <td>${escapeHtml(a.activity_id || '—')}</td>
      <td class="name">${escapeHtml(a.activity_name || '—')}</td>
      <td>${formatDate(a.planned_start)}</td>
      <td>${formatDate(a.planned_finish)}</td>
      <td>${Number(a.duration_days) || '—'}</td>
      <td>${progress}%</td>
      <td>${escapeHtml(status)}</td>
      <td>${escapeHtml(a.responsible_person || '—')}</td>
      <td>${escapeHtml(a.remarks || '—')}</td>
    </tr>`;
  }).join('');

  return `<!doctype html><html><head><meta charset="utf-8"/><style>
  @page { size: A4 landscape; margin: 6mm; }
  body { font-family: Arial, sans-serif; font-size: 10px; color: #0f172a; margin: 0; }
  .header { border-bottom: 2px solid #d4a32a; margin-bottom: 8px; padding-bottom: 6px; }
  .hgrid { display:grid; grid-template-columns:130px 1fr auto; gap:8px; align-items:center; }
  .logo-wrap { width:130px; height:58px; display:flex; align-items:center; justify-content:flex-start; }
  .logo { width:118px; max-height:54px; object-fit:contain; object-position:left center; }
  .logo-fallback { font-size:11px; font-weight:800; color:#1e3a8a; line-height:1.2; }
  .brand { font-size:13px; font-weight:800; color:#1f2937; }
  .sub { font-size:9px; color:#475569; }
  h1 { margin:1px 0 0; font-size:13px; }
  .generated { font-size:8px; color:#334155; }
  .meta { margin-top:6px; display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:4px 10px; font-size:8px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead { display: table-header-group; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 5px; vertical-align: top; font-size: 9.4px; }
  th { background: #1f2937; color: #f8f1d4; font-weight: 700; text-align: left; }
  .name { line-height: 1.35; word-break: break-word; min-height: 2.7em; }
  .two-line { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  tbody tr { page-break-inside: avoid; }
  .footer { margin-top: 6px; font-size: 8px; color: #475569; text-align: right; }
  </style></head><body>
  ${buildHeader(project, 'Programme / Schedule Table', logo, generatedDate)}
  <table>
    <thead><tr><th style="width:6%">WBS</th><th style="width:8%">Activity ID</th><th style="width:30%">Activity Name / Description</th><th style="width:9%">Planned Start</th><th style="width:9%">Planned Finish</th><th style="width:6%">Duration</th><th style="width:6%">Progress %</th><th style="width:9%">Status</th><th style="width:8%">Responsible</th><th style="width:9%">Remarks</th></tr></thead>
    <tbody>${rows.replace(/class="name"/g, 'class="name two-line"') || '<tr><td colspan="10">No activities found</td></tr>'}</tbody>
  </table>
  <div class="footer">Generated by Silver Foundation Quality Management System</div>
  </body></html>`;
}

function renderScheduleGanttPdf({ project = {}, activities = [] }) {
  const logo = getLogoDataUri();
  const generatedDate = formatDate(new Date());

  const safeActivities = activities.map((a) => ({
    ...a,
    wbs: String(a.wbs || '').trim() || '—',
    activity_id: String(a.activity_id || '').trim() || '—',
    activity_name: normalizePdfText(a.activity_name || '—') || '—',
    duration_days: Number.isFinite(Number(a.duration_days)) ? Number(a.duration_days) : null,
    progress_percent: Math.max(0, Math.min(100, Number(a.progress_percent || 0))),
    status_normalized: normalizeStatus(a),
  }));

  const dated = safeActivities.filter((a) => a.planned_start && a.planned_finish);
  const starts = dated.map((a) => new Date(a.planned_start).getTime()).filter((n) => Number.isFinite(n));
  const finishes = dated.map((a) => new Date(a.planned_finish).getTime()).filter((n) => Number.isFinite(n));
  const minDate = starts.length ? new Date(Math.min(...starts)) : new Date();
  const maxDate = finishes.length ? new Date(Math.max(...finishes)) : new Date(minDate.getTime() + (30 * 86400000));
  minDate.setHours(0, 0, 0, 0);
  maxDate.setHours(0, 0, 0, 0);
  const totalDays = Math.max(1, Math.round((maxDate - minDate) / 86400000) + 1);

  const pageWidth = 1123; // A4 landscape at ~96 dpi
  const tableWidth = Math.round(pageWidth * 0.56);
  const timelineWidth = pageWidth - tableWidth;
  const rowHeight = 24;
  const headerTimelineHeight = 40;
  const tableHeaderHeight = 22;
  const maxRowsPerPage = 22;

  const columns = [
    { key: 'row', label: 'ID', width: 30, align: 'end' },
    { key: 'wbs', label: 'WBS', width: 62, align: 'start' },
    { key: 'activity_id', label: 'Activity ID', width: 74, align: 'start' },
    { key: 'activity_name', label: 'Activity Name / Description', width: 240, align: 'start' },
    { key: 'duration', label: 'Duration', width: 48, align: 'end' },
    { key: 'start', label: 'Planned Start', width: 78, align: 'start' },
    { key: 'finish', label: 'Planned Finish', width: 78, align: 'start' },
    { key: 'progress', label: 'Progress %', width: 56, align: 'end' },
  ];

  let x = 0;
  const columnLayout = columns.map((c) => {
    const out = { ...c, x };
    x += c.width;
    return out;
  });

  const inferDepth = (wbs) => {
    const val = String(wbs || '').trim();
    if (!val || val === '—') return 0;
    return Math.max(0, val.split('.').length - 1);
  };

  const isSummaryRow = (a) => {
    const noDates = !a.planned_start && !a.planned_finish;
    if (noDates) return true;
    return !a.activity_id || a.activity_id === '—';
  };

  const normalized = safeActivities.map((a, idx) => ({
    ...a,
    rowNo: idx + 1,
    depth: inferDepth(a.wbs),
    isSummary: isSummaryRow(a),
  }));

  const chunks = [];
  for (let i = 0; i < normalized.length; i += maxRowsPerPage) chunks.push(normalized.slice(i, i + maxRowsPerPage));
  if (!chunks.length) chunks.push([]);

  const dayOffset = (v) => {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return 0;
    d.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((d - minDate) / 86400000));
  };

  const mkText = (val) => escapeHtml(normalizePdfText(val || '—'));

  const quarterTicks = [];
  const monthTicks = [];
  for (let d = new Date(minDate); d <= maxDate; d.setMonth(d.getMonth() + 1)) {
    monthTicks.push(new Date(d));
    if ([0, 3, 6, 9].includes(d.getMonth())) quarterTicks.push(new Date(d));
  }

  const textLines = (text, max = 48) => {
    const words = normalizePdfText(text || '—').split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const nxt = cur ? `${cur} ${w}` : w;
      if (nxt.length <= max) cur = nxt;
      else { if (cur) lines.push(cur); cur = w; }
      if (lines.length >= 2) break;
    }
    if (lines.length < 2 && cur) lines.push(cur);
    return lines.slice(0, 2);
  };

  const renderPageSvg = (rows) => {
    const bodyHeight = rows.length * rowHeight;
    const svgHeight = headerTimelineHeight + tableHeaderHeight + bodyHeight + 30;
    const startY = headerTimelineHeight + tableHeaderHeight;

    const gridV = monthTicks.map((d) => {
      const px = tableWidth + ((dayOffset(d) / totalDays) * timelineWidth);
      return `<line x1="${px}" y1="${headerTimelineHeight}" x2="${px}" y2="${startY + bodyHeight}" stroke="#dbe4ef" stroke-width="1"/>`;
    }).join('');

    const quarterLabels = quarterTicks.map((d) => {
      const px = tableWidth + ((dayOffset(d) / totalDays) * timelineWidth);
      const q = Math.floor(d.getMonth() / 3) + 1;
      return `<text x="${px + 2}" y="12" font-size="8" font-weight="700">Q${q} ${d.getFullYear()}</text>`;
    }).join('');

    const monthLabels = monthTicks.map((d) => {
      const px = tableWidth + ((dayOffset(d) / totalDays) * timelineWidth);
      return `<text x="${px + 2}" y="28" font-size="8">${d.toLocaleDateString('en-US', { month: 'short' })}</text>`;
    }).join('');

    const hLines = Array.from({ length: rows.length + 1 }, (_, i) => `<line x1="0" y1="${startY + i * rowHeight}" x2="${pageWidth}" y2="${startY + i * rowHeight}" stroke="#e6edf5"/>`).join('');

    const colLines = columnLayout.map((c) => `<line x1="${c.x}" y1="${headerTimelineHeight}" x2="${c.x}" y2="${startY + bodyHeight}" stroke="#d1d9e3"/>`).join('');

    const tableRows = rows.map((r, i) => {
      const y = startY + i * rowHeight;
      const cy = y + 15;
      const bg = r.isSummary ? `<rect x="0" y="${y}" width="${pageWidth}" height="${rowHeight}" fill="#eef3db"/>` : '';
      const taskLines = textLines(r.activity_name, 48);
      const indent = Math.min(18, r.depth * 6);
      return `${bg}
      <text x="${columnLayout[0].x + columnLayout[0].width - 3}" y="${cy}" text-anchor="end" font-size="8">${r.rowNo}</text>
      <text x="${columnLayout[1].x + 3}" y="${cy}" font-size="8" font-weight="${r.isSummary ? '700' : '400'}">${mkText(r.wbs)}</text>
      <text x="${columnLayout[2].x + 3}" y="${cy}" font-size="8">${mkText(r.activity_id)}</text>
      <text x="${columnLayout[3].x + 3 + indent}" y="${y + 10}" font-size="8" font-weight="${r.isSummary ? '700' : '400'}">${taskLines.map((ln, li) => `<tspan x="${columnLayout[3].x + 3 + indent}" dy="${li === 0 ? 0 : 8.5}">${mkText(ln)}</tspan>`).join('')}</text>
      <text x="${columnLayout[4].x + columnLayout[4].width - 3}" y="${cy}" text-anchor="end" font-size="8">${r.duration_days ?? '—'}</text>
      <text x="${columnLayout[5].x + 3}" y="${cy}" font-size="8">${formatDate(r.planned_start)}</text>
      <text x="${columnLayout[6].x + 3}" y="${cy}" font-size="8">${formatDate(r.planned_finish)}</text>
      <text x="${columnLayout[7].x + columnLayout[7].width - 3}" y="${cy}" text-anchor="end" font-size="8">${r.progress_percent}%</text>`;
    }).join('');

    const bars = rows.map((r, i) => {
      if (!r.planned_start || !r.planned_finish) return '';
      const s = new Date(r.planned_start); const f = new Date(r.planned_finish);
      if (Number.isNaN(s.getTime()) || Number.isNaN(f.getTime())) return '';
      const start = dayOffset(r.planned_start);
      const span = Math.max(0, Math.round((f - s) / 86400000));
      const x0 = tableWidth + (start / totalDays) * timelineWidth;
      const y = startY + i * rowHeight + 4;
      const barH = r.isSummary ? 9 : 10;
      if (span === 0) {
        const cx = x0 + 2; const cy = y + 5;
        return `<polygon points="${cx},${cy - 4} ${cx + 4},${cy} ${cx},${cy + 4} ${cx - 4},${cy}" fill="#111827"/>`;
      }
      const w = Math.max(8, (span / totalDays) * timelineWidth);
      const overdue = r.status_normalized === 'Overdue';
      const baseColor = r.isSummary ? '#111827' : overdue ? '#dc2626' : '#3b82f6';
      const progressColor = r.progress_percent >= 100 ? '#16a34a' : '#0f172a';
      const progressWidth = Math.max(0, Math.min(w, w * (r.progress_percent / 100)));
      return `<rect x="${x0}" y="${y}" width="${w}" height="${barH}" rx="2" fill="${baseColor}"/>
      ${progressWidth > 0 ? `<rect x="${x0}" y="${y + 2}" width="${progressWidth}" height="${Math.max(4, barH - 4)}" rx="2" fill="${progressColor}" opacity="0.45"/>` : ''}`;
    }).join('');

    const headers = columnLayout.map((c) => `<text x="${c.x + 3}" y="${headerTimelineHeight + 14}" font-size="8" fill="#f8f1d4" font-weight="700">${c.label}</text>`).join('');

    return `<svg width="${pageWidth}" height="${svgHeight}" viewBox="0 0 ${pageWidth} ${svgHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${pageWidth}" height="${svgHeight}" fill="#fff"/>
      <rect x="0" y="${headerTimelineHeight}" width="${tableWidth}" height="${tableHeaderHeight}" fill="#1f2937"/>
      <rect x="${tableWidth}" y="${headerTimelineHeight}" width="${timelineWidth}" height="${tableHeaderHeight}" fill="#1f2937"/>
      <text x="${tableWidth + 4}" y="${headerTimelineHeight + 14}" font-size="8" fill="#f8f1d4" font-weight="700">Timeline</text>
      ${headers}
      ${quarterLabels}
      ${monthLabels}
      ${gridV}
      ${hLines}
      ${colLines}
      <line x1="${tableWidth}" y1="0" x2="${tableWidth}" y2="${startY + bodyHeight}" stroke="#94a3b8" stroke-width="1.2"/>
      ${tableRows}
      ${bars}
    </svg>`;
  };

  const legend = `<div class="legend"><span><i class="task"></i> Task</span><span><i class="summary"></i> Summary</span><span><i class="mile"></i> Milestone</span><span><i class="prog"></i> Progress</span><span><i class="ext"></i> External Task (N/A)</span><span><i class="ddl"></i> Deadline (N/A)</span></div>`;

  const pages = chunks.map((chunk, idx) => `<section class="page ${idx ? 'break' : ''}">
    ${buildHeader(project, 'Programme / Schedule Gantt', logo, generatedDate)}
    <div class="range">Timeline: ${formatDate(minDate)} to ${formatDate(maxDate)} (${totalDays} days) | Page ${idx + 1} / ${chunks.length}</div>
    <div class="board">${renderPageSvg(chunk)}</div>
    ${legend}
    <div class="footer">${escapeHtml(project.name || '—')} (${escapeHtml(project.code || project.project_no || '—')}) · Generated by Silver Foundation Quality Management System · Page ${idx + 1} of ${chunks.length}</div>
  </section>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8"/><style>
    @page { size:A4 landscape; margin:6mm; }
    body { margin:0; font-family:Arial,sans-serif; color:#0f172a; font-size:9px; }
    .page { page-break-inside: avoid; }
    .break { break-before: page; }
    .header { border-bottom:2px solid #d4a32a; margin-bottom:6px; padding-bottom:5px; }
    .hgrid { display:grid; grid-template-columns:100px 1fr; gap:8px; align-items:center; }
    .logo-wrap { width:100px; height:46px; display:flex; align-items:center; }
    .logo { width:90px; max-height:42px; object-fit:contain; }
    .logo-fallback { font-size:10px; font-weight:700; }
    .brand { font-size:12px; font-weight:800; }
    .sub { font-size:8px; color:#475569; }
    h1 { margin:0; font-size:12px; }
    .meta-section { margin-top:4px; border:1px solid #e2e8f0; padding:4px; background:#f8fafc; }
    .meta-title { font-size:8px; font-weight:700; margin-bottom:2px; }
    .meta { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:4px 8px; font-size:7.5px; }
    .meta-label { font-weight:700; }
    .range { margin:2px 0 4px; font-size:8px; color:#334155; }
    .board { border:1px solid #cbd5e1; }
    .board svg { width:100%; height:auto; display:block; }
    .legend { display:flex; flex-wrap:wrap; gap:8px; margin-top:4px; font-size:7.7px; color:#334155; }
    .legend i { display:inline-block; width:14px; height:8px; margin-right:4px; vertical-align:middle; border-radius:2px; }
    .legend .task { background:#3b82f6; }
    .legend .summary { background:#111827; height:9px; }
    .legend .mile { width:8px; height:8px; background:#111827; transform:rotate(45deg); border-radius:0; }
    .legend .prog { background:#0f172a; opacity:.45; }
    .legend .ext { background:#94a3b8; }
    .legend .ddl { background:#dc2626; }
    .footer { margin-top:4px; font-size:7.7px; color:#475569; text-align:right; }
  </style></head><body>${pages}</body></html>`;
}


module.exports = { renderScheduleGanttPdf, renderScheduleTablePdf };
