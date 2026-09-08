// ─────────────────────────────────────────────────────────────────────────────
//  LeadTechnicalScopeTab — "Technical Scope" for a lead.
//
//  Step 1 of the estimation flow:  Scope → BOM → Budget Estimation.
//
//  • Section A: scope header (project type, capacity, site location, scope of
//    work, technical notes). Group / Sub-group shown read-only from the lead.
//    "Pull from site visit" fills location/capacity from the site visit report.
//  • Section B: the scope of work — WHICH activities we will do, chosen from a
//    dropdown, each optionally broken down into standardised sub-items.
//    Still deliberately NO dates, NO prices: scheduling belongs to the project
//    once the lead is won, materials belong to the BOM tab, and money belongs to
//    Budget Estimation.
//
//    Sub-items arrive from the active template via Suggest and are editable
//    afterwards. Their weights are a share of their OWN parent activity (100%
//    within it), never of the whole scope — see utils/scopeWeights.js. A
//    sub-item's NAME is its identity once the lead becomes a project (planned
//    budgets and weekly progress key off it), which is why names are picked from
//    the shared list rather than typed freehand.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useCallback } from "react";
import './LeadCardHead.css';
import {
  Wand2, Plus, Save, Trash2, Download, ClipboardList, ListChecks, CornerDownRight,
} from "lucide-react";
import api from "../../services/leadsapi.js";
import ConfirmationModal from "../ConfirmationModal.js";
import useConfirmationModal from "../HandleConfirmationModal.js";
import { useActivityNames } from "./ActivityNameSelect.js";
import ScopeSubItemsEditor, {
  SubItemsSummary, SubItemsToggle, hydrateSubs, subsForSave, namedSubs,
} from "./ScopeSubItemsEditor.js";
import { validateWeights } from "../../utils/scopeWeights.js";
import {
  DEFAULT_EPC_SCOPE, UNIT_SUGGESTIONS, OTHER_OPTION, SUGGESTION_WARNING_LABELS,
} from "../../constants/scopeActivities.js";
import "./LeadTechnicalScopeTab.css";

const emptyHeader = {
  projectType: "",
  systemCapacity: "",
  siteLocation: "",
  scopeOfWork: "",
  technicalNotes: "",
};

const blankRow = () => ({
  id: null, activity: "", specification: "", quantity: "", unit: "kW", customName: false,
  // Second-level breakdown. Empty = this activity is not broken down, the normal
  // case; sub-items are opt-in per line.
  subItems: [],
});

export default function LeadTechnicalScopeTab({ lead, currentUser, permissions, onRefreshLead, showSuccess, showError }) {
  const canEdit = permissions?.EDIT !== false;

  const [header, setHeader] = useState(emptyHeader);
  const [rows, setRows] = useState([]);
  // The shared, user-extensible activity list — one fetch, used by the parent rows
  // and by every sub-item editor below them.
  const { options: activityOptions, register: registerActivity } = useActivityNames();
  const [loading, setLoading] = useState(true);
  const [savingHeader, setSavingHeader] = useState(false);
  const [savingRows, setSavingRows] = useState(false);
  const [pullingVisit, setPullingVisit] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState(null); // {source, sourceCapacity, warnings}
  const [hasTemplate, setHasTemplate] = useState(false); // a template exists for this project type
  // Only a row the user just switched to "type your own" should autofocus —
  // focusing rows loaded from the backend scrolls the tab past its own top.
  const [focusRow, setFocusRow] = useState(null);

  const { confirmModal, showConfirmation } = useConfirmationModal();

  const groupName = lead?.groupName ?? lead?.group ?? "—";
  const subGroupName = lead?.subGroupName ?? lead?.subGroup ?? "—";

  const fail = (msg, e) => { if (!e || e.message !== "SESSION_EXPIRED") showError?.(msg); };

  // Read the lead's latest site visit report (the endpoint returns a list; a lead
  // has at most one). Used to pre-fill Site Location and System Capacity.
  const fetchSiteVisit = useCallback(async () => {
    try {
      const res = await api.get(`/site-visits/lead/${lead.id}`);
      return Array.isArray(res?.data) ? res.data[0] : null;
    } catch { return null; }
  }, [lead.id]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/leads/${lead.id}/scope`);
      if (res?.success) {
        const h = res.data?.header || {};
        let siteLocation = h.siteLocation ?? "";
        let systemCapacity = h.systemCapacity ?? "";

        // Auto-fill Site Location and System Capacity from the site visit report
        // when they haven't been set yet — a saved value always wins. Capacity is
        // taken from the site visit's sanctioned load.
        if (!siteLocation || !systemCapacity) {
          const v = await fetchSiteVisit();
          if (v) {
            if (!siteLocation) siteLocation = v.siteAddress || "";
            if (!systemCapacity) systemCapacity = v.sanctionedLoad || "";
          }
        }

        setHeader({
          // The sub-group IS the project type in this system (e.g. Solar_Rooftop),
          // so it's a sensible default — but a saved value always wins.
          projectType: h.projectType || lead?.subGroupName || "",
          systemCapacity,
          siteLocation,
          scopeOfWork: h.scopeOfWork ?? "",
          technicalNotes: h.technicalNotes ?? "",
        });
        setRows((res.data?.items || []).map(it => ({
          id: it.id,
          activity: it.activity || "",
          specification: it.specification || "",
          quantity: it.quantity ?? "",
          unit: it.unit || "",
          customName: false, // resolved against the dropdown at render time
          subItems: hydrateSubs(it.subItems),
        })));
      }
    } catch (e) {
      fail("Failed to load technical scope", e);
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, lead?.subGroupName, fetchSiteVisit]);

  useEffect(() => { load(); }, [load]);

  // Does a template exist for this lead's project type? Drives the Load button.
  useEffect(() => {
    api.get(`/leads/${lead.id}/scope/template-info`)
      .then(res => setHasTemplate(!!res?.data?.hasTemplate))
      .catch(() => {});
  }, [lead.id]);

  // ── Header ─────────────────────────────────────────────────────────────────
  const setH = k => e => setHeader(p => ({ ...p, [k]: e.target.value }));

  const saveHeader = async () => {
    if (!canEdit) return;
    setSavingHeader(true);
    try {
      const res = await api.post(`/leads/${lead.id}/scope`, {
        projectType: header.projectType.trim() || null,
        systemCapacity: header.systemCapacity.trim() || null,
        siteLocation: header.siteLocation.trim() || null,
        scopeOfWork: header.scopeOfWork.trim() || null,
        technicalNotes: header.technicalNotes.trim() || null,
      });
      if (res?.success) {
        showSuccess?.("Technical scope saved");
        onRefreshLead?.();
      } else {
        showError?.(res?.message || "Failed to save scope");
      }
    } catch (e) {
      fail("Failed to save scope", e);
    } finally { setSavingHeader(false); }
  };

  // Overwrite Site Location and System Capacity from the site visit report —
  // location from the site address, capacity from the sanctioned load. Unlike the
  // auto-fill on load (blanks only), this button refreshes even saved values.
  const pullFromSiteVisit = async () => {
    setPullingVisit(true);
    try {
      const v = await fetchSiteVisit();
      if (!v) { showError?.("No site visit report found for this lead."); return; }
      setHeader(p => ({
        ...p,
        siteLocation: v.siteAddress || p.siteLocation,
        systemCapacity: v.sanctionedLoad || p.systemCapacity,
        projectType: p.projectType || v.propertyType || "",
      }));
      showSuccess?.("Pulled Site Location and System Capacity from the site visit. Review, then Save Scope.");
    } catch (e) {
      fail("Failed to read the site visit report", e);
    } finally { setPullingVisit(false); }
  };

  // ── Scope rows ─────────────────────────────────────────────────────────────
  const updateRow = (i, field, val, extra) =>
    setRows(prev => prev.map((r, idx) => (idx === i ? { ...r, [field]: val, ...(extra || {}) } : r)));

  const addRow = () => setRows(prev => [...prev, blankRow()]);

  // Which rows have their breakdown open. UI-only, keyed by row index — the list
  // is only reordered by add/remove, which re-renders the whole table anyway.
  const [expanded, setExpanded] = useState({});
  const toggleExpanded = (i) => setExpanded(e => ({ ...e, [i]: !e[i] }));
  const setSubs = (i, next) => {
    updateRow(i, "subItems", next);
    if (next.length) setExpanded(e => ({ ...e, [i]: true }));
  };

  const removeRow = (i) => { setFocusRow(null); setRows(prev => prev.filter((_, idx) => idx !== i)); };

  // ── Re-suggest: fold the suggestion onto what is already there ──────────────
  //
  // A straight replace-all used to give every row id:null, so saving afterwards
  // soft-deleted every existing line and re-inserted it with a new id. Nothing on
  // a LEAD keyed off those ids, so that was survivable here — but the same rows
  // become project phases, where the ids and the sub-item NAMES are what planned
  // budgets and weekly progress hang off. Matching by name keeps a line that is
  // still in the standard attached to its own history.
  //
  // Matching is trim + lowercase, the same normalisation the backend's
  // ProjectLeadSeedService.activityKey uses. The STORED spelling is kept on a
  // match: downstream lookups compare names with an exact equals, so silently
  // recasing one would detach it.
  const nameKey = (v) => (v || "").trim().toLowerCase();

  const mergeSuggested = (incoming) => {
    const byKey = new Map();
    rows.forEach((r) => {
      const k = nameKey(r.activity);
      if (k && !byKey.has(k)) byKey.set(k, r); // first wins, as on the server
    });
    return incoming.map((it) => {
      const prior = byKey.get(nameKey(it.activity));
      if (!prior) return it;
      return {
        ...it,
        // Keep this line's identity and the values the user already typed; the
        // suggestion only fills what it actually carries.
        id: prior.id,
        activity: prior.activity,
        specification: it.specification || prior.specification,
        quantity: prior.quantity !== "" && prior.quantity != null ? prior.quantity : it.quantity,
        unit: prior.unit || it.unit,
        subItems: mergeSubs(prior.subItems, it.subItems),
      };
    });
  };

  // Same rule one level down, mirroring the server's ScopeSubItems.merge…().
  const mergeSubs = (prior, incoming) => {
    const inc = incoming || [];
    if (!inc.length) return [];
    const byKey = new Map();
    (prior || []).forEach((si) => {
      const k = nameKey(si.name);
      if (k && !byKey.has(k)) byKey.set(k, si);
    });
    return hydrateSubs(inc.map((si) => {
      const was = byKey.get(nameKey(si.name));
      return was ? { ...si, name: was.name, description: si.description || was.description } : si;
    }));
  };

  const suggestEpcScope = async () => {
    if (rows.length) {
      const ok = await showConfirmation({
        title: "Replace scope", type: "alert",
        message: "This replaces the current scope lines with the standard EPC scope. Continue?",
        confirmText: "Yes, Replace", cancelText: "Cancel",
      });
      if (!ok) return;
    }
    setRows(DEFAULT_EPC_SCOPE.map(name => ({ ...blankRow(), activity: name })));
  };

  // Suggest a scope from the project type + capacity. A curated template wins;
  // else a similar past job. Pre-fills the editable rows — user reviews and saves.
  const suggestScope = async () => {
    if (rows.length) {
      const ok = await showConfirmation({
        title: "Replace scope", type: "alert",
        message: "This replaces the current scope lines with a suggestion from this project type and capacity. "
          + "Activities and sub-items whose names still match are kept, along with anything already filled in against them. Continue?",
        confirmText: "Yes, Suggest", cancelText: "Cancel",
      });
      if (!ok) return;
    }
    setSuggesting(true);
    try {
      const res = await api.get(`/leads/${lead.id}/scope/suggest`, { params: { target: "scope" } });
      if (!res?.success) { showError?.(res?.message || "Failed to suggest scope"); return; }
      const d = res.data || {};
      const items = Array.isArray(d.scopeItems) ? d.scopeItems : [];
      if (!items.length && d.source === "NONE") {
        setSuggestNote({ source: "NONE", warnings: d.warnings || [] });
        showError?.("No template or similar past job for this project type yet.");
        return;
      }
      setRows(mergeSuggested(items.map(it => ({
        ...blankRow(),
        activity: it.activity || "",
        specification: it.specification || "",
        quantity: it.quantity ?? "",
        unit: it.unit || "",
        subItems: hydrateSubs(it.subItems),
      }))));
      setSuggestNote({ source: d.source, sourceCapacity: d.sourceCapacity, warnings: d.warnings || [] });
      showSuccess?.(
        d.source === "MINED"
          ? `Suggested from a similar ${d.sourceCapacity || ""} job. Review and save.`
          : "Suggested from the standard template. Review and save."
      );
    } catch (e) {
      fail("Failed to suggest scope", e);
    } finally { setSuggesting(false); }
  };

  const saveRows = async () => {
    if (!canEdit) return;
    for (const r of rows) {
      if (!(r.activity || "").trim()) { showError?.("Every scope line needs an activity"); return; }
      // Each breakdown is its own 100%, checked per parent so the message can name
      // the activity to go and fix. Re-checked server-side.
      const named = namedSubs(r.subItems);
      if (named.length) {
        const check = validateWeights(named, (si) => si.name.trim());
        if (!check.ok) {
          showError?.(`Under "${r.activity.trim()}": ${check.error.replace(/^Scope weights/, "Sub-item weights")}`);
          return;
        }
      }
    }
    setSavingRows(true);
    try {
      const res = await api.put(`/leads/${lead.id}/scope/items`, {
        items: rows.map((r, i) => ({
          id: r.id ?? null,
          seqNo: i + 1,
          activity: r.activity.trim(),
          specification: (r.specification || "").trim() || null,
          quantity: r.quantity === "" || r.quantity == null ? null : Number(r.quantity),
          unit: (r.unit || "").trim() || null,
          subItems: subsForSave(r.subItems),
        })),
      });
      if (res?.success) {
        showSuccess?.("Scope of work saved");
        await load();
        onRefreshLead?.();
      } else {
        showError?.(res?.message || "Failed to save scope of work");
      }
    } catch (e) {
      fail("Failed to save scope of work", e);
    } finally { setSavingRows(false); }
  };

  if (loading) return <div className="lts-loading"><span className="lts-spinner" /> Loading…</div>;

  return (
    <div className="lts">
      <ConfirmationModal {...confirmModal} />

      {/* ── Section A: Scope header ─────────────────────────────────────────── */}
      <div className="lts-card">
        <div className="lts-card-head">
          <span className="lead-card-ico"><ClipboardList size={17} strokeWidth={2} /></span><h4 className="lts-card-title">Scope Overview</h4>
          {canEdit && (
            <button className="lts-btn-ghost" onClick={pullFromSiteVisit} disabled={pullingVisit}
              title="Fill location and capacity from this lead's site visit report">
              <Download size={13} /> {pullingVisit ? "Pulling…" : "Pull from site visit"}
            </button>
          )}
          <span className="lts-flow-badge">↳ Flows to proposal</span>
        </div>

        <div className="lts-grid">
          <label className="lts-field">
            <span>Project Type</span>
            <input value={header.projectType} onChange={setH("projectType")} disabled={!canEdit}
              placeholder="e.g. Rooftop Solar / Ground Mount" />
          </label>
          <label className="lts-field">
            <span>System Capacity</span>
            <input value={header.systemCapacity} onChange={setH("systemCapacity")} disabled={!canEdit}
              placeholder="e.g. 100 kW (from sanctioned load)" />
          </label>
          <label className="lts-field">
            <span>Site Location</span>
            <input value={header.siteLocation} onChange={setH("siteLocation")} disabled={!canEdit}
              placeholder="e.g. Plant-2, Hyderabad" />
          </label>
          <div className="lts-ro"><span>Group</span><b>{groupName}</b></div>
          <div className="lts-ro"><span>Sub-group</span><b>{subGroupName}</b></div>
        </div>

        <label className="lts-field lts-field--full">
          <span>Scope of Work</span>
          <textarea rows={4} value={header.scopeOfWork} onChange={setH("scopeOfWork")} disabled={!canEdit}
            placeholder="Describe the overall scope of work for this project…" />
        </label>

        <label className="lts-field lts-field--full">
          <span>Technical Notes / Exclusions</span>
          <textarea rows={3} value={header.technicalNotes} onChange={setH("technicalNotes")} disabled={!canEdit}
            placeholder="Assumptions, exclusions, special technical notes…" />
        </label>

        {canEdit && (
          <div className="lts-card-foot">
            <button className="lts-btn-primary" onClick={saveHeader} disabled={savingHeader}>
              {savingHeader ? "Saving…" : "Save Scope"}
            </button>
          </div>
        )}
      </div>

      {/* ── Section B: Scope of work ────────────────────────────────────────── */}
      <div className="lts-card">
        <div className="lts-card-head">
          <span className="lead-card-ico"><ListChecks size={17} strokeWidth={2} /></span><h4 className="lts-card-title">Scope of Work</h4>
          <span className="lts-count-pill">{rows.length}</span>
          {canEdit && (
            <div className="lts-head-actions">
              {hasTemplate ? (
                // A template exists for this project type → load it (the standard).
                <button className="lts-btn-ghost lts-btn-accent" onClick={suggestScope} disabled={suggesting}
                  title="Load the standard scope template for this project type">
                  <Wand2 size={13} /> {suggesting ? "Loading…" : "Load template"}
                </button>
              ) : (
                <>
                  <button className="lts-btn-ghost" onClick={suggestScope} disabled={suggesting}
                    title="Suggest a scope from a similar past job of this project type">
                    <Wand2 size={13} /> {suggesting ? "Suggesting…" : "Suggest scope"}
                  </button>
                  <button className="lts-btn-ghost" onClick={suggestEpcScope}
                    title="Fill with the standard EPC activity list">
                    <Wand2 size={13} /> Standard EPC
                  </button>
                </>
              )}
              <button className="lts-btn-ghost" onClick={addRow}><Plus size={13} /> Add row</button>
            </div>
          )}
        </div>

        {suggestNote && suggestNote.source && suggestNote.source !== "NONE" && (
          <div className="lts-suggest-note">
            {suggestNote.source === "MINED"
              ? `Suggested from a similar ${suggestNote.sourceCapacity || ""} job — review before saving.`
              : "Suggested from the standard template — review before saving."}
          </div>
        )}
        {suggestNote?.warnings?.length > 0 && (
          <div className="lts-suggest-warn">
            {suggestNote.warnings.map((w, i) => (
              <div key={i}>⚠ {SUGGESTION_WARNING_LABELS[w.code] || w.message}</div>
            ))}
          </div>
        )}

        <div className="lts-table-wrap">
          <table className="lts-table">
            <thead>
              <tr>
                <th className="lts-col-num">#</th>
                <th>Activity / Item</th>
                <th>Description</th>
                <th className="lts-col-qty">Qty</th>
                <th className="lts-col-unit">Unit</th>
                {canEdit && <th className="lts-col-act" />}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 6 : 5} className="lts-empty">
                    No scope lines yet. Use "Suggest EPC scope" or "Add row" to begin.
                  </td>
                </tr>
              )}

              {rows.map((row, i) => {
                // A stored name that isn't in the dropdown still selects cleanly —
                // it's offered as its own option rather than dumped into free text.
                const known = activityOptions.includes(row.activity);
                const subs = row.subItems || [];
                const open = !!expanded[i];
                const cols = canEdit ? 6 : 5;
                return (
                  <React.Fragment key={row.id ?? `new-${i}`}>
                  <tr className={subs.length ? "lts-row--parent" : undefined}>
                    <td className="lts-col-num">
                      {/* The toggle sits on the row number so a broken-down activity
                          reads as a heading, not as another leaf row. */}
                      <SubItemsToggle open={open} count={subs.length} onToggle={() => toggleExpanded(i)} />
                      {i + 1}
                    </td>
                    <td>
                      {row.customName ? (
                        <div className="lts-custom">
                          <input className="lts-inp" value={row.activity} autoFocus={focusRow === i}
                            placeholder="Enter activity name" disabled={!canEdit}
                            onChange={e => updateRow(i, "activity", e.target.value)}
                            onBlur={e => registerActivity(e.target.value)} />
                          <button type="button" className="lts-custom-back" title="Back to list"
                            disabled={!canEdit}
                            onClick={() => { setFocusRow(null); updateRow(i, "customName", false, { activity: "" }); }}>↩</button>
                        </div>
                      ) : (
                        <select className="lts-inp" value={row.activity} disabled={!canEdit}
                          onChange={e => {
                            if (e.target.value === OTHER_OPTION) {
                              setFocusRow(i);
                              updateRow(i, "customName", true, { activity: "" });
                            } else updateRow(i, "activity", e.target.value);
                          }}>
                          <option value="">Select activity / item…</option>
                          {!known && row.activity && <option value={row.activity}>{row.activity}</option>}
                          {activityOptions.map(a => <option key={a} value={a}>{a}</option>)}
                          <option value={OTHER_OPTION}>Other (type your own)…</option>
                        </select>
                      )}
                    </td>
                    <td>
                      <input className="lts-inp" value={row.specification} disabled={!canEdit}
                        onChange={e => updateRow(i, "specification", e.target.value)} placeholder="Optional" />
                    </td>
                    <td className="lts-col-qty">
                      <input className="lts-inp" type="number" min="0" step="any" value={row.quantity}
                        disabled={!canEdit}
                        onChange={e => updateRow(i, "quantity", e.target.value)} placeholder="—" />
                    </td>
                    <td className="lts-col-unit">
                      <select className="lts-inp" value={row.unit} disabled={!canEdit}
                        onChange={e => updateRow(i, "unit", e.target.value)}>
                        <option value="">—</option>
                        {!UNIT_SUGGESTIONS.includes(row.unit) && row.unit && (
                          <option value={row.unit}>{row.unit}</option>
                        )}
                        {UNIT_SUGGESTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </td>
                    {canEdit && (
                      <td className="lts-col-act">
                        <button className="lts-icon-add" title="Add a sub-item under this activity"
                          onClick={() => setSubs(i, [...subs, { name: "", description: "", unit: "", weightPct: "", weightManual: false }])}>
                          <CornerDownRight size={14} />
                        </button>
                        <button className="lts-icon-del" title="Remove row" onClick={() => removeRow(i)}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>

                  {/* Collapsed: one line naming what is inside. Without it a closed
                      breakdown looks identical to one that was never created. */}
                  {!open && subs.length > 0 && (
                    <tr className="lts-row--sub">
                      <td />
                      <td colSpan={cols - 1}>
                        <SubItemsSummary subs={subs} onExpand={() => toggleExpanded(i)} />
                      </td>
                    </tr>
                  )}

                  {open && (
                    <tr className="lts-row--sub">
                      <td />
                      <td colSpan={cols - 1}>
                        <ScopeSubItemsEditor
                          subs={subs}
                          onChange={(next) => updateRow(i, "subItems", next)}
                          parentName={row.activity}
                          options={activityOptions}
                          register={registerActivity}
                          disabled={!canEdit}
                        />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {canEdit && (
          <div className="lts-card-foot">
            <button className="lts-btn-primary" onClick={saveRows} disabled={savingRows}>
              <Save size={13} /> {savingRows ? "Saving…" : "Save Scope of Work"}
            </button>
          </div>
        )}

        <p className="lts-hint">
          What we will do — no dates or costs here. Materials for this scope are prepared in the BOM tab,
          and priced in Budget Estimation.
        </p>
      </div>
    </div>
  );
}
