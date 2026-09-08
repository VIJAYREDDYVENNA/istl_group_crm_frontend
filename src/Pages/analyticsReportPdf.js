// ─────────────────────────────────────────────────────────────────────────────
//  Lead Analytics — PDF report
//
//  Built with jsPDF from the SAME JSON the page renders, so a downloaded report
//  can never disagree with what was on screen. Nothing here screenshots the DOM:
//  html2canvas is not a dependency, and rasterising the panels would drag the
//  dark theme and the CSS into a document that has to print. Every chart below
//  is drawn as vectors instead — crisp at any zoom.
//
//  The page furniture deliberately matches the Purchase Order / Proposal PDFs
//  (PurchaseOrderPdfService): Poppins throughout, the Sesola logo top-right on
//  every page, and the same footer — a pale-green rule with the company block
//  centred underneath. Fonts and the logo are fetched from /report-assets at
//  download time rather than bundled, so they cost nothing until someone asks
//  for a report. If either fetch fails the report still builds, in Helvetica.
//
//  The report always reflects the CURRENT filter and the CURRENT scope: it is
//  handed the already-scoped payload, so a telecaller downloading this gets a
//  report of their own leads and nothing else. Blocks flow one after another and
//  only break to a new page when the next one genuinely will not fit.
// ─────────────────────────────────────────────────────────────────────────────
import { jsPDF } from 'jspdf';

// A4 portrait, millimetres. Margins match the PO's 32pt.
const PW = 210, PH = 297;
const M = 12;
const CW = PW - M * 2;
const TOP = 26;                    // first content line, clear of the running logo
const FOOT_LIMIT = 268;            // content must stop here; footer furniture owns the rest

// Footer geometry, converted from the PO's points (1 mm = 2.8346 pt).
const RULE_Y = 273.7;              // PO: green rule at y=66pt from the bottom
const LOGO_W = 52.9, LOGO_H = 10.4, LOGO_Y = 8;   // PO: scaleToFit(150, 42)pt

const ASSET_BASE = `${process.env.PUBLIC_URL || ''}/report-assets/`;

// Company block — identical strings to PurchaseOrderPdfService so the documents
// read as one family. Keep these in step if the PO's ever change.
const FOOTER_NAME = 'SESOLA POWER PROJECTS PRIVATE LIMITED';
const FOOTER_ADDR = '8th Floor, Pranava Vaishnoi Business Park, Kothaguda Village, Serilingampally Mandal, '
                  + 'Ranga Reddy District, Telangana India 500084';
const FOOTER_CONTACT = 'www.sesolaenergy.com | Email: info@sesolaenergy.com | M: +91 8340020020';

const C = {
  navy:   [0x1F, 0x49, 0x7D],       // PO heading blue
  rule:   [0xCF, 0xE2, 0xB0],       // PO footer rule green
  blue:   [91, 140, 255],
  green:  [39, 211, 162],
  amber:  [255, 181, 69],
  pink:   [255, 107, 138],
  purple: [168, 128, 255],
  cyan:   [70, 200, 255],
  lime:   [141, 227, 106],
  orange: [255, 143, 92],
  ink:    [29, 37, 53],
  body:   [71, 85, 105],
  muted:  [125, 139, 160],
  line:   [222, 228, 238],
  head:   [0xF2, 0xF2, 0xF2],       // PO table header grey
  panel:  [247, 249, 252],
  zebra:  [251, 252, 254],
};
const SERIES = [C.blue, C.green, C.amber, C.pink, C.purple, C.cyan, C.lime, C.orange];

const SCOPE_TEXT = {
  all:  'All company data',
  team: 'Your team (your reporting line)',
  self: 'Your own leads only',
};

const int = n => (n == null ? '-' : Number(n).toLocaleString('en-IN'));
const pct = n => (n == null ? '-' : `${n}%`);
const days = n => (n == null ? '-' : `${n} day${n === 1 ? '' : 's'}`);
const role = r => String(r || '').replace(/_/g, ' ');

/** Fetch a binary asset as base64. Returns null instead of throwing — a missing
 *  font or logo must degrade the report, never block the download. */
async function fetchBase64(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    }
    return btoa(s);
  } catch {
    return null;
  }
}

export default class AnalyticsReport {
  constructor({ data, team, user, rangeLabel, assetBase }) {
    this.data = data;
    this.team = team;
    this.user = user || {};
    this.rangeLabel = rangeLabel || '';
    this.assetBase = assetBase || ASSET_BASE;
    this.doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    this.family = 'helvetica';     // until Poppins actually loads
    this.logo = null;
    this.y = TOP;
  }

  /** Pull Poppins + the logo. Both are optional; the report builds without them. */
  async loadAssets() {
    const [reg, bold, logo] = await Promise.all([
      fetchBase64(this.assetBase + 'Poppins-Regular.ttf'),
      fetchBase64(this.assetBase + 'Poppins-Bold.ttf'),
      fetchBase64(this.assetBase + 'sesola_logo.png'),
    ]);
    if (reg && bold) {
      this.doc.addFileToVFS('Poppins-Regular.ttf', reg);
      this.doc.addFont('Poppins-Regular.ttf', 'Poppins', 'normal');
      this.doc.addFileToVFS('Poppins-Bold.ttf', bold);
      this.doc.addFont('Poppins-Bold.ttf', 'Poppins', 'bold');
      this.family = 'Poppins';
    }
    if (logo) this.logo = 'data:image/png;base64,' + logo;
  }

  // ── primitives ────────────────────────────────────────────────────────────
  font(style = 'normal', size, colour) {
    this.doc.setFont(this.family, style);
    if (size != null) this.doc.setFontSize(size);
    if (colour) this.doc.setTextColor(...colour);
    return this.doc;
  }

  /** Start a new page if `h` mm will not fit above the footer furniture. */
  need(h) {
    if (this.y + h <= FOOT_LIMIT) return false;
    this.doc.addPage();
    this.y = TOP;
    return true;
  }

  /**
   * Section heading — navy, with a hairline under it. `blockH` is the height of
   * the content that follows: the heading and its block page-break as one unit,
   * so a title can never be orphaned at the foot of a page with its chart or
   * table stranded on the next.
   */
  section(title, note, blockH = 0) {
    this.need(13 + blockH);
    const d = this.doc;
    this.font('bold', 10.5, C.navy).text(title, M, this.y + 3.6);
    if (note) {
      this.font('normal', 7.5, C.muted).text(note, M + CW, this.y + 3.4, { align: 'right' });
    }
    d.setDrawColor(...C.line).setLineWidth(0.3);
    d.line(M, this.y + 6, M + CW, this.y + 6);
    this.y += 11;
  }

  /** Logo + footer, drawn on every page once the page count is settled. */
  stampChrome() {
    const d = this.doc;
    const total = d.getNumberOfPages();
    const who = this.user.name || this.user.userName || 'CRM user';
    const when = new Date().toLocaleString('en-IN');
    for (let p = 1; p <= total; p++) {
      d.setPage(p);
      if (this.logo) {
        try { d.addImage(this.logo, 'PNG', PW - M - LOGO_W, LOGO_Y, LOGO_W, LOGO_H); } catch { /* optional */ }
      }
      this.font('normal', 6.5, C.muted);
      d.text(`Generated by ${who} on ${when}`, M, RULE_Y - 2.5);
      d.text(`Page ${p} of ${total}`, M + CW, RULE_Y - 2.5, { align: 'right' });

      d.setDrawColor(...C.rule).setLineWidth(0.55);
      d.line(M, RULE_Y, M + CW, RULE_Y);

      this.font('bold', 11, C.navy).text(FOOTER_NAME, PW / 2, RULE_Y + 5.4, { align: 'center' });
      this.font('normal', 6.2, C.body);
      d.text(FOOTER_ADDR, PW / 2, RULE_Y + 9.6, { align: 'center', maxWidth: CW });
      d.text(FOOTER_CONTACT, PW / 2, RULE_Y + 13.4, { align: 'center' });
    }
  }

  // ── sections ──────────────────────────────────────────────────────────────
  titleBlock() {
    const d = this.doc, dt = this.data;
    this.font('bold', 17, C.navy).text('Lead Analytics Report', M, this.y + 2);
    this.font('normal', 9, C.body)
      .text(`${this.rangeLabel}  |  ${dt.from} to ${dt.to}`, M, this.y + 8.5);
    this.font('normal', 8, C.muted)
      .text(`Data scope: ${SCOPE_TEXT[dt.scope] || 'not reported'}`, M, this.y + 13.5);
    d.setDrawColor(...C.navy).setLineWidth(0.7);
    d.line(M, this.y + 17.5, M + CW, this.y + 17.5);
    this.y += 24;
  }

  kpis() {
    const d = this.doc, dt = this.data;
    const cards = [
      ['Leads Generated',     int(dt.leadsGenerated),        C.blue,   'In the selected range'],
      ['Leads Won',           int(dt.leadsWon),              C.green,  'Closed Won'],
      ['Conversion Rate',     pct(dt.conversionRate),        C.amber,  'Won of all generated'],
      ['Close Rate',          pct(dt.closeRate),             C.cyan,   'Won of all closed'],
      ['Avg Time to Convert', days(dt.avgDaysToConvert),     C.pink,   `n = ${int(dt.convertedSampleSize)}`],
      ['Median Time',         days(dt.medianDaysToConvert),  C.purple, 'Half convert faster'],
    ];
    const cols = 3, gap = 4;
    const w = (CW - gap * (cols - 1)) / cols, h = 22;
    const rows = Math.ceil(cards.length / cols);
    this.need(rows * (h + gap));

    cards.forEach(([label, value, colour, hint], i) => {
      const x = M + (i % cols) * (w + gap);
      const yy = this.y + Math.floor(i / cols) * (h + gap);
      d.setFillColor(...C.panel);
      d.roundedRect(x, yy, w, h, 1.6, 1.6, 'F');
      d.setFillColor(...colour);
      d.roundedRect(x, yy, 1.8, h, 0.9, 0.9, 'F');
      this.font('normal', 7.2, C.muted).text(label, x + 5, yy + 6.5);
      this.font('bold', 14, C.ink).text(value, x + 5, yy + 14.5);
      this.font('normal', 6.2, C.muted).text(hint, x + 5, yy + 19);
    });
    this.y += rows * (h + gap) + 5;
  }

  /** Grouped Generated-vs-Won bars, drawn to scale with a zero baseline. */
  trendChart() {
    const series = this.data.series || [];
    if (!series.length) return;
    const plotH = 50;
    this.section('Leads Generated vs Won',
      `${this.data.granularity} buckets - won by close date`, plotH + 16);

    const d = this.doc;
    const x0 = M + 11, y0 = this.y, plotW = CW - 11;
    const max = Math.max(1, ...series.map(b => Math.max(b.generated, b.won)));
    const step = niceStep(max), top = Math.ceil(max / step) * step;

    this.font('normal', 6.5, C.muted);
    for (let v = 0; v <= top; v += step) {
      const yy = y0 + plotH - (v / top) * plotH;
      d.setDrawColor(...C.line).setLineWidth(0.2);
      d.line(x0, yy, x0 + plotW, yy);
      d.text(String(v), x0 - 2, yy + 1.5, { align: 'right' });
    }

    const slot = plotW / series.length;
    const barW = Math.min(6, Math.max(1.2, (slot - 1.4) / 2));
    const everyN = Math.max(1, Math.ceil(series.length / 12));

    series.forEach((b, i) => {
      const cx = x0 + i * slot + slot / 2;
      const gh = (b.generated / top) * plotH;
      const wh = (b.won / top) * plotH;
      d.setFillColor(...C.blue);
      d.rect(cx - barW - 0.7, y0 + plotH - gh, barW, gh, 'F');
      d.setFillColor(...C.green);
      d.rect(cx + 0.7, y0 + plotH - wh, barW, wh, 'F');
      if (i % everyN === 0) {
        this.font('normal', 6, C.muted).text(String(b.label), cx, y0 + plotH + 4, { align: 'center' });
      }
    });

    d.setDrawColor(...C.muted).setLineWidth(0.3);
    d.line(x0, y0 + plotH, x0 + plotW, y0 + plotH);
    this.y = y0 + plotH + 7.5;
    this.legend([['Generated', C.blue], ['Won (by close date)', C.green]], x0);
  }

  legend(items, startX = M) {
    const d = this.doc;
    let x = startX;
    this.font('normal', 7, C.body);
    items.forEach(([label, colour]) => {
      d.setFillColor(...colour);
      d.rect(x, this.y - 2, 2.6, 2.6, 'F');
      d.text(label, x + 4, this.y);
      x += 4 + d.getTextWidth(label) + 7;
    });
    this.y += 6;
  }

  /**
   * Lead status: the pie AND the numbers, side by side. The chart answers "what
   * shape is the pipeline", the table answers "how many are New, how many have a
   * proposal out" — a slice cannot be read to a number, so both are printed.
   * jsPDF has no arc primitive, so each slice is a polygon approximated at
   * 2-degree steps; in print it is indistinguishable from a true arc.
   */
  statusBreakdown() {
    const rows = (this.data.byStatus || []).filter(r => Number(r.count) > 0);
    if (!rows.length) return;
    const size = 52;
    const tableH = (rows.length + 2) * 6.2 + 4;
    this.section('Lead Status Breakdown', 'Where every lead in the range sits now',
      Math.max(size, tableH) + 4);

    const d = this.doc;

    const total = rows.reduce((s, r) => s + Number(r.count), 0);
    const cx = M + size / 2, cy = this.y + size / 2, R = size / 2 - 1;

    let a = -Math.PI / 2;                                   // start at 12 o'clock
    rows.forEach((r, i) => {
      const sweep = (Number(r.count) / total) * Math.PI * 2;
      const steps = Math.max(2, Math.ceil((sweep * 180 / Math.PI) / 2));
      const deltas = [];
      let px = cx + R * Math.cos(a), py = cy + R * Math.sin(a);
      deltas.push([px - cx, py - cy]);
      for (let s = 1; s <= steps; s++) {
        const ang = a + (sweep * s) / steps;
        const nx = cx + R * Math.cos(ang), ny = cy + R * Math.sin(ang);
        deltas.push([nx - px, ny - py]);
        px = nx; py = ny;
      }
      d.setFillColor(...SERIES[i % SERIES.length]);
      d.lines(deltas, cx, cy, [1, 1], 'F', true);
      a += sweep;
    });

    // ── the numbers, beside the chart ──
    const tx = M + size + 8, tw = CW - size - 8;
    const cStatus = tw - 46, cCount = 22, cShare = 24;
    let ty = this.y;

    d.setFillColor(...C.head);
    d.rect(tx, ty, tw, 6.4, 'F');
    this.font('bold', 7.5, C.body);
    d.text('Status', tx + 6, ty + 4.4);
    d.text('Leads', tx + cStatus + cCount - 2, ty + 4.4, { align: 'right' });
    d.text('Share', tx + cStatus + cCount + cShare - 2, ty + 4.4, { align: 'right' });
    ty += 6.4;

    rows.forEach((r, i) => {
      if (i % 2 === 1) { d.setFillColor(...C.zebra); d.rect(tx, ty, tw, 6.2, 'F'); }
      d.setFillColor(...SERIES[i % SERIES.length]);
      d.rect(tx + 1.5, ty + 2, 2.8, 2.8, 'F');
      this.font('normal', 7.5, C.body);
      d.text(trim(d, String(r.label), cStatus - 8), tx + 6, ty + 4.3);
      this.font('bold', 7.5, C.ink)
        .text(int(r.count), tx + cStatus + cCount - 2, ty + 4.3, { align: 'right' });
      const share = Math.round((Number(r.count) / total) * 1000) / 10;
      this.font('normal', 7.5, C.body)
        .text(`${share}%`, tx + cStatus + cCount + cShare - 2, ty + 4.3, { align: 'right' });
      d.setDrawColor(...C.line).setLineWidth(0.15);
      d.line(tx, ty + 6.2, tx + tw, ty + 6.2);
      ty += 6.2;
    });

    d.setDrawColor(...C.navy).setLineWidth(0.4);
    d.line(tx, ty, tx + tw, ty);
    this.font('bold', 7.5, C.navy);
    d.text('Total', tx + 6, ty + 4.6);
    d.text(int(total), tx + cStatus + cCount - 2, ty + 4.6, { align: 'right' });
    d.text('100%', tx + cStatus + cCount + cShare - 2, ty + 4.6, { align: 'right' });
    ty += 7;

    this.y = Math.max(this.y + size, ty) + 6;
  }

  /** Horizontal bars scaled to the largest value. */
  hbars(title, note, rows, labelKey = 'label', valueKey = 'count', limit = 8) {
    const items = (rows || []).slice(0, limit);
    if (!items.length) return;
    this.section(title, note, items.length * 6.4 + 5);
    const d = this.doc;
    const max = Math.max(1, ...items.map(r => Number(r[valueKey]) || 0));
    const labelW = 50, valueW = 16;
    const trackX = M + labelW, trackW = CW - labelW - valueW;
    items.forEach((r, i) => {
      const yy = this.y + i * 6.4;
      this.font('normal', 7.5, C.body).text(trim(d, String(r[labelKey]), labelW - 3), M, yy + 2.8);
      d.setFillColor(...C.line);
      d.roundedRect(trackX, yy, trackW, 3.6, 1.8, 1.8, 'F');
      const w = Math.max(1.6, (Number(r[valueKey]) / max) * trackW);
      d.setFillColor(...SERIES[i % SERIES.length]);
      d.roundedRect(trackX, yy, w, 3.6, 1.8, 1.8, 'F');
      this.font('bold', 7.5, C.ink).text(int(r[valueKey]), M + CW, yy + 2.8, { align: 'right' });
    });
    this.y += items.length * 6.4 + 5;
  }

  /**
   * Table. `cols` = [{ head, key, w, align, bar, fmt }]; a `bar` column renders
   * its 0-100 value as a filled track. `totals` adds a bold summary row, as on
   * the Team Lead Performance screen.
   */
  table(cols, rows, { totals, empty = 'No data in this range.' } = {}) {
    const d = this.doc;
    if (!rows || !rows.length) {
      this.font('normal', 8, C.muted).text(empty, M, this.y + 3);
      this.y += 9;
      return;
    }
    const drawHead = () => {
      d.setFillColor(...C.head);
      d.rect(M, this.y, CW, 7, 'F');
      this.font('bold', 7.5, C.body);
      let x = M;
      cols.forEach(c => {
        const right = c.align === 'right';
        d.text(c.head, right ? x + c.w - 2 : x + 2, this.y + 4.8, { align: right ? 'right' : 'left' });
        x += c.w;
      });
      this.y += 7;
    };
    this.need(22);
    drawHead();

    const cell = (c, v, r, yy, bold) => {
      if (c.bar) {
        const trackW = c.w - 16, p = Math.max(0, Math.min(100, Number(v) || 0));
        d.setFillColor(...C.line);
        d.roundedRect(M + colX(cols, c) + 2, yy + 2.1, trackW, 2.6, 1.3, 1.3, 'F');
        d.setFillColor(...(p >= 50 ? C.green : p >= 20 ? C.amber : C.pink));
        d.roundedRect(M + colX(cols, c) + 2, yy + 2.1, Math.max(0.6, (p / 100) * trackW), 2.6, 1.3, 1.3, 'F');
        this.font('bold', 6.8, C.body)
          .text(`${p}%`, M + colX(cols, c) + c.w - 2, yy + 4.6, { align: 'right' });
      } else {
        this.font(bold ? 'bold' : 'normal', 7.5, bold ? C.navy : C.body);
        const txt = trim(d, String(c.fmt ? c.fmt(v, r) : (v == null ? '' : v)), c.w - 4);
        const right = c.align === 'right';
        d.text(txt, M + colX(cols, c) + (right ? c.w - 2 : 2), yy + 4.4, { align: right ? 'right' : 'left' });
      }
    };

    rows.forEach((r, i) => {
      if (this.y + 6.6 > FOOT_LIMIT) { d.addPage(); this.y = TOP; drawHead(); }
      if (i % 2 === 1) { d.setFillColor(...C.zebra); d.rect(M, this.y, CW, 6.6, 'F'); }
      cols.forEach(c => cell(c, r[c.key], r, this.y, false));
      d.setDrawColor(...C.line).setLineWidth(0.15);
      d.line(M, this.y + 6.6, M + CW, this.y + 6.6);
      this.y += 6.6;
    });

    if (totals) {
      if (this.y + 8 > FOOT_LIMIT) { d.addPage(); this.y = TOP; drawHead(); }
      d.setDrawColor(...C.navy).setLineWidth(0.4);
      d.line(M, this.y, M + CW, this.y);
      cols.forEach(c => cell(c, totals[c.key], totals, this.y + 0.6, true));
      this.y += 8.5;
    }
    this.y += 5;
  }

  /** Small print under a table, explaining what each column counts. */
  note(text) {
    this.need(8);
    this.font('normal', 6.6, C.muted);
    const lines = this.doc.splitTextToSize(text, CW);
    this.doc.text(lines, M, this.y + 2);
    this.y += lines.length * 3 + 5;
  }

  // Columns shared by the ranged employee table and the all-time team table, so
  // both read exactly like the Team Lead Performance screen.
  personColumns() {
    return [
      { head: 'Member',   key: 'name',    w: 48 },
      { head: 'Role',     key: 'role',    w: 30, fmt: role },
      { head: 'Created',  key: 'created', w: 18, align: 'right', fmt: int },
      { head: 'Owned',    key: 'owned',   w: 18, align: 'right', fmt: int },
      { head: 'Handling', key: 'handled', w: 20, align: 'right', fmt: int },
      { head: 'Won',      key: 'won',     w: 16, align: 'right', fmt: int },
      { head: 'Conv %',   key: 'rate',    w: CW - 150, bar: true },
    ];
  }

  /**
   * Team performance — ONE per-person section, not two. An "employee handling"
   * table and a "team performance" table were the same people measured the same
   * way, so they are merged into the Team Lead Performance screen's own detail
   * (created / owned / handling / won / conv%), fed by /analytics/team-performance
   * called with the page's range — so every figure here covers the selected
   * window only, exactly like the KPIs above it.
   *
   * Who appears is the backend's decision, not this file's: the acting user's
   * reporting subtree — themselves and everyone below them, never their own
   * manager and never a peer — or every active user for a top-level role.
   */
  teamPerformance() {
    const src = (this.team && this.team.members) || [];
    // The screen's field is `assigned`; the report calls it `handled` everywhere.
    const rows = src.map(m => ({ ...m, handled: m.assigned, rate: m.conversionRate }));
    const t = this.team || {};
    const window = t.allTime ? 'All time' : (t.from ? `${t.from} to ${t.to}` : 'Selected range');

    this.section('Team Performance',
      `${window}  -  ${SCOPE_TEXT[t.scope] || 'scope not reported'}`, 34);
    this.table(this.personColumns(), rows, {
      totals: rows.length ? sumPeople(rows, 'handled', 'won') : null,
      empty: 'No team members visible at your access level.',
    });
    this.note('Created = who entered the lead. Owned = lead owner field. Handling = assigned to OR closed '
      + 'by this user. Won = closed by this user (or assigned to them if no closer is recorded). '
      + 'Conv % = Won / Handling. Everyone in your reporting line is listed, including anyone with no '
      + 'activity in this range.');

    if (rows.length) {
      const top = [...rows].sort((a, b) => b.won - a.won).slice(0, 8)
        .filter(m => m.won > 0)
        .map(m => ({ label: m.name, count: m.won }));
      if (top.length) this.hbars('Wins by team member', 'Top 8 in the selected range', top);
    }
  }

  build() {
    this.titleBlock();
    this.kpis();
    this.trendChart();
    this.statusBreakdown();
    this.hbars('Lead Sources', 'Top channels in the range', this.data.bySource);
    this.teamPerformance();
    this.stampChrome();
    return this.doc;
  }
}

/** Totals row matching the Team Lead Performance footer. */
function sumPeople(rows, handledKey, wonKey) {
  const t = rows.reduce((acc, r) => ({
    created: acc.created + (Number(r.created) || 0),
    owned:   acc.owned   + (Number(r.owned) || 0),
    handled: acc.handled + (Number(r[handledKey]) || 0),
    won:     acc.won     + (Number(r[wonKey]) || 0),
  }), { created: 0, owned: 0, handled: 0, won: 0 });
  return {
    name: 'Total', role: '', ...t,
    rate: t.handled === 0 ? 0 : Math.round((t.won / t.handled) * 1000) / 10,
  };
}

/** x offset of a column within the table, in mm from the left margin. */
function colX(cols, col) {
  let x = 0;
  for (const c of cols) { if (c === col) break; x += c.w; }
  return x;
}

/** A 1/2/5 x 10^n step that keeps the y-axis to roughly 4-6 gridlines. */
function niceStep(max) {
  const raw = max / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

/** Truncate to fit `w` mm, with an ellipsis, using the doc's current font. */
function trim(d, text, w) {
  if (d.getTextWidth(text) <= w) return text;
  let t = text;
  while (t.length > 1 && d.getTextWidth(t + '...') > w) t = t.slice(0, -1);
  return t + '...';
}

/** Load assets, build the report and save it. */
export async function downloadAnalyticsReport({ data, team, user, rangeLabel }) {
  const report = new AnalyticsReport({ data, team, user, rangeLabel });
  await report.loadAssets();
  report.build();
  const stamp = new Date().toISOString().slice(0, 10);
  report.doc.save(`lead-analytics-${data.from}_to_${data.to}-${stamp}.pdf`);
}
