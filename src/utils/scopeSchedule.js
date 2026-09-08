// ─────────────────────────────────────────────────────────────────────────────
//  scopeSchedule — WHEN each node of a scope tree happens.
//
//  A node's schedule works the way the project header always has, but PER NODE:
//  a node that has a span and a unit defines a grid of week or month PERIODS, and
//  its children are scheduled against those periods rather than by typing raw
//  dates. A leaf, having no grid of its own, takes direct dates.
//
//  Split out of scopeTree.js (which owns the SHAPE of the tree — nesting, weights,
//  identity) so neither file has to grow past being readable. The one thing it
//  borrows from there is namedNodes, because an unnamed half-typed row is not work
//  and must not be scheduled or validated.
//
//  parseDate / bucketCount / bucketLabel / bucketToISODate were MOVED here from
//  components/projects/orderBookTabsPorted.js, where they sat at module scope. The
//  lead scope tab needs the same arithmetic and must not import from the project
//  screen's hand-maintained port, so this is now the one home for them; that file
//  imports them back and its SANCTIONED DIVERGENCES header records the move.
//
//  BUCKET NUMBERING: 0-based in these functions, 1-based in component state. That
//  is the convention the project screen already uses (`b + 1` when rendering an
//  option, `bucket - 1` when reading one), and keeping it avoids re-basing every
//  existing call site.
// ─────────────────────────────────────────────────────────────────────────────
import { namedNodes } from "./scopeTree.js";

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * Tolerant date parser: accepts ISO (yyyy-mm-dd — what `<input type="date">` emits
 * and what the backend's LocalDate serialises to) and dd-mm-yyyy / dd/mm/yyyy, which
 * earlier display layers may have written. Returns a Date, or null.
 */
export const parseDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  const str = String(v).trim();
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) { const d = new Date(+m[1], +m[2] - 1, +m[3]); return isNaN(d) ? null : d; }
  m = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) { const d = new Date(+m[3], +m[2] - 1, +m[1]); return isNaN(d) ? null : d; }
  const d = new Date(str);
  return isNaN(d) ? null : d;
};

/** A Date as yyyy-mm-dd — the only format written back to state or to the API. */
export const toISO = (d) => {
  if (!d || isNaN(d)) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
};

/**
 * How many periods a span covers. Returns 0 when the dates are missing or inverted —
 * callers read 0 as "not set" rather than showing a misleading default.
 */
export const bucketCount = (startStr, endStr, unit) => {
  const s = parseDate(startStr), e = parseDate(endStr);
  if (!s || !e || e < s) return 0;
  if (unit === "MONTH") {
    return Math.max(1, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1);
  }
  const days = Math.round((e - s) / DAY_MS);
  return Math.max(1, Math.ceil((days + 1) / 7));
};

/** Label for 0-based period n: weekly "10 Jun", monthly "Jun 2026". */
export const bucketLabel = (startStr, n, unit) => {
  const s = parseDate(startStr);
  if (!s) return unit === "MONTH" ? `M${n + 1}` : `W${n + 1}`;
  if (unit === "MONTH") {
    const d = new Date(s.getFullYear(), s.getMonth() + n, 1);
    return `${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`;
  }
  const d = new Date(s); d.setDate(d.getDate() + n * 7);
  return `${d.getDate()} ${MONTH_ABBR[d.getMonth()]}`;
};

/** ISO date of the START of 0-based period n. Monthly deliberately snaps to the 1st. */
export const bucketToISODate = (startStr, n, unit) => {
  const s = parseDate(startStr);
  if (!s || n == null || n < 0) return "";
  const d = unit === "MONTH"
    ? new Date(s.getFullYear(), s.getMonth() + n, 1)
    : (() => { const x = new Date(s); x.setDate(x.getDate() + n * 7); return x; })();
  return toISO(d);
};

/**
 * The full `{ start, end }` ISO span of 0-based period n.
 *
 * New. bucketLabel and bucketToISODate both give only a period's START, so
 * "W1 (01 Apr – 07 Apr)" could not be rendered at all. A monthly period ends on the
 * last day of its month; a weekly one six days after it begins.
 */
export const bucketRange = (startStr, n, unit) => {
  const s = parseDate(startStr);
  if (!s || n == null || n < 0) return { start: "", end: "" };
  if (unit === "MONTH") {
    const a = new Date(s.getFullYear(), s.getMonth() + n, 1);
    const b = new Date(s.getFullYear(), s.getMonth() + n + 1, 0); // day 0 = last of prev month
    return { start: toISO(a), end: toISO(b) };
  }
  const a = new Date(s); a.setDate(a.getDate() + n * 7);
  const b = new Date(a); b.setDate(b.getDate() + 6);
  return { start: toISO(a), end: toISO(b) };
};

/**
 * Which 0-based period a date falls in, on the grid anchored at `gridStart`.
 *
 * The deliberate inverse of {@link bucketToISODate}, and genuinely new: nothing in
 * this system could previously turn a date into a period, which is exactly why a
 * sub-item's typed dates never moved its Gantt bar or its weekly progress range.
 *
 * NOT a mathematical inverse in the monthly case — bucketToISODate snaps to the 1st,
 * so every day within a month maps back to that month's period. That asymmetry is
 * intended, and the round-trip test pins it.
 *
 * Returns null for an unparseable date, or one before the grid starts — never 0,
 * which would silently drop stray work into the first period.
 */
export const dateToBucket = (gridStart, dateStr, unit) => {
  const s = parseDate(gridStart), d = parseDate(dateStr);
  if (!s || !d || d < s) return null;
  if (unit === "MONTH") {
    return (d.getFullYear() - s.getFullYear()) * 12 + (d.getMonth() - s.getMonth());
  }
  return Math.floor(Math.round((d - s) / DAY_MS) / 7);
};

/** A node defines a grid only when it has both ends of a span. */
export const nodeGrid = (node) => {
  if (!node) return null;
  const start = node.plannedStartDate || "";
  const end = node.plannedEndDate || "";
  const unit = node.planUnit === "MONTH" ? "MONTH" : "WEEK";
  const count = bucketCount(start, end, unit);
  return count > 0 ? { start, end, unit, count } : null;
};

/** 1-based period of a date on this grid, clamped into it; null when unresolvable. */
const bucketOf = (grid, dateStr) => {
  if (!grid) return null;
  const n = dateToBucket(grid.start, dateStr, grid.unit);
  if (n == null) return null;
  return Math.min(grid.count, Math.max(1, n + 1));
};

/**
 * Resolve one node's real `{ startDate, endDate, startWeek, endWeek, derived }`.
 *
 * The single place those four fields are reconciled, so the editor, the save, the
 * Gantt and the export cannot disagree about when a node happens.
 *
 * @param node the node
 * @param grid the grid it is scheduled ON — its parent's, or the project's
 * @param kids its already-resolved children, for a parent's derived span
 */
export function resolveNodeSchedule(node, grid, kids) {
  // A parent IS the span of its children — the roll-up of what sits under it,
  // exactly as its progress and its budget are. A typed span on a parent defines
  // the GRID its children are placed on; it does not override when they happen.
  if (kids && kids.length) {
    const starts = kids.map((k) => k.startDate).filter(Boolean).sort();
    const ends = kids.map((k) => k.endDate).filter(Boolean).sort();
    if (starts.length || ends.length) {
      const startDate = starts[0] || "";
      const endDate = ends[ends.length - 1] || "";
      return {
        startDate,
        endDate,
        startWeek: bucketOf(grid, startDate),
        endWeek: bucketOf(grid, endDate),
        derived: true,
      };
    }
  }

  // A leaf's own dates win, and now DRIVE its period range. Until this change they
  // were stored, shown and exported but read by nothing at all.
  if (node.startDate || node.endDate) {
    return {
      startDate: node.startDate || "",
      endDate: node.endDate || "",
      startWeek: bucketOf(grid, node.startDate),
      endWeek: bucketOf(grid, node.endDate),
      derived: false,
    };
  }

  // Otherwise it is scheduled by PERIOD against its parent's grid.
  const sw = Number(node.startWeek), ew = Number(node.endWeek);
  if (grid && sw > 0) {
    const a = bucketRange(grid.start, sw - 1, grid.unit);
    const b = bucketRange(grid.start, (ew > 0 ? ew : sw) - 1, grid.unit);
    return {
      startDate: a.start, endDate: b.end,
      startWeek: sw, endWeek: ew > 0 ? ew : sw,
      derived: false,
    };
  }

  return { startDate: "", endDate: "", startWeek: null, endWeek: null, derived: false };
}

/**
 * Resolve a whole tree, returning `{ [nodeId]: schedule }`.
 *
 * Bottom-up, because a parent's span is derived from its children's and those
 * children may be parents themselves — the same shape as the progress roll-up. A
 * node that defines its own grid becomes the grid for everything beneath it, which
 * is what makes a grandchild schedule against ITS parent rather than the phase.
 */
export function resolveTreeSchedule(nodes, grid, out = {}) {
  (nodes || []).forEach((n) => {
    const inner = nodeGrid(n) || grid;
    let kids = null;
    if ((n.children || []).length) {
      resolveTreeSchedule(n.children, inner, out);
      kids = n.children.map((c) => out[c.id]).filter(Boolean);
    }
    out[n.id] = resolveNodeSchedule(n, grid, kids);
  });
  return out;
}

/**
 * Validate the schedule through the tree, per parent, naming the branch.
 *
 * Mirrors validateTree's `Under "A › B": …` breadcrumb so a scheduling error reads
 * like a weight error. There was previously NO date validation anywhere — the old
 * inputs' min/max were browser-level only, so an end-before-start could be saved
 * silently, and a sub-item outside its phase entirely was never questioned.
 */
export function validateSchedule(nodes, grid, pathLabel = "") {
  for (const n of namedNodes(nodes)) {
    const label = pathLabel ? `${pathLabel} › ${n.name}` : n.name;
    const s = parseDate(n.startDate), e = parseDate(n.endDate);

    if (s && e && e < s) {
      return { ok: false, error: `"${label}" ends before it starts.` };
    }
    if (grid && (s || e)) {
      const gs = parseDate(grid.start), ge = parseDate(grid.end);
      if ((gs && s && s < gs) || (ge && e && e > ge)) {
        return {
          ok: false,
          error: `"${label}" falls outside ${pathLabel || "the plan"} `
            + `(${grid.start} to ${grid.end}).`,
        };
      }
    }

    const sw = Number(n.startWeek), ew = Number(n.endWeek);
    if (sw > 0 && ew > 0 && ew < sw) {
      return { ok: false, error: `"${label}" ends in an earlier period than it starts.` };
    }
    if (grid && sw > grid.count) {
      return {
        ok: false,
        error: `"${label}" starts in period ${sw}, but ${pathLabel || "the plan"} `
          + `only has ${grid.count}.`,
      };
    }

    const child = validateSchedule(n.children, nodeGrid(n) || grid, label);
    if (!child.ok) return child;
  }
  return { ok: true };
}
