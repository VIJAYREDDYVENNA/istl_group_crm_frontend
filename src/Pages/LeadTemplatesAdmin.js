// ─────────────────────────────────────────────────────────────────────────────
//  LeadTemplatesAdmin — manage the standard Scope + BOM templates that drive the
//  lead "Suggest scope / BOM" feature. One template per project type (sub-group).
//
//  Master-detail: a list of templates on the left; the selected template's header,
//  scope lines and BOM lines (with basis rules) editable on the right. Everything
//  is add / edit / delete. Reached at /officeuse/lead-admin (OFFICE_USE gated).
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Plus, Save, Trash2, RefreshCw, Download, Upload, ChevronRight, ChevronDown, CornerDownRight,
} from "lucide-react";
import api from "../services/leadsapi.js";
import { downloadStyledTemplate, readSheetRows, cell } from "../components/Leads/bomExcel.js";
import useToast from "../hooks/useToast";
import ToastContainer from "../components/Notification_Toast/ToastContainer.js";
import ConfirmationModal from "../components/ConfirmationModal.js";
import useConfirmationModal from "../components/HandleConfirmationModal.js";
import UnitSelectCell from "../components/Dropdowns/UnitSelectCell.js";
import BomItemAutocomplete from "../components/Leads/BomItemAutocomplete.js";
import TemplateLineVariantsModal from "../components/Leads/TemplateLineVariantsModal.js";
import ActivityNameSelect, { useActivityNames } from "../components/Leads/ActivityNameSelect.js";
import { downloadScopeTemplate, exportScope, parseScopeWorkbook } from "../components/Leads/scopeExcel.js";
import { BASIS_OPTIONS, SITE_VISIT_FIELDS } from "../constants/scopeActivities.js";
import {
  distributeWeights, resetWeights, setWeightAt, validateWeights, weightSum, fmtWeight,
} from "../utils/scopeWeights.js";
import "../pages-css/LeadTemplatesAdmin.css";

const GENERAL = "__general__"; // section key for BOM lines with no scope activity

// Template BOM Excel columns — includes Basis (how the qty scales per lead).
// Import is per-scope-section, so no "Scope Activity" column is needed.
const TPL_COLUMNS = [
  { header: "Component", width: 28 }, { header: "Specifications", width: 24 }, { header: "Make", width: 16 },
  { header: "Basis", width: 16 }, { header: "Qty (per basis)", width: 15 }, { header: "Step (per-step only)", width: 18 },
  { header: "Units", width: 10 }, { header: "Unit Price", width: 13 }, { header: "Notes", width: 24 },
];
// Normalise a free-text basis cell to a valid code (default PER_KW).
const normBasis = (v) => {
  const s = String(v || "").trim().toLowerCase();
  if (s.includes("fix")) return "FIXED";
  if (s.includes("step")) return "PER_STEP";
  if (s.includes("site")) return "FROM_SITE_VISIT";
  return "PER_KW";
};

const fmtINR = n => "₹" + Number(Math.round((Number(n) || 0) * 100) / 100)
  .toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// A template line has no fixed quantity, so "Amount" is only meaningful for the
// two capacity-independent-per-unit bases: FIXED (qty × price) and PER_KW (the
// per-kW cost). PER_STEP / FROM_SITE_VISIT depend on the lead → shown as "—".
// NOTE the suffix comes from the BASIS, not the Units column: "per kW" means per
// kW of plant capacity, which is independent of the item's own unit (Nos/Set/m).
const templateAmount = (r) => {
  const price = Number(r.defaultUnitRate) || 0;
  const val = Number(r.basisValue) || 0;
  if (r.basis === "FIXED") {
    return { text: fmtINR(val * price), suffix: "", title: "Fixed amount for this line (qty × unit price)." };
  }
  if (r.basis === "PER_KW") {
    return {
      text: fmtINR(val * price), suffix: "per kW",
      title: "Cost per kW of plant capacity — this comes from the “Per kW” basis, not from the item's Units.",
    };
  }
  return { text: "—", suffix: "", title: "Depends on the lead (step / site-visit basis), so it can't be shown on the template." };
};

// weightPct is this line's share of the template's 100%; weightManual marks it
// as pinned (the user typed it) so auto-distribution leaves it alone.
const blankScope = () => ({
  id: null, activity: "", category: "", specification: "", unit: "kW", notes: "",
  weightPct: "", weightManual: false,
  // Second-level breakdown. Empty = this activity is not broken down, which is
  // the normal case; sub-items are opt-in per line.
  subItems: [],
});

// A sub-item carries only what a TEMPLATE can know. The execution fields a
// project phase's sub-item also has (status, progress, dates) are deliberately
// absent: a template describes work, not a run of it, and inventing "Not
// Started" here would put a fake progress record in every generated project.
const blankSubItem = () => ({ name: "", description: "", unit: "", weightPct: "", weightManual: false });
const blankBom = (scopeActivity = "") => ({
  _key: `n${Math.random().toString(36).slice(2)}`, // stable local key for grouping
  id: null, scopeActivity, category: "", itemName: "", make: "", specification: "",
  // Units starts empty so picking a catalog item can fill in its real unit
  // (Nos / Set / m). Defaulting to "kW" used to mask every item's own unit.
  unit: "", basis: "PER_KW", basisValue: "", stepValue: "", siteVisitField: "", defaultUnitRate: "", notes: "",
  // Pick-a-make: catalog link + curated allowed makes + default (null when free-text).
  bomItemId: null, allowedVariantIds: [], defaultVariantId: null,
  // Why this saved line can't produce a quantity, as judged server-side against
  // the catalogue. Null until the server says otherwise.
  configIssue: null,
  // A make-driven basis the catalogue could already drive for this line. Advice,
  // not a fault — see rowAdvice below.
  basisAdvice: null,
});

// ── Basis completeness (mirrors LeadAdminService.incompleteBasisReason) ──────
// A basis is a promise that a quantity can be derived. Saving one without the
// number it needs breaks that promise on every lead seeded from this template,
// with nothing on the lead pointing back here — so it is caught before the save.
const isSet = (v) => { const n = Number(v); return v !== "" && v != null && Number.isFinite(n) && n > 0; };

const BASIS_NEEDS_VALUE = new Set(["FIXED", "PER_KW", "PER_MODULE", "PER_INVERTER"]);
const DRIVER_BASES = { PER_WATT_PEAK: "wattage", PER_INVERTER_KW: "kW rating" };

/** What stops this line producing a quantity, phrased as an instruction; null when sound. */
const lineProblem = (r) => {
  const basis = r.basis || "PER_KW";
  const label = (BASIS_OPTIONS.find((b) => b.value === basis) || {}).label || basis;
  if (BASIS_NEEDS_VALUE.has(basis)) {
    if (isSet(r.basisValue)) return null;
    // Mirrors the server: offer the make-driven alternative in the same breath, so
    // "type any number to make this go away" isn't the only obvious escape.
    const adv = rowAdvice(r);
    return `“${label}” needs a quantity value above zero in the Qty column.`
      + (adv ? ` Or use “${adv.basisLabel}”, which needs no value.` : "");
  }
  if (basis === "PER_STEP") {
    return isSet(r.stepValue) ? null : "“Per step” needs the kW per unit above zero in the Qty column.";
  }
  if (basis === "FROM_SITE_VISIT") {
    return r.siteVisitField ? null : "“From site visit” needs a site-visit field picked in the Qty column.";
  }
  if (DRIVER_BASES[basis]) {
    // Whether the item's makes actually carry the number is a catalogue question
    // the server answers; all this can check is that an item is attached at all.
    return r.bomItemId
      ? null
      : `“${label}” reads the ${DRIVER_BASES[basis]} off the selected make, so pick a catalogue item in the Component column.`;
  }
  return null;
};

/**
 * The problem to show on a row — and, just as importantly, WHEN.
 *
 * A line the user is still filling in is not a broken template line. Judging it
 * live meant adding a row, or clearing a value to retype it, immediately lit up a
 * complaint about work in progress. So a live problem is held back until a save is
 * actually attempted; what shows before that is only the server's verdict on lines
 * already STORED in the template, which is what the screen is meant to surface.
 *
 * A stored verdict is dropped as soon as the client can see the line is incomplete
 * for a different reason, or once the user edits the fields it was about (updBom
 * clears configIssue) — so it never lingers as a stale accusation.
 */
const rowIssue = (r, saveAttempted) => {
  const p = lineProblem(r);
  if (p) return saveAttempted ? { severity: "BLOCKING", message: p } : null;
  return r.configIssue || null;
};

/**
 * A better basis the catalogue can already drive, or null.
 *
 * Advice is about the ITEM, not the basis, so it survives a basis edit — but it
 * retires itself once taken, and is dropped the moment the row points at a
 * different catalogue item than the one the server judged.
 */
const rowAdvice = (r) => {
  const a = r.basisAdvice;
  if (!a || !a.basis) return null;
  if (r.basis === a.basis) return null;      // already using it
  if (DRIVER_BASES[r.basis]) return null;    // already make-driven
  if (r.bomItemId !== a.itemId) return null; // item changed since the server judged
  return a;
};

export default function LeadTemplatesAdmin() {
  const { toasts, removeToast, showSuccess, showError } = useToast();
  const { confirmModal, showConfirmation } = useConfirmationModal();

  const [templates, setTemplates] = useState([]);
  const [subGroups, setSubGroups] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null); // {id, projectType, name, description, isActive}
  const [detailTab, setDetailTab] = useState("scope"); // template | scope | bom
  // One fetch for the whole page; both levels of the scope table pick from it.
  const { options: activityOptions, register: registerActivity } = useActivityNames();
  const [scopeLines, setScopeLines] = useState([]);
  const [bomLines, setBomLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingScope, setSavingScope] = useState(false);
  const [savingBom, setSavingBom] = useState(false);
  // Set when a save is refused. Until then, half-finished rows are left alone —
  // see rowIssue. Cleared whenever the template is (re)loaded.
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [variantLineKey, setVariantLineKey] = useState(null); // _key of the line whose Makes modal is open

  // New-template form
  const [newType, setNewType] = useState("");
  const [newName, setNewName] = useState("");

  const loadTemplates = useCallback(async () => {
    try {
      const res = await api.get("/admin/lead-templates");
      setTemplates(Array.isArray(res) ? res : []);
    } catch (e) {
      if (e.message !== "SESSION_EXPIRED") showError("Failed to load templates");
    }
  }, [showError]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadTemplates();
      try {
        const res = await api.get("/admin/dropdowns/subgroups");
        const list = Array.isArray(res) ? res : (Array.isArray(res?.content) ? res.content : []);
        setSubGroups(list.map(s => s.subGroupName).filter(Boolean));
      } catch { /* non-fatal */ }
      setLoading(false);
    })();
  }, [loadTemplates]);

  const openTemplate = async (id) => {
    setSelectedId(id);
    setSaveAttempted(false); // a fresh load is a fresh start, not a rejected save
    try {
      const t = await api.get(`/admin/lead-templates/${id}`);
      setDetail({ id: t.id, projectType: t.projectType, name: t.name || "", description: t.description || "", isActive: t.isActive });
      // Auto-balance on open: unpinned lines share whatever the pinned ones leave,
      // so the total reads 100% straight away. A template saved before weights
      // existed has none pinned and simply comes up as an even split.
      setScopeLines(distributeWeights((t.scopeItems || []).map(s => ({
        id: s.id, activity: s.activity || "", category: s.category || "",
        specification: s.specification || "", unit: s.unit || "", notes: s.notes || "",
        weightPct: s.weightPct != null ? Number(s.weightPct) : "",
        weightManual: s.weightManual === true,
        // Balanced on open the same way the parents are, so a breakdown saved
        // before this editor existed (the column was dormant storage) still
        // shows a sensible 100%.
        subItems: distributeWeights((s.subItems || []).map(si => ({
          ...blankSubItem(),
          name: si.name || "", description: si.description || "", unit: si.unit || "",
          weightPct: si.weightPct != null ? Number(si.weightPct) : "",
          weightManual: si.weightManual === true,
        }))),
      }))));
      setBomLines((t.bomItems || []).map(b => ({
        ...blankBom(b.scopeActivity || ""),
        id: b.id, category: b.category || "", itemName: b.itemName || "",
        make: b.make || "", specification: b.specification || "", unit: b.unit || "",
        basis: b.basis || "PER_KW", basisValue: b.basisValue ?? "", stepValue: b.stepValue ?? "",
        siteVisitField: b.siteVisitField || "", defaultUnitRate: b.defaultUnitRate ?? "", notes: b.notes || "",
        bomItemId: b.bomItemId ?? null, allowedVariantIds: b.allowedVariantIds || [], defaultVariantId: b.defaultVariantId ?? null,
        configIssue: b.configIssue ?? null, basisAdvice: b.basisAdvice ?? null,
      })));
    } catch (e) {
      if (e.message !== "SESSION_EXPIRED") showError("Failed to open template");
    }
  };

  const createTemplate = async () => {
    if (!newType) { showError("Pick a project type"); return; }
    if (templates.some(t => t.projectType === newType && t.isActive)) {
      showError("An active template already exists for that project type"); return;
    }
    try {
      const t = await api.post("/admin/lead-templates", { projectType: newType, name: newName.trim() || null, isActive: true });
      setNewType(""); setNewName("");
      await loadTemplates();
      showSuccess("Template created");
      openTemplate(t.id);
    } catch (e) { if (e.message !== "SESSION_EXPIRED") showError(e.message || "Failed to create template"); }
  };

  const saveHeader = async () => {
    if (!detail) return;
    try {
      await api.put(`/admin/lead-templates/${detail.id}`, {
        projectType: detail.projectType, name: detail.name.trim() || null,
        description: detail.description.trim() || null, isActive: detail.isActive,
      });
      await loadTemplates();
      showSuccess("Template saved");
    } catch (e) { if (e.message !== "SESSION_EXPIRED") showError(e.message || "Failed to save template"); }
  };

  const deleteTemplate = async (t) => {
    const ok = await showConfirmation({
      title: t.isActive ? "Deactivate template" : "Delete template permanently",
      type: "alert",
      message: t.isActive
        ? `Deactivate the ${t.projectType} template? It stops being suggested but is kept.`
        : `Permanently delete the ${t.projectType} template and all its lines? This cannot be undone.`,
      confirmText: t.isActive ? "Deactivate" : "Delete", cancelText: "Cancel",
    });
    if (!ok) return;
    try {
      await api.delete(`/admin/lead-templates/${t.id}`);
      if (selectedId === t.id) { setSelectedId(null); setDetail(null); setScopeLines([]); setBomLines([]); }
      await loadTemplates();
      showSuccess(t.isActive ? "Template deactivated" : "Template deleted");
    } catch (e) { if (e.message !== "SESSION_EXPIRED") showError("Failed to delete template"); }
  };

  // ── Scope lines ──
  const updScope = (i, k, v) => setScopeLines(p => p.map((r, idx) => idx === i ? { ...r, [k]: v } : r));
  // Adding or removing a line re-balances the unpinned ones, so the total never
  // drifts off 100% behind the user's back.
  const addScopeLine = () => setScopeLines(p => distributeWeights([...p, blankScope()]));
  const rmScopeLine = (i) => setScopeLines(p => distributeWeights(p.filter((_, idx) => idx !== i)));
  // Typing pins the line; the rest absorb the difference live.
  const setScopeWeight = (i, raw) => setScopeLines(p => setWeightAt(p, i, raw));
  // The escape hatch: with every line pinned nothing is left to auto-balance, so
  // a wrong total would otherwise be unrecoverable from the screen.
  const resetScopeWeights = () => setScopeLines(p => resetWeights(p));

  // ── Sub-items: the second level under a scope line ──────────────────────────
  // A breakdown is its own weight group summing to 100% of ITS PARENT, using the
  // same helpers as the parents (utils/scopeWeights) rather than a second set of
  // rules — so pinning, rebalancing and the rounding tolerance behave identically
  // at both levels, and the server can enforce one model.
  // Which rows have their breakdown open. UI-only, keyed by row index — the list
  // is only reordered by add/remove, which re-renders the whole table anyway.
  const [expanded, setExpanded] = useState({});
  const toggleExpanded = (i) => setExpanded(e => ({ ...e, [i]: !e[i] }));

  const updSubs = (i, next) =>
    setScopeLines(p => p.map((r, idx) => (idx === i ? { ...r, subItems: next } : r)));
  const subsOf = (i) => scopeLines[i].subItems || [];

  const addSubItem = (i) => {
    updSubs(i, distributeWeights([...subsOf(i), blankSubItem()]));
    setExpanded(e => ({ ...e, [i]: true }));
  };
  const rmSubItem = (i, j) =>
    updSubs(i, distributeWeights(subsOf(i).filter((_, idx) => idx !== j)));
  const updSubItem = (i, j, k, v) =>
    updSubs(i, subsOf(i).map((si, idx) => (idx === j ? { ...si, [k]: v } : si)));
  const setSubWeight = (i, j, raw) => updSubs(i, setWeightAt(subsOf(i), j, raw));
  const resetSubWeights = (i) => updSubs(i, resetWeights(subsOf(i)));

  const namedSubs = (r) => (r.subItems || []).filter(si => (si.name || "").trim());
  const subWeightsOk = (r) => {
    const subs = namedSubs(r);
    return subs.length === 0 || validateWeights(subs, si => si.name).ok;
  };

  // ── Scope Excel: blank template / export / import ───────────────────────────
  // Import REPLACES the whole list rather than appending, because a scope is a
  // single ordered document — appending a re-imported file would silently double
  // every activity. Nothing is written until "Save scope lines", so the preview
  // is genuinely reversible: navigating away discards it.
  const scopeFileRef = useRef(null);
  const [scopePreview, setScopePreview] = useState(null); // { lines, errors }

  const onScopeFilePicked = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const { lines, errors } = await parseScopeWorkbook(file, blankScope);
      if (!lines.length) {
        showError(errors.length
          ? `Nothing could be imported. ${errors[0]}`
          : "The file has no scope rows. Use the Template button for the expected columns.");
        return;
      }
      setScopePreview({ lines, errors });
    } catch {
      showError("Could not read the file. Use the template format (.xlsx, .xls or .csv).");
    }
  };

  const applyScopeImport = () => {
    if (!scopePreview) return;
    // Balance both levels on the way in, so a file with no weights at all lands
    // on a valid 100% instead of showing the user an error they did not cause.
    const lines = distributeWeights(scopePreview.lines).map(r => ({
      ...r, subItems: distributeWeights(r.subItems || []),
    }));
    setScopeLines(lines);
    setExpanded({});
    const subCount = lines.reduce((n, r) => n + (r.subItems || []).length, 0);
    setScopePreview(null);
    showSuccess(`Imported ${lines.length} activit${lines.length === 1 ? "y" : "ies"}`
      + `${subCount ? ` and ${subCount} sub-item${subCount === 1 ? "" : "s"}` : ""}. `
      + "Review, then Save scope lines.");
  };

  const scopeWeightTotal = weightSum(scopeLines);
  const scopeWeightsOk = scopeLines.length === 0
    || validateWeights(scopeLines, r => r.activity).ok;

  const saveScope = async () => {
    for (const r of scopeLines) if (!r.activity.trim()) { showError("Every scope line needs an activity"); return; }
    // Blocks a zero line or a genuinely wrong total, and absorbs the sub-0.01
    // drift that retyping the displayed values causes. Re-checked server-side.
    const check = validateWeights(scopeLines, r => r.activity.trim());
    if (!check.ok) { showError(check.error); return; }
    // Each breakdown is its own 100%, checked per parent so the message can name
    // the activity to go and fix rather than just "the sub-items".
    for (const r of scopeLines) {
      const subs = (r.subItems || []).filter(si => (si.name || "").trim());
      if (!subs.length) continue;
      const sub = validateWeights(subs, si => si.name.trim());
      if (!sub.ok) {
        showError(`Under "${r.activity.trim()}": ${sub.error.replace(/^Scope weights/, "Sub-item weights")}`);
        return;
      }
    }
    setSavingScope(true);
    try {
      await api.put(`/admin/lead-templates/${detail.id}/scope-items`, {
        items: check.rows.map((r, i) => ({
          id: r.id ?? null, seqNo: i + 1, activity: r.activity.trim(),
          category: r.category || null, specification: r.specification || null,
          unit: r.unit || null, notes: r.notes || null,
          // Full precision, not the two-decimal display value.
          weightPct: r.weightPct === "" || r.weightPct == null ? null : Number(r.weightPct),
          weightManual: r.weightManual === true,
          // Only named sub-items travel: a half-typed row the user left behind is
          // not part of the standard, and the server rejects a nameless one.
          subItems: (r.subItems || [])
            .filter(si => (si.name || "").trim())
            .map(si => ({
              name: si.name.trim(),
              description: si.description || null,
              unit: si.unit || null,
              weightPct: si.weightPct === "" || si.weightPct == null ? null : Number(si.weightPct),
              weightManual: si.weightManual === true,
            })),
        })),
      });
      await openTemplate(detail.id);
      showSuccess("Scope lines saved");
    } catch (e) { if (e.message !== "SESSION_EXPIRED") showError(e.message || "Failed to save scope lines"); }
    finally { setSavingScope(false); }
  };

  // ── BOM lines (key-based, grouped by scope activity) ──
  // Editing any input the basis depends on retires the server's verdict on this
  // line — it was about the old values, and lineProblem re-judges the new ones.
  const BASIS_FIELDS = new Set(["basis", "basisValue", "stepValue", "siteVisitField", "bomItemId", "allowedVariantIds"]);
  // Advice is about the ITEM, so only an item/make change retires it — editing the
  // basis must not, or the hint would vanish the moment someone starts reacting to it.
  const ADVICE_FIELDS = new Set(["bomItemId", "allowedVariantIds"]);
  const updBom = (key, k, v) => setBomLines(p => p.map(r => (
    r._key === key ? {
      ...r, [k]: v,
      ...(BASIS_FIELDS.has(k) ? { configIssue: null } : {}),
      ...(ADVICE_FIELDS.has(k) ? { basisAdvice: null } : {}),
    } : r)));

  /**
   * Take the advice: switch the basis and drop the factor it no longer needs.
   * Local state only — "Save BOM lines" still has to be pressed, so nothing is
   * changed behind the admin's back.
   */
  // Not named use* — that prefix makes React's lint rules read it as a hook.
  const applyAdvisedBasis = (key, adv) => {
    setBomLines(p => p.map(r => (r._key === key ? {
      ...r, basis: adv.basis,
      basisValue: "", stepValue: "", siteVisitField: "",
      configIssue: null, // the server's verdict was about the old basis
    } : r)));
    // Worth a toast: the Basis select is several columns right of the button, so
    // the visible effect happens away from where the click landed.
    showSuccess(`Basis set to “${adv.basisLabel}” — the Qty factor is no longer needed. `
      + `Press “Save BOM lines” to apply it.`);
  };
  const rmBom = (key) => setBomLines(p => p.filter(r => r._key !== key));
  const addBomTo = (activity) => setBomLines(p => [...p, blankBom(activity)]);

  // ── Excel template download + per-section import (template BOM lines) ──
  const bomFileRef = useRef(null);
  const importTargetRef = useRef("");    // the scope activity name to import under
  const downloadBomTemplate = () =>
    downloadStyledTemplate(TPL_COLUMNS, null, "BOM Template", "lead_bom_template_lines.xlsx");
  const startImport = (activity) => { importTargetRef.current = activity || ""; bomFileRef.current?.click(); };
  const onBomFilePicked = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const activity = importTargetRef.current;
    try {
      const rows = await readSheetRows(file);
      if (!rows.length) { showError("The file has no data rows."); return; }
      const mapped = rows.map(r => ({
        ...blankBom(activity),
        itemName: String(cell(r, "Component", "Item")).trim(),
        specification: String(cell(r, "Specifications", "Specification")).trim(),
        make: String(cell(r, "Make")).trim(),
        basis: normBasis(cell(r, "Basis")),
        basisValue: cell(r, "Qty (per basis)", "Qty", "Value"),
        stepValue: cell(r, "Step (per-step only)", "Step"),
        unit: String(cell(r, "Units", "Unit")).trim(),
        defaultUnitRate: cell(r, "Unit Price", "Rate"),
        notes: String(cell(r, "Notes")).trim(),
      })).filter(l => l.itemName);
      if (!mapped.length) { showError("No valid rows found. Each row needs a Component."); return; }
      setBomLines(p => [...p, ...mapped]);
      showSuccess(`Imported ${mapped.length} material(s)${activity ? "" : " (General)"}. Review, then Save BOM lines.`);
    } catch {
      showError("Could not read the file. Use the template format (.xlsx, .xls or .csv).");
    }
  };
  const saveBom = async () => {
    for (const r of bomLines) if (!r.itemName.trim()) { showError("Every BOM line needs an item name"); return; }
    // Blocked at the source rather than warned about afterwards: an incomplete
    // basis here is silently inherited by every lead built from this template.
    const broken = bomLines
      .map((r, i) => ({ r, i, problem: lineProblem(r) }))
      .filter((x) => x.problem);
    if (broken.length) {
      setSaveAttempted(true); // now the rows may speak up — the user asked to commit
      const first = broken[0];
      showError(
        `Line ${first.i + 1} “${first.r.itemName.trim() || "(unnamed)"}”: ${first.problem}`
        + (broken.length > 1 ? ` (and ${broken.length - 1} more line${broken.length > 2 ? "s" : ""} — see the red rows.)` : "")
      );
      return;
    }
    setSavingBom(true);
    try {
      await api.put(`/admin/lead-templates/${detail.id}/bom-items`, {
        lines: bomLines.map((r, i) => ({
          id: r.id ?? null, seqNo: i + 1, scopeActivity: r.scopeActivity || null,
          category: r.category || null, itemName: r.itemName.trim(), make: r.make || null,
          specification: r.specification || null, unit: r.unit || null, basis: r.basis || "PER_KW",
          basisValue: r.basisValue === "" ? null : Number(r.basisValue),
          stepValue: r.stepValue === "" ? null : Number(r.stepValue),
          siteVisitField: r.siteVisitField || null,
          defaultUnitRate: r.defaultUnitRate === "" ? null : Number(r.defaultUnitRate),
          notes: r.notes || null,
          bomItemId: r.bomItemId ?? null,
          allowedVariantIds: r.allowedVariantIds || [],
          defaultVariantId: r.defaultVariantId ?? null,
        })),
      });
      await openTemplate(detail.id);
      showSuccess("BOM lines saved");
    } catch (e) {
      // The server's per-line message (it also checks whether the linked item's
      // makes carry the attribute, which needs the catalogue) is the useful one.
      if (e.message !== "SESSION_EXPIRED") showError(e.message || "Failed to save BOM lines");
    }
    finally { setSavingBom(false); }
  };

  // Which extra input a basis needs (value / step / site-visit field).
  const basisInput = (r) => {
    if (r.basis === "PER_STEP") {
      return <input className="lta-inp" type="number" min="0" step="any" value={r.stepValue}
        placeholder="kW / unit" onChange={e => updBom(r._key, "stepValue", e.target.value)} />;
    }
    if (r.basis === "FROM_SITE_VISIT") {
      return (
        <select className="lta-inp" value={r.siteVisitField} onChange={e => updBom(r._key, "siteVisitField", e.target.value)}>
          <option value="">— field —</option>
          {SITE_VISIT_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      );
    }
    // Driver bases take no factor — the number comes from the attached make
    // (module Wp / inverter kW). Attach makes via the Makes button on this line.
    if (r.basis === "PER_WATT_PEAK" || r.basis === "PER_INVERTER_KW") {
      return <input className="lta-inp" value="from make" disabled readOnly
        title="Quantity is derived from the selected make (module wattage / inverter kW). Attach makes on this line." />;
    }
    if (r.basis === "PER_MODULE" || r.basis === "PER_INVERTER") {
      return <input className="lta-inp" type="number" min="0" step="any" value={r.basisValue}
        placeholder={r.basis === "PER_MODULE" ? "per module" : "per inverter"}
        onChange={e => updBom(r._key, "basisValue", e.target.value)} />;
    }
    // FIXED or PER_KW → a numeric value
    return <input className="lta-inp" type="number" min="0" step="any" value={r.basisValue}
      placeholder={r.basis === "PER_KW" ? "per kW" : "qty"} onChange={e => updBom(r._key, "basisValue", e.target.value)} />;
  };

  if (loading) return <div className="lta-page"><div className="lta-loading">Loading templates…</div></div>;

  // Distinct scope activities → sections, in scope-line order, plus General.
  const scopeActivityOptions = [...new Set(scopeLines.map(s => (s.activity || "").trim()).filter(Boolean))];
  const bomSections = [
    ...scopeActivityOptions.map(a => ({ key: a, activity: a, title: a })),
    { key: GENERAL, activity: "", title: "General / Unassigned" },
  ];
  const knownActivities = new Set(scopeActivityOptions.map(a => a.toLowerCase()));
  const bomLinesFor = (section) => bomLines.filter(r => {
    const act = (r.scopeActivity || "").trim();
    if (section.key === GENERAL) return !act || !knownActivities.has(act.toLowerCase());
    return act.toLowerCase() === section.activity.toLowerCase();
  });

  // Every line that can't (or might not) produce a quantity, in one place — so a
  // template broken three rows down doesn't have to be found by opening each row.
  const issueList = bomLines
    .map((r, i) => ({ r, no: i + 1, issue: rowIssue(r, saveAttempted) }))
    .filter((x) => x.issue);
  const blockingCount = issueList.filter((x) => x.issue.severity === "BLOCKING").length;

  return (
    <div className="lta-page">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <ConfirmationModal {...confirmModal} />

      {variantLineKey && (() => {
        const vLine = bomLines.find(r => r._key === variantLineKey);
        if (!vLine) return null;
        return (
          <TemplateLineVariantsModal
            line={vLine}
            onClose={() => setVariantLineKey(null)}
            onApply={patch => setBomLines(prev => prev.map(row =>
              // Re-curating the makes changes what the basis can read, so the
              // server's last verdict and advice on this line are retired with it.
              row._key === variantLineKey ? { ...row, ...patch, configIssue: null, basisAdvice: null } : row))}
            showError={showError}
            showSuccess={showSuccess}
          />
        );
      })()}

      {/* Import preview. A large scope is exactly the case where a silent import
          is dangerous — the user cannot eyeball 200 rows in a toast — so what was
          understood is shown BEFORE it replaces anything, with the rows that could
          not be read listed by their own row number. */}
      {scopePreview && (() => {
        const { lines, errors } = scopePreview;
        const subCount = lines.reduce((n, r) => n + (r.subItems || []).length, 0);
        return (
          <div className="lta-modal-back" onClick={() => setScopePreview(null)}>
            <div className="lta-modal" onClick={e => e.stopPropagation()}>
              <div className="lta-modal-head">
                <h3>Import scope lines</h3>
                <p className="lta-hint">
                  {lines.length} activit{lines.length === 1 ? "y" : "ies"}
                  {subCount ? ` and ${subCount} sub-item${subCount === 1 ? "" : "s"}` : ""} read from the file.
                  This <b>replaces</b> the {scopeLines.length} line{scopeLines.length === 1 ? "" : "s"} currently
                  on screen — nothing is written until you press “Save scope lines”.
                </p>
              </div>

              {errors.length > 0 && (
                <div className="lta-import-errs">
                  <b>{errors.length} row{errors.length === 1 ? "" : "s"} skipped:</b>
                  <ul>{errors.slice(0, 8).map((m, k) => <li key={k}>{m}</li>)}</ul>
                  {errors.length > 8 && <span className="lta-hint">…and {errors.length - 8} more.</span>}
                </div>
              )}

              <div className="lta-modal-body">
                <table className="lta-table lta-table--sub">
                  <thead><tr><th className="lta-c-no">#</th><th>Activity</th><th>Specification</th><th className="lta-c-unit">Unit</th><th className="lta-c-weight">Weight %</th></tr></thead>
                  <tbody>
                    {lines.map((r, i) => (
                      <React.Fragment key={i}>
                        <tr className="lta-row--parent">
                          <td className="lta-c-no">{i + 1}</td>
                          <td>{r.activity}</td>
                          <td>{r.specification}</td>
                          <td className="lta-c-unit">{r.unit}</td>
                          <td className="lta-c-weight">{r.weightPct === "" ? "auto" : fmtWeight(r.weightPct)}</td>
                        </tr>
                        {(r.subItems || []).map((si, j) => (
                          <tr key={`${i}-${j}`} className="lta-sub-summary">
                            <td className="lta-c-no">{i + 1}.{j + 1}</td>
                            <td className="lta-preview-sub">{si.name}</td>
                            <td>{si.description}</td>
                            <td className="lta-c-unit">{si.unit}</td>
                            <td className="lta-c-weight">{si.weightPct === "" ? "auto" : fmtWeight(si.weightPct)}</td>
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="lta-modal-foot">
                <button className="lta-btn-ghost" onClick={() => setScopePreview(null)}>Cancel</button>
                <button className="lta-btn-primary" onClick={applyScopeImport}>
                  <Upload size={13} /> Replace {scopeLines.length} line{scopeLines.length === 1 ? "" : "s"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="lta-head">
        <h1 className="lta-title">Lead Scope / BOM Templates</h1>
        <p className="lta-sub">Standard scope and materials per project type — used to suggest a starting estimate for a lead.</p>
      </div>

      <div className="lta-layout">
        {/* ── Left: template list + create ── */}
        <div className="lta-list-card">
          <div className="lta-list-head">
            <span>Templates</span>
            <button className="lta-icon" title="Refresh" onClick={loadTemplates}><RefreshCw size={14} /></button>
          </div>

          <div className="lta-create">
            <select className="lta-inp" value={newType} onChange={e => setNewType(e.target.value)}>
              <option value="">Project type…</option>
              {subGroups.map(sg => <option key={sg} value={sg}>{sg}</option>)}
            </select>
            <input className="lta-inp" placeholder="Name (optional)" value={newName} onChange={e => setNewName(e.target.value)} />
            <button className="lta-btn-primary" onClick={createTemplate}><Plus size={13} /> Add</button>
          </div>

          <div className="lta-list">
            {templates.length === 0 && <div className="lta-empty">No templates yet.</div>}
            {templates.map(t => (
              <div key={t.id} className={`lta-list-item${selectedId === t.id ? " active" : ""}`} onClick={() => openTemplate(t.id)}>
                <div className="lta-list-main">
                  <b>{t.projectType}</b>
                  {t.name && <span className="lta-list-name">{t.name}</span>}
                </div>
                {!t.isActive && <span className="lta-badge-off">inactive</span>}
                <button className="lta-icon-del" title={t.isActive ? "Deactivate" : "Delete"}
                  onClick={e => { e.stopPropagation(); deleteTemplate(t); }}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>

        {/* ── Right: selected template detail (tabbed) ── */}
        <div className="lta-detail">
          {!detail ? (
            <div className="lta-detail-empty">Select a template on the left, or create one.</div>
          ) : (
            <div className="lta-card lta-card--flush">
              {/* Tab bar */}
              <div className="lta-tabs">
                <button className={`lta-tab${detailTab === "template" ? " active" : ""}`} onClick={() => setDetailTab("template")}>Template</button>
                <button className={`lta-tab${detailTab === "scope" ? " active" : ""}`} onClick={() => setDetailTab("scope")}>Scope Lines <span className="lta-tab-count">{scopeLines.length}</span></button>
                <button className={`lta-tab${detailTab === "bom" ? " active" : ""}`} onClick={() => setDetailTab("bom")}>BOM Lines <span className="lta-tab-count">{bomLines.length}</span></button>
                <span className="lta-tabs-type">{detail.projectType}{!detail.isActive && <span className="lta-badge-off">inactive</span>}</span>
              </div>

              {/* Template tab */}
              {detailTab === "template" && (
                <div className="lta-tab-body">
                  <div className="lta-form-grid">
                    <label className="lta-field"><span>Project Type</span><input className="lta-inp" value={detail.projectType} disabled /></label>
                    <label className="lta-field"><span>Name</span>
                      <input className="lta-inp" value={detail.name} onChange={e => setDetail(d => ({ ...d, name: e.target.value }))} /></label>
                    <label className="lta-field"><span>Active</span>
                      <select className="lta-inp" value={detail.isActive ? "1" : "0"}
                        onChange={e => setDetail(d => ({ ...d, isActive: e.target.value === "1" }))}>
                        <option value="1">Active</option><option value="0">Inactive</option>
                      </select></label>
                    <label className="lta-field lta-field--full"><span>Description</span>
                      <input className="lta-inp" value={detail.description} onChange={e => setDetail(d => ({ ...d, description: e.target.value }))} /></label>
                  </div>
                  <div className="lta-card-foot"><button className="lta-btn-primary" onClick={saveHeader}><Save size={13} /> Save template</button></div>
                </div>
              )}

              {/* Scope Lines tab */}
              {detailTab === "scope" && (
                <div className="lta-tab-body">
                  <div className="lta-tab-actions">
                    <span className="lta-hint">The standard activities suggested for this project type, the breakdown under each one, and the share of project progress they carry.</span>
                    <button className="lta-btn-ghost lta-act-right" onClick={downloadScopeTemplate}
                      title="Download a blank Excel template — one row per activity, Level = Sub for the items under it">
                      <Download size={13} /> Template
                    </button>
                    <button className="lta-btn-ghost" onClick={() => exportScope(scopeLines, detail.projectType)}
                      disabled={scopeLines.length === 0}
                      title="Export the scope below to Excel — the same file imports back">
                      <Download size={13} /> Export
                    </button>
                    <button className="lta-btn-ghost" onClick={() => scopeFileRef.current?.click()}
                      title="Import a scope from Excel — replaces the list below (nothing is saved until you press Save)">
                      <Upload size={13} /> Import
                    </button>
                    <button className="lta-btn-ghost" onClick={resetScopeWeights}
                      title="Unpin every weight and split them evenly again">
                      <RefreshCw size={13} /> Reset weights
                    </button>
                    <button className="lta-btn-ghost" onClick={addScopeLine}><Plus size={13} /> Add line</button>
                    <input ref={scopeFileRef} type="file" accept=".xlsx,.xls,.csv"
                      style={{ display: "none" }} onChange={onScopeFilePicked} />
                  </div>
                  <div className="lta-table-wrap">
                    <table className="lta-table">
                      <thead><tr><th className="lta-c-no">#</th><th>Activity</th><th>Category</th><th>Specification</th><th className="lta-c-unit">Unit</th><th className="lta-c-weight">Weight %</th><th>Notes</th><th className="lta-c-act" /></tr></thead>
                      <tbody>
                        {scopeLines.length === 0 && <tr><td colSpan={8} className="lta-empty">No scope lines. "Add line" to define the standard scope, or "Import" to bring a large one in from Excel.</td></tr>}
                        {scopeLines.map((r, i) => {
                          const subs = r.subItems || [];
                          const open = !!expanded[i];
                          const subTotal = weightSum(namedSubs(r));
                          const subsOk = subWeightsOk(r);
                          return (
                          <React.Fragment key={r.id ?? `n${i}`}>
                          <tr className={subs.length ? "lta-row--parent" : undefined}>
                            <td className="lta-c-no">
                              {/* The toggle sits on the row number so a broken-down
                                  activity reads as a heading, not another leaf row. */}
                              <button className="lta-sub-toggle" onClick={() => toggleExpanded(i)}
                                title={open ? "Hide the breakdown" : subs.length ? `Show ${subs.length} sub-item(s)` : "Add a breakdown"}>
                                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                              </button>
                              {i + 1}
                            </td>
                            <td>
                              <ActivityNameSelect className="lta-inp" value={r.activity}
                                onChange={v => updScope(i, "activity", v)}
                                options={activityOptions} register={registerActivity}
                                placeholder="Select activity…" />
                            </td>
                            <td><input className="lta-inp" value={r.category} onChange={e => updScope(i, "category", e.target.value)} placeholder="Optional" /></td>
                            <td><input className="lta-inp" value={r.specification} onChange={e => updScope(i, "specification", e.target.value)} placeholder="Optional" /></td>
                            <td className="lta-c-unit"><UnitSelectCell className="lta-inp" value={r.unit} onChange={v => updScope(i, "unit", v)} /></td>
                            <td className="lta-c-weight">
                              <input
                                className={`lta-inp lta-inp--w${r.weightManual ? " lta-w-pinned" : ""}`}
                                type="number" min="0" max="100" step="0.01" value={r.weightPct}
                                onChange={e => setScopeWeight(i, e.target.value)}
                                title={r.weightManual
                                  ? "Set by you — this weight holds while the others rebalance around it."
                                  : "Calculated automatically. Type a value to hold it."} />
                            </td>
                            <td><input className="lta-inp" value={r.notes} onChange={e => updScope(i, "notes", e.target.value)} /></td>
                            <td className="lta-c-act">
                              <button className="lta-icon-add" title="Add a sub-item under this activity"
                                onClick={() => addSubItem(i)}><CornerDownRight size={14} /></button>
                              <button className="lta-icon-del" onClick={() => rmScopeLine(i)}><Trash2 size={14} /></button>
                            </td>
                          </tr>
                          {/* The collapsed summary is what makes a breakdown findable
                              at all — otherwise a closed row looks identical to one
                              that was never broken down. */}
                          {!open && subs.length > 0 && (
                            <tr className="lta-sub-summary">
                              <td />
                              <td colSpan={7}>
                                <button className="lta-linkish" onClick={() => toggleExpanded(i)}>
                                  {subs.length} sub-item{subs.length === 1 ? "" : "s"}
                                </button>
                                <span className="lta-hint"> — {namedSubs(r).map(si => si.name).join(", ") || "unnamed"}</span>
                                {!subsOk && <span className="lta-sub-bad"> · weights total {fmtWeight(subTotal)}%</span>}
                              </td>
                            </tr>
                          )}
                          {open && (
                            <tr className="lta-sub-block">
                              <td />
                              <td colSpan={7}>
                                <div className="lta-sub-wrap">
                                  <div className="lta-sub-head">
                                    <span className="lta-hint">
                                      Sub-items under <b>{r.activity.trim() || "this activity"}</b> — each is a share of
                                      {" "}<b>this activity</b>, so they add up to 100% of it, not of the template.
                                    </span>
                                    <button className="lta-btn-ghost lta-act-right" onClick={() => resetSubWeights(i)}
                                      disabled={subs.length === 0}
                                      title="Unpin these sub-weights and split them evenly again">
                                      <RefreshCw size={12} /> Reset
                                    </button>
                                    <button className="lta-btn-ghost" onClick={() => addSubItem(i)}>
                                      <Plus size={12} /> Add sub-item
                                    </button>
                                  </div>
                                  {subs.length === 0 ? (
                                    <div className="lta-empty lta-sub-empty">
                                      No breakdown. "Add sub-item" to standardise the work under this activity.
                                    </div>
                                  ) : (
                                    <table className="lta-table lta-table--sub">
                                      <thead><tr><th className="lta-c-no" /><th>Sub-item</th><th>Description</th><th className="lta-c-unit">Unit</th><th className="lta-c-weight">Weight %</th><th className="lta-c-act" /></tr></thead>
                                      <tbody>
                                        {subs.map((si, j) => (
                                          <tr key={j}>
                                            <td className="lta-c-no">{i + 1}.{j + 1}</td>
                                            <td>
                                              <ActivityNameSelect className="lta-inp" value={si.name}
                                                onChange={v => updSubItem(i, j, "name", v)}
                                                options={activityOptions} register={registerActivity}
                                                placeholder="Select sub-item…" />
                                            </td>
                                            <td><input className="lta-inp" value={si.description}
                                              onChange={e => updSubItem(i, j, "description", e.target.value)} placeholder="Optional" /></td>
                                            <td className="lta-c-unit">
                                              <UnitSelectCell className="lta-inp" value={si.unit}
                                                onChange={v => updSubItem(i, j, "unit", v)} />
                                            </td>
                                            <td className="lta-c-weight">
                                              <input
                                                className={`lta-inp lta-inp--w${si.weightManual ? " lta-w-pinned" : ""}`}
                                                type="number" min="0" max="100" step="0.01" value={si.weightPct}
                                                onChange={e => setSubWeight(i, j, e.target.value)}
                                                title={si.weightManual
                                                  ? "Set by you — this weight holds while the others rebalance around it."
                                                  : "Calculated automatically. Type a value to hold it."} />
                                            </td>
                                            <td className="lta-c-act">
                                              <button className="lta-icon-del" onClick={() => rmSubItem(i, j)}><Trash2 size={13} /></button>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  )}
                                  {subs.length > 0 && (
                                    <div className={`lta-weight-total lta-weight-total--sub${subsOk ? " lta-weight-total--ok" : " lta-weight-total--err"}`}>
                                      <span>Sub-total: <b>{fmtWeight(subTotal)}%</b> of {r.activity.trim() || "this activity"}</span>
                                      <span className="lta-hint">
                                        {subsOk ? "Adds up." : "Must add up to 100% of the activity before this template can be saved."}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                          </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {scopeLines.length > 0 && (
                    <div className={`lta-weight-total${scopeWeightsOk ? " lta-weight-total--ok" : " lta-weight-total--err"}`}>
                      <span>Total weight: <b>{fmtWeight(scopeWeightTotal)}%</b></span>
                      <span className="lta-hint">
                        {scopeWeightsOk
                          ? "Adds up — the generated project inherits these weights."
                          : "Must add up to 100% before this template can be saved."}
                      </span>
                    </div>
                  )}
                  <div className="lta-card-foot"><button className="lta-btn-primary" onClick={saveScope} disabled={savingScope}><Save size={13} /> {savingScope ? "Saving…" : "Save scope lines"}</button></div>
                </div>
              )}
              {/* BOM Lines tab — grouped under each scope activity, like the leads BOM tab */}
              {detailTab === "bom" && (
                <div className="lta-tab-body">
                  <div className="lta-tab-actions">
                    <span className="lta-hint">Same columns as the lead BOM. <b>Qty</b> is read via the <b>Basis</b>; use each activity's <b>Import</b> to load materials under it.</span>
                    <button className="lta-btn-ghost" onClick={downloadBomTemplate} title="Download a blank Excel template to fill in, then import it under a scope"><Download size={13} /> Template</button>
                    <input ref={bomFileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={onBomFilePicked} />
                  </div>

                  {scopeActivityOptions.length === 0 && bomLines.length === 0 && (
                    <div className="lta-empty-block">
                      Add scope activities in the <b>Scope Lines</b> tab first — materials are organised under each activity.
                      You can still add general (unassigned) materials below.
                    </div>
                  )}

                  {issueList.length > 0 && (
                    <div className={`lta-issues${blockingCount ? " lta-issues--block" : ""}`}>
                      <div className="lta-issues-head">
                        {blockingCount > 0 ? (
                          <b>{blockingCount} line{blockingCount === 1 ? "" : "s"} cannot produce a quantity</b>
                        ) : (
                          <b>{issueList.length} line{issueList.length === 1 ? "" : "s"} need attention</b>
                        )}
                        <span className="lta-hint">
                          Every lead built from this template inherits these lines, and shows a blank quantity for them.
                        </span>
                      </div>
                      <ul className="lta-issues-list">
                        {issueList.map(({ r, no, issue }) => {
                          const adv = rowAdvice(r);
                          return (
                            <li key={r._key} className={issue.severity === "BLOCKING" ? "lta-issue-block" : "lta-issue-warn"}>
                              <b>Line {no} — {r.itemName.trim() || "(unnamed)"}</b>
                              <span>{r.scopeActivity ? ` (${r.scopeActivity})` : " (General)"}: </span>
                              {issue.message}
                              {/* Where a broken line has a ready remedy, put it here too —
                                  this list is what gets read after a rejected save. */}
                              {adv && <span className="lta-issue-fix"> → {adv.message}</span>}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  {bomSections.map(section => {
                    const secLines = bomLinesFor(section);
                    if (section.key === GENERAL && secLines.length === 0) return null; // hide empty General
                    return (
                      <div key={section.key} className="lta-section">
                        <div className="lta-section-head">
                          <span className="lta-section-title">{section.title}</span>
                          <button className="lta-section-import"
                            onClick={() => startImport(section.activity)}
                            title={`Import materials from Excel under "${section.title}"`}>
                            <Upload size={12} /> Import
                          </button>
                          <span className="lta-section-count">{secLines.length}</span>
                        </div>

                        {secLines.length === 0 ? (
                          <div className="lta-section-empty">No materials for this activity yet.</div>
                        ) : (
                          <div className="lta-table-wrap">
                            <table className="lta-table lta-table--bom">
                              <thead><tr>
                                <th className="lta-c-no">#</th><th className="lta-c-item">Component</th><th>Specifications</th><th>Make</th>
                                <th className="lta-c-qty">Qty</th><th className="lta-c-unit">Units</th><th>Unit Price</th>
                                <th className="lta-c-amt">Amount</th><th className="lta-c-basis">Basis</th><th>Notes</th>
                                <th className="lta-c-move">Move to</th><th className="lta-c-act" />
                              </tr></thead>
                              <tbody>
                                {secLines.map((r, i) => {
                                  const amt = templateAmount(r);
                                  const issue = rowIssue(r, saveAttempted);
                                  const adv = rowAdvice(r);
                                  const rowCls = !issue ? undefined
                                    : issue.severity === "BLOCKING" ? "lta-row-block" : "lta-row-warn";
                                  return (
                                  <tr key={r._key} className={rowCls}>
                                    <td className="lta-c-no">
                                      {i + 1}
                                      {issue && <span className="lta-issue-dot" title={issue.message}>●</span>}
                                    </td>
                                    <td className="lta-c-item">
                                      <BomItemAutocomplete
                                        value={r.itemName}
                                        placeholder="Component name"
                                        onChange={v => updBom(r._key, "itemName", v)}
                                        onSelect={item => setBomLines(prev => prev.map(row => (row._key === r._key ? {
                                          ...row,
                                          itemName: item.itemName || row.itemName,
                                          bomItemId: item.id ?? null,
                                          // New catalog item → re-curate makes from scratch, and the
                                          // server's verdict and advice about the old item no longer apply.
                                          allowedVariantIds: [], defaultVariantId: null,
                                          configIssue: null, basisAdvice: null,
                                          make: item.makeBrand || row.make,
                                          // Catalog wins: the master item's unit is authoritative
                                          // (was `row.unit || …`, which the "kW" default always won).
                                          unit: item.defaultUnit || row.unit || "",
                                          specification: row.specification || item.specification || "",
                                        } : row)))}
                                      />
                                    </td>
                                    <td><input className="lta-inp" value={r.specification} onChange={e => updBom(r._key, "specification", e.target.value)} placeholder="Specifications" /></td>
                                    <td>
                                      {r.bomItemId ? (
                                        <div className="lta-make-cell" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: r.make ? "inherit" : "#9CA3AF" }}>
                                            {r.make || "— set make —"}
                                          </span>
                                          <button type="button" className="lta-btn-ghost" style={{ whiteSpace: "nowrap", padding: "2px 8px" }}
                                            onClick={() => setVariantLineKey(r._key)}
                                            title="Manage the allowed makes for this line">
                                            Makes{(r.allowedVariantIds?.length || 0) > 0 ? ` (${r.allowedVariantIds.length})` : ""}
                                          </button>
                                        </div>
                                      ) : (
                                        <input className="lta-inp" value={r.make} onChange={e => updBom(r._key, "make", e.target.value)} placeholder="Make / brand" />
                                      )}
                                    </td>
                                    <td className="lta-c-qty">
                                      {basisInput(r)}
                                      {/* No inline complaint here. It fired the moment a box was
                                          empty, so clearing a value to retype it lit up a red
                                          sentence under every row — 22 of them while editing. The
                                          row dot, the summary panel above and the blocked save all
                                          still name these lines; the cell keeps only the REMEDY,
                                          which is the one thing worth acting on in place. */}
                                      {adv && (
                                        <button type="button" className="lta-cell-advice" title={adv.message}
                                          onClick={() => applyAdvisedBasis(r._key, adv)}>
                                          ⇢ Use “{adv.basisLabel}”
                                        </button>
                                      )}
                                    </td>
                                    <td className="lta-c-unit"><UnitSelectCell className="lta-inp" value={r.unit} onChange={v => updBom(r._key, "unit", v)} /></td>
                                    <td><input className="lta-inp" type="number" min="0" step="any" value={r.defaultUnitRate} onChange={e => updBom(r._key, "defaultUnitRate", e.target.value)} placeholder="0" /></td>
                                    <td className="lta-c-amt lta-amt" title={amt.title}>{amt.text}<span className="lta-amt-suffix">{amt.suffix}</span></td>
                                    <td className="lta-c-basis">
                                      <select className="lta-inp" value={r.basis} onChange={e => updBom(r._key, "basis", e.target.value)}
                                        title={(BASIS_OPTIONS.find(b => b.value === r.basis) || {}).help}>
                                        {BASIS_OPTIONS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
                                      </select>
                                    </td>
                                    <td><input className="lta-inp" value={r.notes} onChange={e => updBom(r._key, "notes", e.target.value)} /></td>
                                    <td className="lta-c-move">
                                      <select className="lta-inp" value={knownActivities.has((r.scopeActivity || "").toLowerCase()) ? r.scopeActivity : ""}
                                        onChange={e => updBom(r._key, "scopeActivity", e.target.value)}>
                                        <option value="">General</option>
                                        {scopeActivityOptions.map(a => <option key={a} value={a}>{a}</option>)}
                                      </select>
                                    </td>
                                    <td className="lta-c-act"><button className="lta-icon-del" onClick={() => rmBom(r._key)}><Trash2 size={14} /></button></td>
                                  </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}

                        <button className="lta-add-material" onClick={() => addBomTo(section.activity)}>
                          ＋ Add material{section.key !== GENERAL ? ` to ${section.title}` : ""}
                        </button>
                      </div>
                    );
                  })}

                  <div className="lta-card-foot"><button className="lta-btn-primary" onClick={saveBom} disabled={savingBom}><Save size={13} /> {savingBom ? "Saving…" : "Save BOM lines"}</button></div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
