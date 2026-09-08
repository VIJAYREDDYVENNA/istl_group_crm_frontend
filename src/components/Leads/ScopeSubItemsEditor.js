// ─────────────────────────────────────────────────────────────────────────────
//  ScopeSubItemsEditor — the second level under one scope line.
//
//  The same breakdown now lives on a template line, a lead's scope item and a
//  project phase. This is the editor for it, in its own `ssi-*` namespace with
//  its own stylesheet, so a page can drop it in without its table styles
//  colliding (see memory: ld-/custd- CSS namespace split).
//
//  THE WEIGHT RULE, and why it is not a second rule: a sub-item's weight is a
//  share of ITS OWN PARENT and the group totals 100 within that parent, never a
//  share of the whole scope. That keeps the parent weights the only thing that
//  has to add up across the scope, so breaking one activity down cannot disturb
//  the others. Pinning, rebalancing and the rounding tolerance all come from
//  utils/scopeWeights.js — the same helpers the parent rows use, one level down.
//
//  NAMES ARE IDENTITY. A sub-item has no id anywhere in this system: the planned
//  budget merge and project_progress_periods.sub_item_key both key off the raw
//  name string with an exact comparison. Renaming one therefore silently
//  detaches its budget and its weekly progress — which is why the name is picked
//  from the standardised list rather than typed freehand.
//
//  NOTE: Pages/LeadTemplatesAdmin.js carries its own copy of this table inline
//  (in the `lta-*` namespace, with the Excel import/export wired around it). It
//  predates this component and is left alone rather than migrated mid-feature;
//  if the sub-item model changes, change it in both places.
// ─────────────────────────────────────────────────────────────────────────────
import React from "react";
import { Plus, Trash2, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import UnitSelectCell from "../Dropdowns/UnitSelectCell.js";
import ActivityNameSelect from "./ActivityNameSelect.js";
import {
  distributeWeights, resetWeights, setWeightAt, validateWeights, weightSum, fmtWeight,
} from "../../utils/scopeWeights.js";
import "./ScopeSubItemsEditor.css";

/** A sub-item carries only what a scope can know — no status, progress or dates. */
export const blankSubItem = () => ({
  name: "", description: "", unit: "", weightPct: "", weightManual: false,
});

/** Rows with a real name — the only ones that are saved or counted. */
export const namedSubs = (subs) => (subs || []).filter((si) => (si.name || "").trim());

/** True when this line's breakdown is empty or adds up. */
export const subWeightsOk = (subs) => {
  const named = namedSubs(subs);
  return named.length === 0 || validateWeights(named, (si) => si.name).ok;
};

/**
 * Normalise a breakdown loaded from the server so it is safe to edit: rebalance
 * the unpinned rows, so a set saved before this editor existed still shows 100%.
 */
export const hydrateSubs = (raw) =>
  distributeWeights((raw || []).map((si) => ({
    ...blankSubItem(),
    name: si.name || "",
    description: si.description || "",
    unit: si.unit || "",
    weightPct: si.weightPct != null ? Number(si.weightPct) : "",
    weightManual: si.weightManual === true,
  })));

/** Editor payload → what the API stores. Unnamed rows are dropped. */
export const subsForSave = (subs) =>
  namedSubs(subs).map((si) => ({
    name: si.name.trim(),
    description: si.description || null,
    unit: si.unit || null,
    weightPct: si.weightPct === "" || si.weightPct == null ? null : Number(si.weightPct),
    weightManual: si.weightManual === true,
  }));

/**
 * The collapsed one-line summary. Rendered by the host inside its own row, so the
 * breakdown is findable when closed — otherwise a collapsed parent looks exactly
 * like one that was never broken down.
 */
export function SubItemsSummary({ subs, onExpand }) {
  const named = namedSubs(subs);
  if (!(subs || []).length) return null;
  const ok = subWeightsOk(subs);
  return (
    <div className="ssi-summary">
      <button type="button" className="ssi-linkish" onClick={onExpand}>
        {subs.length} sub-item{subs.length === 1 ? "" : "s"}
      </button>
      <span className="ssi-hint"> — {named.map((si) => si.name).join(", ") || "unnamed"}</span>
      {!ok && <span className="ssi-bad"> · weights total {fmtWeight(weightSum(named))}%</span>}
    </div>
  );
}

/** The expand/collapse control, so the host's row-number cell can carry it. */
export function SubItemsToggle({ open, count, onToggle }) {
  return (
    <button
      type="button" className="ssi-toggle" onClick={onToggle}
      title={open ? "Hide the breakdown" : count ? `Show ${count} sub-item(s)` : "Add a breakdown"}
    >
      {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
    </button>
  );
}

/**
 * @param subs        the breakdown array
 * @param onChange    (nextSubs) => void — always the whole array
 * @param parentName  shown in the heading and the sub-total, for orientation
 * @param options / register  from useActivityNames()
 * @param disabled    read-only mode (mirrors the host's canEdit)
 */
export default function ScopeSubItemsEditor({
  subs, onChange, parentName, options, register, disabled = false,
}) {
  const rows = subs || [];
  const total = weightSum(namedSubs(rows));
  const ok = subWeightsOk(rows);

  const add = () => onChange(distributeWeights([...rows, blankSubItem()]));
  const remove = (j) => onChange(distributeWeights(rows.filter((_, idx) => idx !== j)));
  const upd = (j, k, v) => onChange(rows.map((si, idx) => (idx === j ? { ...si, [k]: v } : si)));
  const setW = (j, raw) => onChange(setWeightAt(rows, j, raw));
  const reset = () => onChange(resetWeights(rows));

  return (
    <div className="ssi-wrap">
      <div className="ssi-head">
        <span className="ssi-hint">
          Sub-items under <b>{(parentName || "").trim() || "this activity"}</b> — each is a
          share of <b>this activity</b>, so they add up to 100% of it, not of the scope.
        </span>
        {!disabled && (
          <>
            <button type="button" className="ssi-btn ssi-right" onClick={reset}
              disabled={rows.length === 0}
              title="Unpin these sub-weights and split them evenly again">
              <RefreshCw size={12} /> Reset
            </button>
            <button type="button" className="ssi-btn" onClick={add}>
              <Plus size={12} /> Add sub-item
            </button>
          </>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="ssi-empty">
          No breakdown.{disabled ? "" : " “Add sub-item” to break this activity down."}
        </div>
      ) : (
        <table className="ssi-table">
          <thead>
            <tr>
              <th className="ssi-c-no" />
              <th>Sub-item</th>
              <th>Description</th>
              <th className="ssi-c-unit">Unit</th>
              <th className="ssi-c-weight">Weight %</th>
              {!disabled && <th className="ssi-c-act" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((si, j) => (
              <tr key={j}>
                <td className="ssi-c-no">{j + 1}</td>
                <td>
                  <ActivityNameSelect
                    className="ssi-inp" value={si.name}
                    onChange={(v) => upd(j, "name", v)}
                    options={options} register={register}
                    placeholder="Select sub-item…"
                  />
                </td>
                <td>
                  <input className="ssi-inp" value={si.description} disabled={disabled}
                    placeholder="Optional"
                    onChange={(e) => upd(j, "description", e.target.value)} />
                </td>
                <td className="ssi-c-unit">
                  <UnitSelectCell className="ssi-inp" value={si.unit}
                    onChange={(v) => upd(j, "unit", v)} />
                </td>
                <td className="ssi-c-weight">
                  <input
                    className={`ssi-inp ssi-inp--w${si.weightManual ? " ssi-pinned" : ""}`}
                    type="number" min="0" max="100" step="0.01" value={si.weightPct}
                    disabled={disabled}
                    onChange={(e) => setW(j, e.target.value)}
                    title={si.weightManual
                      ? "Set by you — this weight holds while the others rebalance around it."
                      : "Calculated automatically. Type a value to hold it."} />
                </td>
                {!disabled && (
                  <td className="ssi-c-act">
                    <button type="button" className="ssi-del" onClick={() => remove(j)}
                      title="Remove this sub-item">
                      <Trash2 size={13} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {rows.length > 0 && (
        <div className={`ssi-total${ok ? " ssi-total--ok" : " ssi-total--err"}`}>
          <span>Sub-total: <b>{fmtWeight(total)}%</b> of {(parentName || "").trim() || "this activity"}</span>
          <span className="ssi-hint">
            {ok ? "Adds up." : "Must add up to 100% of the activity before this can be saved."}
          </span>
        </div>
      )}
    </div>
  );
}
