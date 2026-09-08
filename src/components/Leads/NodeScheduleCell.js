// ─────────────────────────────────────────────────────────────────────────────
//  NodeScheduleCell — the schedule controls for ONE scope node.
//
//  Shared by the project Scope/Plan tab and the lead Technical Scope tab. It is a
//  separate component rather than part of ScopeTreeEditor because scheduling is not
//  universal: a TEMPLATE has no calendar of its own, so the templates admin screen
//  renders the same tree with no schedule at all. The editor therefore stays
//  schedule-free and each host passes this in through its `renderExtra`.
//
//  It is shared rather than copied per screen because copying is exactly what this
//  whole area was cleaned up to stop — three hand-maintained copies of one table had
//  already drifted to two different weight tolerances.
//
//  THREE SHAPES, decided by what the node is. This is the whole feature:
//
//   • A node WITH CHILDREN gets its own start/end dates plus a Weekly/Monthly
//     choice. That span becomes the period grid everything beneath it is placed on,
//     so breaking one branch down further never disturbs another branch's calendar.
//   • A node with NO children sitting on a parent's grid picks a FROM/TO period from
//     that grid, with the real dates shown beside it — "W3" alone tells a site
//     engineer nothing.
//   • A node with no children and no grid above it falls back to plain date pickers,
//     which is all this screen ever offered.
//
//  Bounded by the grid it sits on (min/max), and an end can never precede its start:
//  the constraint pattern the old flat sub-item row used, but relative to the PARENT
//  NODE rather than always to the whole project.
// ─────────────────────────────────────────────────────────────────────────────
import React from "react";
import { bucketLabel, bucketRange, nodeGrid } from "../../utils/scopeSchedule.js";
import "./NodeScheduleCell.css";

/**
 * @param node    the scope node
 * @param hasKids whether it has children (decides shape 1 vs 2/3)
 * @param grid    the grid it is placed ON — its parent's, or the project's; null when
 *                nothing above it is scheduled
 * @param write   (key, value) => void, writes one field on this node
 * @param cls     CSS prefix for the host page ("obd" or "lts") — the two screens own
 *                different namespaces and must not borrow each other's input styles
 * @param disabled read-only mode
 */
export default function NodeScheduleCell({
  node, hasKids, grid, write, cls = "obd", disabled = false,
}) {
  const inp = `${cls}-inp ${cls}-inp--sm`;
  // A dedicated class rather than the host's own "faint" text (${cls}-cell-faint)
  // — that one is styled near-invisible-light for decorative hints, but a
  // resolved date range or a duration is information the user reads to confirm
  // their schedule, not a hint. Styled once in NodeScheduleCell.css.
  const faint = "sched-faint";

  // ── Shape 1: a parent defines its own period grid ──────────────────────────
  if (hasKids) {
    const own = nodeGrid(node);
    const unit = node.planUnit === "MONTH" ? "MONTH" : "WEEK";
    return (
      <span className="sched-cell" title="This item's own span — its breakdown is scheduled inside it">
        <input type="date" className={inp} value={node.plannedStartDate || ""} disabled={disabled}
          min={grid ? grid.start : undefined} max={grid ? grid.end : undefined}
          onChange={(e) => write("plannedStartDate", e.target.value)} />
        <input type="date" className={inp} value={node.plannedEndDate || ""} disabled={disabled}
          min={node.plannedStartDate || (grid ? grid.start : undefined)}
          max={grid ? grid.end : undefined}
          onChange={(e) => write("plannedEndDate", e.target.value)} />
        {!disabled && (
          <span className="sched-unit">
            <button type="button" className={unit === "WEEK" ? "active" : ""}
              title="Break this item's span into WEEKS for the items under it"
              onClick={() => write("planUnit", "WEEK")}>W</button>
            <button type="button" className={unit === "MONTH" ? "active" : ""}
              title="Break this item's span into MONTHS for the items under it"
              onClick={() => write("planUnit", "MONTH")}>M</button>
          </span>
        )}
        <span className={faint}>
          {own ? `${own.count} ${own.unit === "MONTH" ? "month(s)" : "week(s)"}` : "set dates"}
        </span>
      </span>
    );
  }

  // ── Shape 2: a leaf on a grid is scheduled by PERIOD ───────────────────────
  if (grid) {
    const opts = Array.from({ length: grid.count }).map((_, b) => (
      <option key={b} value={b + 1}>
        {(grid.unit === "MONTH" ? "M" : "W")}{b + 1} · {bucketLabel(grid.start, b, grid.unit)}
      </option>
    ));
    const sw = Number(node.startWeek) || 0;
    const ew = Number(node.endWeek) || 0;
    const span = sw > 0 ? {
      start: bucketRange(grid.start, sw - 1, grid.unit).start,
      end: bucketRange(grid.start, (ew > 0 ? ew : sw) - 1, grid.unit).end,
    } : null;
    return (
      <span className="sched-cell" title="Which period of its parent this item runs in">
        <select className={inp} value={sw || ""} disabled={disabled}
          onChange={(e) => write("startWeek", e.target.value)}>
          <option value="">—</option>{opts}
        </select>
        <select className={inp} value={ew || ""} disabled={disabled}
          onChange={(e) => write("endWeek", e.target.value)}>
          <option value="">—</option>{opts}
        </select>
        {/* The resolved real dates: a period number on its own is not something
            anyone can act on, and the mapping depends on the parent's unit. */}
        <span className={faint}>{span ? `${span.start} → ${span.end}` : "—"}</span>
      </span>
    );
  }

  // ── Shape 3: nothing scheduled above it — plain dates ──────────────────────
  return (
    <span className="sched-cell" title="Start and end date for this item">
      <input type="date" className={inp} value={node.startDate || ""} disabled={disabled}
        onChange={(e) => write("startDate", e.target.value)} />
      <input type="date" className={inp} value={node.endDate || ""} disabled={disabled}
        min={node.startDate || undefined}
        onChange={(e) => write("endDate", e.target.value)} />
    </span>
  );
}
