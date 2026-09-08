// ─────────────────────────────────────────────────────────────────────────────
//  ScopeBreakdownModal — a scope line's breakdown, in its own dialog.
//
//  Replaces rendering the whole nested tree as extra <tr>s squeezed under a
//  table row (in the same table, at whatever indentation depth it reached) —
//  which is exactly what made the Work Breakdown & Schedule table and the lead
//  Technical Scope table look congested with anything past a shallow breakdown.
//  The tree itself is unchanged: this is only where it renders.
//
//  ONE modal, WHOLE tree inside — not a modal per level. A phase/activity's
//  entire nested breakdown (any depth) opens in a single dialog, using
//  ScopeTreeEditor's own existing chevron expand/collapse and indentation for
//  everything below the top. Drilling into a level-3 item never opens a second
//  modal on top of this one.
//
//  Modelled on the existing per-node "Weeks" modal in orderBookTabsPorted.js
//  (.obd-fv-overlay / .obd-week-modal) — the established in-repo pattern for a
//  CSS-class overlay (not inline styles) that opens per-node from a renderExtra
//  button and hosts a table with its own totals. Kept in its own `sbm-*`
//  namespace (ScopeBreakdownModal.css) rather than reusing obd-fv-* directly, so
//  a page that isn't `.obd-page` (the lead detail view) can use it without
//  pulling in OrderBookDetail.css.
//
//  No internal Save/Cancel: `onChange` writes straight into the host's row
//  state, exactly as it did when the tree rendered inline — the host's own
//  page-level Save button persists everything, unchanged. Closing this dialog
//  never discards an edit; it only hides it.
// ─────────────────────────────────────────────────────────────────────────────
import React from "react";
import ScopeTreeEditor, { treeWeightsOk } from "./ScopeTreeEditor.js";
import "./ScopeBreakdownModal.css";

/**
 * @param open        whether this dialog is showing
 * @param parentName  the scope line/phase name, shown in the header
 * @param subs        the breakdown tree for that line (array of nodes)
 * @param onChange    (nextTree) => void — same contract as ScopeTreeEditor's own
 * @param options / register  from useActivityNames(), passed straight through
 * @param disabled    read-only mode
 * @param renderExtra host-specific extra cells (progress/schedule/status),
 *                    passed straight through to ScopeTreeEditor unchanged
 * @param onClose     () => void
 */
export default function ScopeBreakdownModal({
  open, parentName, subs, onChange, options, register, disabled = false, renderExtra, onClose,
}) {
  if (!open) return null;
  const ok = treeWeightsOk(subs);
  const label = (parentName || "").trim() || "this item";

  return (
    <div className="sbm-overlay" onMouseDown={onClose}>
      <div className="sbm-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sbm-header">
          <div className="sbm-title">
            Breakdown <span className="sbm-title-sep">·</span> <b>{label}</b>
            {!ok && <span className="sbm-bad">weights don’t add up</span>}
          </div>
          <button type="button" className="sbm-close" onClick={onClose} title="Close">×</button>
        </div>
        <div className="sbm-body">
          <ScopeTreeEditor
            subs={subs}
            onChange={onChange}
            parentName={parentName}
            options={options}
            register={register}
            disabled={disabled}
            renderExtra={renderExtra}
          />
        </div>
        <div className="sbm-footer">
          <button type="button" className="sbm-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
