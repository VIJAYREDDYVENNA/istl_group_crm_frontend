/* ============================================================================
 *  orderBookTabsPorted.js  —  GENERATED / PORTED, do not edit by hand.
 *
 *  This is a faithful copy of components/OrderBook/OrderBookDetailPage.js with the
 *  entity-scoped detail endpoints re-keyed from  /order-book/${id}/...  to
 *  /projects/${id}/...  (the Projects backend MIRRORS the Order Book endpoints
 *  exactly — same request/response bodies).  Only the four editable execution
 *  tabs are exported and consumed by components/Projects/ProjectDetailPage.js:
 *      TechnicalTab   -> Scope / SOW
 *      CommercialTab  -> Financials (commercial)
 *      BomTab         -> Financials (BOM / BOQ)
 *      ProgressTab    -> Progress & Timeline
 *  The rest of the module (OverviewTab, the default OrderBookDetailPage export)
 *  is carried along unused so every module-scope helper the tabs depend on stays
 *  intact.  The 'orderBook' prop these components receive is a project-shaped
 *  shim built in ProjectDetailPage ({ id: projectUniqueId, ... }).
 *
 *  SANCTIONED DIVERGENCES from OrderBookDetailPage.js (do not re-port over them):
 *    • TechnicalTab's parent Weight % cell is an editable input here; the order
 *      book renders it read-only.
 *    • loadDefaultPlan() carries the template's weightPct onto each suggested
 *      row, so a project generated from a template inherits the template's
 *      weights instead of the equal split. Nothing else about the tab's weight
 *      behaviour (auto-distribution, pinning, snapping, validation) changed.
 *    • loadDefaultPlan() also carries the template's SUB-ITEM breakdown, and is a
 *      merge rather than a wholesale replace: a phase or node that is still in
 *      the standard keeps its id, dates, progress and budget.
 *    • [2026-09-07] The sub-item breakdown is a TREE of arbitrary depth, not one
 *      flat level, and it is edited by the SHARED components/Leads/ScopeTreeEditor
 *      rather than by this file's own sub-item <tr>s (which are gone). Three
 *      hand-maintained copies of a recursive editor would have been three sets of
 *      nesting bugs. The progress cells are passed in through its renderExtra prop,
 *      because they are the one part that is genuinely project-specific.
 *    • [2026-09-07] A node's identity is its `id` (a UUID), NOT its name.
 *      project_progress_periods.sub_item_key and the planned-budget merge in
 *      ProjectDetailService.saveScopeBudgets both key off that id, so renaming a
 *      node is safe and two nodes sharing a name in different branches stay
 *      separate. The merge matches by id first, name second, within each parent,
 *      and recurses. Existing rows were re-keyed by ScopeNodeIdMigrationRunner.
 *    • [2026-09-07] This file's OWN weight engine (distributeSubWeights /
 *      snapSubGroup / resetSubWeights, and the ±0.5 blur-snap with a 0.01 gate) was
 *      REMOVED in favour of utils/scopeWeights.js via utils/scopeTree.js — the same
 *      engine the templates and lead screens use. The two had already drifted to
 *      different tolerances, and nesting would have required maintaining both at
 *      every level. The blur-snap is gone because it is no longer needed: typing a
 *      weight rebalances the group immediately.
 *    • [2026-09-07] Roll-ups (progress) and sums (capital, budget) walk the whole
 *      tree. A node with children reports its children, never its own stale value.
 *    • [2026-09-07] PER-NODE SCHEDULING. The sub-item start/end date inputs and the
 *      status select that this file used to render were lost when the flat <tr>s
 *      became ScopeTreeEditor; both are restored via renderExtra, and scheduling is
 *      now per node at every level. A node WITH children carries its own span plus a
 *      Weekly/Monthly choice, which is the period grid its children sit on; a leaf
 *      takes dates, and those dates now DRIVE its period range (they were stored but
 *      read by nothing before). The controls live in the shared
 *      components/Leads/NodeScheduleCell so the lead tab uses the same ones.
 *    • [2026-09-07] parseDate / bucketCount / bucketLabel / bucketToISODate MOVED OUT
 *      of this file to utils/scopeSchedule.js, which also adds dateToBucket (the
 *      date→period inverse that did not exist) and bucketRange. They moved because
 *      the lead scope tab needs the same arithmetic and must not import from this
 *      hand-maintained port. This file imports them back.
 *    • [2026-09-07] The phase save body now sends plannedStartDate / plannedEndDate /
 *      planUnit. project_phases.planned_start_date and planned_end_date have existed
 *      and been wired server-side all along, but the client omitted them, so
 *      saveScope wrote NULL into both on EVERY save — a phase could not hold a date.
 *    • [2026-09-08] The breakdown TREE no longer expands inline under the phase row
 *      (the sub-item <tr>s are gone, again). A phase's whole nested tree opens in
 *      components/Leads/ScopeBreakdownModal instead — ScopeTreeEditor's own
 *      chevrons/indentation are unchanged, only where they render moved. Was extra
 *      rows squeezed into the SAME table at whatever depth the tree reached, which
 *      is exactly what made a phase with any real breakdown look congested. The
 *      renderExtra callback (progress/schedule/status) moved with it unchanged;
 *      only one phase's breakdown is viewable at a time now (`openBreakdown` state,
 *      a row index, replaces the old per-row `p.expanded` boolean — that field is
 *      left in blankPhase/load's data shape, just unread by this tab now).
 *    • [2026-09-08] `utils/scopeTree.js`'s PASS_THROUGH allowlist was missing
 *      plannedStartDate/plannedEndDate/planUnit, so hydrateTree/treeForSave/mergeTree
 *      silently stripped a parent node's own span+unit on every load, save and
 *      re-suggest. Fixed there (one array, three consumers, every host) — not a
 *      change in this file, noted here because it explains why a node with its own
 *      breakdown used to "forget" its schedule on reload.
 * ========================================================================== */
// ============================================================================
//  OrderBookDetailPage
//  Full in-page detail view for a single order book — mirrors the LeadDetailPage
//  pattern (back button + persisted tab bar). Three tabs:
//    • Overview        — order header, items, PO file
//    • Technical Scope — scope-of-work + weekly EPC execution plan (editable,
//                        with an inline Gantt-style week timeline)
//    • Commercial      — budget allocation editor + live procurement/spend
//                        pulled by projectId, with allocated-vs-actual analysis
//
//  Backend endpoints consumed (all under /order-book):
//    GET  /{id}/items
//    GET  /{id}/scope                  PUT /{id}/scope
//    GET  /{id}/scope/default-plan
//    GET  /{id}/budget                 PUT /{id}/budget
//    GET  /{id}/commercial-summary
//    GET  /{id}/download-po
//    (procurement/spend lists reuse the existing project-keyed endpoints)
// ============================================================================
import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import * as XLSXStyle from 'xlsx-js-style'; // style-capable SheetJS fork; used only for the colored export
import { ArrowLeft, Plus, Trash2, Save, Wand2, Check, Download, RotateCcw, Maximize2 } from 'lucide-react';
import { FaFilePdf, FaFileImage, FaFileAlt, FaFileDownload, FaExternalLinkAlt } from 'react-icons/fa';
import '../../pages-css/OrderBookDetail.css';
import ConfirmationModal from '../ConfirmationModal.js';
import useConfirmationModal from '../HandleConfirmationModal.js';
import LocationPicker from '../LocationPicker.js';
import UnitSelectCell from '../Dropdowns/UnitSelectCell.js';
import ScopeBreakdownModal from '../Leads/ScopeBreakdownModal.js';
import NodeScheduleCell from '../Leads/NodeScheduleCell.js';
import { distributeWeights, resetWeights } from '../../utils/scopeWeights.js';
import {
  blankNode, hydrateTree, validateTree, mergeTree,
} from '../../utils/scopeTree.js';
// Scheduling moved to utils/scopeSchedule.js so the lead scope tab can share it —
// it must not import from this hand-maintained port. parseDate / bucketCount /
// bucketLabel / bucketToISODate used to live here at module scope.
import {
  parseDate, bucketCount, bucketLabel, bucketToISODate,
  nodeGrid, validateSchedule,
} from '../../utils/scopeSchedule.js';

const API_BASE_URL = process.env.REACT_APP_API_URL;

const fmtDate = d => { if (!d) return '-'; const dt = new Date(d); if (isNaN(dt)) return '-'; return `${String(dt.getDate()).padStart(2,'0')}-${String(dt.getMonth()+1).padStart(2,'0')}-${dt.getFullYear()}`; };
const fmtMoney = n => {
  const v = Number(n || 0);
  return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// ── Schedule bucket helpers ──────────────────────────────────────────────────
// The Work Breakdown & Schedule grid is divided into buckets (weeks or months)
// spanning the plan's start→end dates. Phases store start/end BUCKET NUMBERS;
// the real dates shown under the grid are computed from the plan start + unit.

// Tolerant date parser: accepts ISO (yyyy-mm-dd, what <input type=date> emits and
// what the backend LocalDate serializes to) AND dd-mm-yyyy / dd/mm/yyyy (what may
// have been stored earlier or come from a display layer). Returns a Date or null.

// How many buckets between start and end for the given unit. Returns 0 when the
// dates are missing/invalid (caller treats 0 as "not set" — no misleading default).

// Label for bucket index n (0-based): weekly → "10 Jun", monthly → "Jun 2026".

const PHASE_SUGGESTIONS = [
  // Engineering & pre-construction
  'Site Survey', 'Topographic Survey', 'Geotechnical Investigation', 'System Simulation',
  'Civil Design', 'Structural Design', 'Electrical Design', 'SLD & Layout Design',
  'Detailed Engineering', 'Statutory Approvals & Permits',
  // Civil
  'Site Mobilization', 'Earthworks, Grading & Drainage', 'Civil Works', 'Foundation & Piling',
  'Boundary & Fencing', 'Site Roads & Access',
  // Mechanical / structures
  'MMS Supply', 'MMS Erection & Alignment', 'Module Mounting Structure',
  'Module Earthing & Row Bonding', 'Mechanical Installation', 'Module Installation',
  // Electrical
  'Procurement', 'DC Cabling', 'AC Cabling', 'Earthing & Lightning Protection',
  'Inverter Installation', 'Transformer Installation', 'Electrical & Cabling',
  'Switchgear & LT/HT Panels', 'SCADA & Monitoring', 'Substation Works',
  // Closeout
  'Testing & Pre-Commissioning', 'Testing & Commissioning', 'Grid Synchronization',
  'Inspection', 'Snag Rectification', 'Documentation & As-Builts', 'Handover',
  'Other',
];

// ISO date (yyyy-mm-dd) for the START of bucket index n (0-based). Used to
// auto-fill finance line dates from a phase's bucket position.

// Fractional grid position (0..1) of a calendar date across the plan span,
// for placing single-date markers on the same week/month grid. null if undatable.
const dateToGridFraction = (startStr, endStr, dateStr) => {
  const s = parseDate(startStr), e = parseDate(endStr), d = parseDate(dateStr);
  if (!s || !e || !d || e <= s) return null;
  const f = (d - s) / (e - s);
  return Math.max(0, Math.min(1, f));
};

const TABS = [
  { k: 'overview',   l: 'Overview' },
  { k: 'bom',        l: 'BOM / BOQ' },
  { k: 'technical',  l: 'Technical Scope' },
  { k: 'commercial', l: 'Financial / Commercial' },
  { k: 'progress',   l: 'Progress' },
];

const OrderBookDetailPage = ({ orderBook, user, onBack, onEdit, showSuccess, showError }) => {
  const [activeTab, setActiveTab] = useState('overview');
  const switchTab = (k) => setActiveTab(k);

  // Always start on Overview when a (different) order book is opened — covers the
  // case where the component stays mounted and only the orderBook prop changes.
  useEffect(() => { setActiveTab('overview'); }, [orderBook.id]);

  const authHeaders = { 'User-Id': user.id, 'User-Role': user.role };

  // Live project context (read-only). The order book and its project are one
  // logical unit; project-level fields (status, budget, dates, progress) are
  // owned by the Project module and surfaced here without local copies, so they
  // never drift. Degrades silently when no project is linked or the fetch fails.
  const [project, setProject] = useState(null);
  useEffect(() => {
    if (!orderBook.projectId) { setProject(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/projects/${encodeURIComponent(orderBook.projectId)}`, {
          credentials: 'include', headers: authHeaders,
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setProject(data || null);
      } catch { /* non-fatal: strip just won't render */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderBook.projectId]);

  const projStatus   = project?.status ? String(project.status).replace(/_/g, ' ') : null;
  const projProgress = project?.progressPercentage != null ? Number(project.progressPercentage) : null;

  return (
    <div className="obd-page">
      {/* Top bar */}
      <div className="obd-topbar">
        <button className="obd-back-btn" onClick={onBack}><ArrowLeft size={16} /> Back to Order Book</button>
        <div className="obd-breadcrumb">
          <span>Order Book</span>
          <span className="obd-bc-sep">&gt;</span>
          <span className="obd-bc-active">{orderBook.orderBookNo}</span>
        </div>
      </div>

      {/* Header card */}
      <div className="obd-header-card">
        <div className="obd-header-main">
          <h1 className="obd-title">{orderBook.orderTitle}</h1>
          <div className="obd-subline">
            <span className="obd-chip">{orderBook.orderBookNo}</span>
            <span className={`obd-status obd-status--${String(orderBook.status || '').toLowerCase().replace(/\s+/g,'-')}`}>{orderBook.status || '-'}</span>
            {orderBook.projectId
              ? <span className="obd-chip obd-chip--proj">Project: {orderBook.projectId}</span>
              : <span className="obd-chip obd-chip--warn">No project linked</span>}
          </div>
        </div>
        <div className="obd-header-meta">
          <div><label>Customer</label><span>{orderBook.customerName || '-'}</span></div>
          <div><label>Order Date</label><span>{fmtDate(orderBook.orderDate)}</span></div>
          <div><label>Total Value</label><span>{fmtMoney(orderBook.totalAmount)}</span></div>
        </div>
      </div>

      {/* Live project context — read-only; owned by the Project module */}
      {project && (
        <div className="obd-project-strip">
          <span className="obd-project-strip-tag">Linked Project</span>
          <div className="obd-project-strip-items">
            <div><label>Name</label><span>{project.projectName || orderBook.projectId}</span></div>
            <div><label>ID</label><span>{project.projectUniqueId || orderBook.projectId}</span></div>
            {projStatus && <div><label>Status</label><span>{projStatus}</span></div>}
            {project.budget != null && <div><label>Project Budget</label><span>{fmtMoney(project.budget)}</span></div>}
            {project.startDate && <div><label>Planned Start</label><span>{fmtDate(project.startDate)}</span></div>}
            {project.endDate && <div><label>Planned End</label><span>{fmtDate(project.endDate)}</span></div>}
            {projProgress != null && (
              <div className="obd-project-strip-progress">
                <label>Progress</label>
                <div className="obd-mini-progress"><div className="obd-mini-progress-fill" style={{ width: `${Math.min(100, projProgress)}%` }} /></div>
                <span className="obd-mini-progress-label">{projProgress}%</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="obd-tabbar">
        {TABS.map(t => (
          <button key={t.k} className={`obd-tab${activeTab === t.k ? ' active' : ''}`} onClick={() => switchTab(t.k)}>{t.l}</button>
        ))}
      </div>

      <div className="obd-tab-body">
        {activeTab === 'overview'   && <OverviewTab   orderBook={orderBook} authHeaders={authHeaders} onEdit={onEdit} showSuccess={showSuccess} showError={showError} />}
        {activeTab === 'technical'  && <TechnicalTab  orderBook={orderBook} authHeaders={authHeaders} showSuccess={showSuccess} showError={showError} />}
        {activeTab === 'commercial' && <CommercialTab orderBook={orderBook} authHeaders={authHeaders} showSuccess={showSuccess} showError={showError} />}
        {activeTab === 'bom'        && <BomTab        orderBook={orderBook} authHeaders={authHeaders} showSuccess={showSuccess} showError={showError} />}
        {activeTab === 'progress'   && <ProgressTab   orderBook={orderBook} authHeaders={authHeaders} showError={showError} />}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
//  OVERVIEW TAB
// ─────────────────────────────────────────────────────────────────────────────
const OverviewTab = ({ orderBook, authHeaders, onEdit, showError, showSuccess }) => {
  const [items, setItems] = useState(orderBook.items || []);
  const [loading, setLoading] = useState(!orderBook.items);

  // ── Site location (moved here from Technical Scope; persisted on the scope row) ──
  const [siteLocation, setSiteLocation] = useState('');
  const [siteLat, setSiteLat] = useState('');
  const [siteLng, setSiteLng] = useState('');
  const [savingLoc, setSavingLoc] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/projects/${orderBook.id}/scope`, { credentials: 'include', headers: authHeaders });
        const data = await res.json();
        if (data.success && data.data && data.data.scope) {
          const s = data.data.scope;
          setSiteLocation(s.siteLocation || '');
          setSiteLat(s.siteLat == null ? '' : String(s.siteLat));
          setSiteLng(s.siteLng == null ? '' : String(s.siteLng));
        }
      } catch { /* non-fatal: location card just starts empty */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderBook.id]);

  const saveLocation = async () => {
    setSavingLoc(true);
    try {
      const body = {
        siteLocation: siteLocation || null,
        siteLat: siteLat === '' || siteLat == null ? null : Number(siteLat),
        siteLng: siteLng === '' || siteLng == null ? null : Number(siteLng),
      };
      const res = await fetch(`${API_BASE_URL}/projects/${orderBook.id}/site-location`, {
        method: 'PATCH', credentials: 'include',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) { if (showSuccess) showSuccess('Site location saved'); }
      else showError(data.message || 'Failed to save site location');
    } catch { showError('Failed to save site location'); }
    finally { setSavingLoc(false); }
  };

  useEffect(() => {
    if (orderBook.items) { setItems(orderBook.items); return; }
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE_URL}/projects/${orderBook.id}/items`, { credentials: 'include', headers: authHeaders });
        const data = await res.json();
        if (data.success) setItems(data.data || []);
      } catch (e) { showError('Failed to load items'); }
      finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderBook.id]);

  // PO file viewer modal — fetch as blob (auth headers), preview in an iframe,
  // with Download + Open-in-new-tab controls. Mirrors the original OrderBook
  // file viewer so behaviour is consistent across the app.
  const [showViewer, setShowViewer] = useState(false);
  const [viewerUrl, setViewerUrl] = useState('');
  const [viewerLoading, setViewerLoading] = useState(false);
  const viewerBlobRef = useRef(null);
  const poExt = (orderBook.poFileName || '').split('.').pop().toLowerCase();
  const isPdf = poExt === 'pdf';
  const isImg = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(poExt);

  const fetchPoBlob = async (forceDownload) => {
    const url = `${API_BASE_URL}/projects/${orderBook.id}/download-po${forceDownload ? '?forceDownload=true' : ''}`;
    const res = await fetch(url, { credentials: 'include', headers: authHeaders });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    return res.blob();
  };

  const openViewer = async () => {
    if (viewerBlobRef.current) { URL.revokeObjectURL(viewerBlobRef.current); viewerBlobRef.current = null; }
    setViewerUrl('');
    setViewerLoading(true);
    setShowViewer(true);
    try {
      const blob = await fetchPoBlob(false);
      const blobUrl = URL.createObjectURL(blob);
      viewerBlobRef.current = blobUrl;
      setViewerUrl(blobUrl);
    } catch (e) {
      showError('Could not load the file. Try downloading it instead.');
      setShowViewer(false);
    } finally {
      setViewerLoading(false);
    }
  };

  const closeViewer = () => {
    setShowViewer(false);
    if (viewerBlobRef.current) { URL.revokeObjectURL(viewerBlobRef.current); viewerBlobRef.current = null; }
    setViewerUrl('');
  };

  const downloadPo = async () => {
    try {
      const blob = await fetchPoBlob(true);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = orderBook.poFileName || 'attachment';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { showError('Failed to download the file'); }
  };

  // Clean up the blob URL on unmount.
  useEffect(() => () => { if (viewerBlobRef.current) URL.revokeObjectURL(viewerBlobRef.current); }, []);

  const poIcon = isPdf ? <FaFilePdf /> : isImg ? <FaFileImage /> : <FaFileAlt />;

  return (
    <>
    <div className="obd-grid">
      <div className="obd-card">
        <h4 className="obd-card-title">Order Details</h4>
        <div className="obd-kv-grid">
          <div><label>Group</label><span>{orderBook.groupName || '-'}</span></div>
          <div><label>Sub Group</label><span>{orderBook.subGroupName || '-'}</span></div>
          <div><label>Expected Delivery</label><span>{fmtDate(orderBook.expectedDeliveryDate)}</span></div>
          <div><label>PO Number</label><span>{orderBook.poNumber || '-'}</span></div>
          <div><label>PO Date</label><span>{fmtDate(orderBook.poDate)}</span></div>
          <div><label>Subtotal</label><span>{fmtMoney(orderBook.subtotal)}</span></div>
          <div><label>Tax</label><span>{fmtMoney(orderBook.taxAmount)}</span></div>
          <div><label>Total</label><span>{fmtMoney(orderBook.totalAmount)}</span></div>
          <div><label>Advance</label><span>{fmtMoney(orderBook.advanceAmount)}</span></div>
          <div><label>Balance</label><span>{fmtMoney(orderBook.balanceAmount)}</span></div>
        </div>
        {orderBook.orderDescription && <p className="obd-desc">{orderBook.orderDescription}</p>}
        <div className="obd-card-actions">
          {orderBook.poFileName && (
            <button className="obd-btn obd-btn--ghost" onClick={openViewer}>
              {poIcon} View PO File
            </button>
          )}
          {onEdit && <button className="obd-btn obd-btn--ghost" onClick={() => onEdit(orderBook)}>Edit Order</button>}
        </div>
      </div>

      <div className="obd-card obd-card--wide">
        <h4 className="obd-card-title">Line Items</h4>
        {loading ? <div className="obd-empty">Loading items…</div> : (
          items.length === 0 ? <div className="obd-empty">No items on this order.</div> : (
            <div className="obd-table-wrap">
              <table className="obd-table">
                <thead><tr><th>#</th><th>Item</th><th>Qty</th><th>Unit</th><th>Unit Price</th><th>Line Total</th></tr></thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={it.id || i}>
                      <td>{it.lineNo || i + 1}</td>
                      <td>{it.itemName}{it.specification ? <span className="obd-spec"> — {it.specification}</span> : null}</td>
                      <td>{Number(it.quantity || 0)}</td>
                      <td>{it.unit || '-'}</td>
                      <td>{fmtMoney(it.unitPrice)}</td>
                      <td>{fmtMoney(it.lineTotal != null ? it.lineTotal : (Number(it.quantity||0) * Number(it.unitPrice||0)))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      <div className="obd-card obd-card--wide">
        <div className="obd-card-head">
          <h4 className="obd-card-title">Site Location</h4>
          <button className="obd-btn obd-btn--primary" onClick={saveLocation} disabled={savingLoc}>
            <Save size={14} /> {savingLoc ? 'Saving…' : 'Save Location'}
          </button>
        </div>
        <LocationPicker
          className="obd-field obd-field--full"
          address={siteLocation}
          lat={siteLat}
          lng={siteLng}
          onChange={({ address, lat, lng }) => {
            if (address !== undefined) setSiteLocation(address);
            if (lat !== undefined) setSiteLat(lat == null ? '' : String(lat));
            if (lng !== undefined) setSiteLng(lng == null ? '' : String(lng));
          }}
          showError={showError}
        />
      </div>
    </div>

    {showViewer && (
      <div className="obd-fv-overlay" onClick={closeViewer}>
        <div className="obd-fv-modal" onClick={e => e.stopPropagation()}>
          <div className="obd-fv-header">
            <div className="obd-fv-title" title={orderBook.poFileName}>
              {poIcon}<span>{orderBook.poFileName || 'Attached File'}</span>
            </div>
            <div className="obd-fv-controls">
              <button type="button" className="obd-btn obd-btn--ghost" onClick={downloadPo} title="Download">
                <FaFileDownload /> Download
              </button>
              <a className="obd-btn obd-btn--ghost" href={viewerUrl || '#'} target="_blank" rel="noopener noreferrer"
                 title="Open in new tab"
                 style={{ pointerEvents: viewerUrl ? 'auto' : 'none', opacity: viewerUrl ? 1 : 0.5 }}>
                <FaExternalLinkAlt /> Open in new tab
              </a>
              <button className="obd-fv-close" onClick={closeViewer}>×</button>
            </div>
          </div>
          <div className="obd-fv-body">
            {viewerLoading && <div className="obd-fv-loading">Loading file…</div>}
            {!viewerLoading && isPdf && viewerUrl && (
              <iframe src={viewerUrl} title={orderBook.poFileName} className="obd-fv-iframe" />
            )}
            {!viewerLoading && isImg && viewerUrl && (
              <div className="obd-fv-img-wrap"><img src={viewerUrl} alt={orderBook.poFileName} className="obd-fv-img" /></div>
            )}
            {!viewerLoading && !isPdf && !isImg && viewerUrl && (
              <div className="obd-fv-unsupported">
                {poIcon}
                <p>This file type can't be previewed in the browser.</p>
                <button type="button" className="obd-btn obd-btn--primary" onClick={downloadPo}>
                  <FaFileDownload /> Download to View
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    )}
    </>
  );
};
// ─────────────────────────────────────────────────────────────────────────────
const blankPhase = (seq) => ({
  id: null, seqNo: seq, phaseName: '', phaseDescription: '',
  startWeek: '', endWeek: '', customName: false,
  status: 'Not Started', progressPercent: 0,
  weightPct: '',   // absolute project weight %; auto-summed from sub-items when present
  subItems: [],    // sub-work-packages under this activity
  expanded: false, // UI-only: collapse/expand sub-items
});

// A project phase's scope node: the shared definition fields (via blankNode, which
// also mints the node's id) plus the EXECUTION fields only a running project has.
// The id is what progress and budget key off — never the name, which two nodes in
// different branches may legitimately share. See utils/scopeTree.js.
const blankSubItem = () => ({
  ...blankNode(),
  status: 'Not Started', progressPercent: 0,
  startDate: '', endDate: '', startWeek: '', endWeek: '', customName: false,
});

const PHASE_STATUSES = ['Not Started', 'In Progress', 'Completed', 'Delayed', 'On Hold'];
// Manual statuses that OVERRIDE the progress-driven auto status (they stick until
// the user changes them). The rest (Not Started / In Progress / Completed) are
// auto-derived from a phase's actual progress in DETAILED tracking.
const MANUAL_PHASE_STATUSES = ['Delayed', 'On Hold'];

// Parse a free-text capacity ("100 kW", "2.5 MWp", "80") → kW number, or null.
// Mirrors backend CapacityUtil.parseValueUnit: MW/MWp × 1000; kW/kWp/bare = kW.
const parseCapacityKw = (s) => {
  if (s == null) return null;
  const m = String(s).trim().match(/^([\d.,\s]*)\s*(.*)$/);
  if (!m) return null;
  const num = parseFloat((m[1] || '').replace(/[,\s]/g, ''));
  if (!Number.isFinite(num)) return null;
  const unit = (m[2] || '').trim().toLowerCase();
  return unit.startsWith('mw') ? num * 1000 : num;
};

export const TechnicalTab = ({ orderBook, authHeaders, showSuccess, showError }) => {
  const [scope, setScope] = useState({
    projectType: '', scopeOfWork: '', technicalNotes: '',
    systemCapacity: '', siteLocation: '', siteLat: '', siteLng: '',
    plannedStartDate: '', plannedEndDate: '', totalPlannedWeeks: '', planUnit: 'WEEK',
    trackingMode: 'DETAILED',
  });
  const [phases, setPhases] = useState([]);
  // Where this scope came from: 'LEAD_COPY' when it was imported from the lead behind
  // the order book's proposal, 'TEMPLATE' once saved otherwise, null before any save
  // or after a reset. Drives the Suggest / Reset buttons below.
  const [scopeSource, setScopeSource] = useState(null);
  // Detailed per-period progress: map keyed `${phaseId}|${subKey||''}|${periodNo}` → {plannedPct, actualPct}
  const [progress, setProgress] = useState({});
  const [savingProgress, setSavingProgress] = useState(false);
  const [weekModalLeaf, setWeekModalLeaf] = useState(null); // {phaseId, subKey, label, ...} or null
  // Which phase's breakdown is open in ScopeBreakdownModal — a row INDEX, or
  // null. Replaces the old per-row `p.expanded` inline toggle: a deep tree
  // rendered as extra <tr>s squeezed under the phase row (in the SAME table,
  // at whatever indentation it reached) is exactly what made this table look
  // congested. Only one breakdown is viewable at a time now, which a modal
  // makes the natural shape rather than a loss — the old inline view was
  // already unreadable past one phase expanded at any useful depth.
  const [openBreakdown, setOpenBreakdown] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Index of a phase row the user just switched to "type your own". Only that
  // row auto-focuses; rows loaded from the backend must NOT, or the browser
  // scrolls their input into view on mount and jumps past the top of the tab.
  const [focusRow, setFocusRow] = useState(null);
  // Activity/item suggestions = built-in list + names users have typed before (backend).
  const [extraSuggestions, setExtraSuggestions] = useState([]);
  const ACTIVITY_OPTIONS = React.useMemo(() => {
    const builtin = PHASE_SUGGESTIONS.filter(s => s !== 'Other');
    const merged = [...builtin];
    extraSuggestions.forEach(n => { if (n && !merged.some(m => m.toLowerCase() === n.toLowerCase())) merged.push(n); });
    return merged;
  }, [extraSuggestions]);
  // Register a user-typed name so it appears in the dropdown next time (shared, backend).
  const registerActivity = (name) => {
    const n = (name || '').trim();
    if (!n || ACTIVITY_OPTIONS.some(m => m.toLowerCase() === n.toLowerCase())) return;
    setExtraSuggestions(prev => prev.includes(n) ? prev : [...prev, n]);
    fetch(`${API_BASE_URL}/order-book/scope-activities`, {
      method: 'POST', credentials: 'include',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: n }),
    }).catch(() => {});
  };
  const { confirmModal, showConfirmation } = useConfirmationModal();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/projects/${orderBook.id}/scope`, { credentials: 'include', headers: authHeaders });
      const data = await res.json();
      if (data.success) {
        const s = data.data.scope;
        // Auto-fill Project Type from the order book's sub-group (which IS the
        // project type in this system, e.g. Solar_Rooftop / Solar_ground_mounted).
        // Only used as a default — a saved non-empty projectType always wins, so
        // a user edit is never overwritten.
        const subGroupType = orderBook.subGroupName || '';
        setScopeSource(s?.scopeSource || null);
        if (s) setScope({
          projectType: s.projectType || subGroupType, scopeOfWork: s.scopeOfWork || '',
          technicalNotes: s.technicalNotes || '', systemCapacity: s.systemCapacity || '',
          siteLocation: s.siteLocation || '',
          siteLat: s.siteLat != null ? String(s.siteLat) : '', siteLng: s.siteLng != null ? String(s.siteLng) : '',
          plannedStartDate: s.plannedStartDate || '', plannedEndDate: s.plannedEndDate || '',
          totalPlannedWeeks: s.totalPlannedWeeks || '', planUnit: s.planUnit || 'WEEK',
          trackingMode: 'DETAILED',
        });
        else setScope(prev => ({ ...prev, projectType: prev.projectType || subGroupType }));
        setPhases((data.data.phases || []).map(p => {
          let subItems = Array.isArray(p.subItems) ? p.subItems : [];
          if (subItems.length > 0) {
            const sum = subItems.reduce((s, si) => s + (Number(si.weightPct) || 0), 0);
            const anyManual = subItems.some(si => si.weightManual === true);
            // Legacy scopes stored sub-item weights as ABSOLUTE project %, so a
            // group won't sum to ~100. If nothing was flagged manual and the
            // group is off-target, re-distribute equally (100 / count).
            if (!anyManual && Math.abs(sum - 100) > 0.5) {
              const each = Number((100 / subItems.length).toFixed(4));
              subItems = subItems.map(si => ({ ...si, weightPct: each, weightManual: false }));
            } else {
              subItems = subItems.map(si => ({ ...si, weightManual: si.weightManual === true }));
            }
            // Then hydrate the whole TREE: fills in missing fields at every depth,
            // rebalances each group, and gives an id to any node that arrived
            // without one. That last part is what carries a project saved before
            // the node-id migration — its nodes become id-keyed on the next save,
            // and until then the name fallback in the merge still finds them.
            subItems = hydrateTree(subItems);
          }
          return {
            id: p.id, seqNo: p.seqNo, phaseName: p.phaseName, phaseDescription: p.phaseDescription || '',
            startWeek: p.startWeek ?? '', endWeek: p.endWeek ?? '',
            // The phase span the client never used to send back (see save).
            plannedStartDate: p.plannedStartDate || '',
            plannedEndDate: p.plannedEndDate || '',
            planUnit: p.planUnit || '',
            customName: !PHASE_SUGGESTIONS.includes(p.phaseName),
            status: p.status || 'Not Started', progressPercent: p.progressPercent != null ? Number(p.progressPercent) : 0,
            plannedProgressPct: p.plannedProgressPct != null ? Number(p.plannedProgressPct) : '',
            weightPct: p.weightPct != null ? Number(p.weightPct) : '',
            subItems,
            expanded: false,
          };
        }));
        // Build progress map from periods
        const pm = {};
        (data.data.progressPeriods || []).forEach(pp => {
          const key = `${pp.phaseId}|${pp.subItemKey || ''}|${pp.periodNo}`;
          pm[key] = { plannedPct: Number(pp.plannedPct) || 0, actualPct: Number(pp.actualPct) || 0 };
        });
        setProgress(pm);
      }
    } catch (e) { showError('Failed to load technical scope'); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderBook.id]);

  useEffect(() => { load(); }, [load]);

  // Load shared, user-contributed activity suggestions once.
  useEffect(() => {
    fetch(`${API_BASE_URL}/order-book/scope-activities`, { credentials: 'include', headers: authHeaders })
      .then(r => r.json())
      .then(d => { if (d.success && Array.isArray(d.data?.names)) setExtraSuggestions(d.data.names); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A scope imported from the lead hides "Suggest plan" — the rows are already the
  // real thing and replacing them with a template would be a step backwards. Only
  // while rows actually exist: an import that produced nothing leaves Suggest visible.
  const isLeadDerived = scopeSource === 'LEAD_COPY' && phases.length > 0;

  // "Reset scope" — the way back out of a bad import. Clears the rows and the
  // lead-derived marker, which re-enables Suggest. BOM lines are deliberately kept.
  const resetScope = async () => {
    const ok = await showConfirmation({
      title: 'Clear scope', type: 'alert',
      message: 'This removes every scope row and its progress, and re-enables "Suggest plan". '
             + 'BOM lines are kept, but they lose their link to these rows and move to "General".',
      confirmText: 'Yes, Clear', cancelText: 'Cancel',
    });
    if (!ok) return;
    try {
      const res = await fetch(`${API_BASE_URL}/projects/${orderBook.id}/scope/items`, {
        method: 'DELETE', credentials: 'include', headers: authHeaders,
      });
      const data = await res.json();
      if (!data.success) { showError(data.message || 'Failed to clear scope'); return; }
      showSuccess('Scope cleared');
      await load();
    } catch { showError('Failed to clear scope'); }
  };

  // "Suggest plan" — pulls the standardised scope template for this project's
  // sub-group (GET /scope/suggest?target=scope), exactly like the Leads page.
  // Only the row SOURCE changed vs the old default-plan: the bucket-distribution
  // across the plan duration below is unchanged, as are all downstream columns.
  // ── Re-suggest: fold the suggested plan onto what is already here ────────────
  //
  // This used to be a wholesale setPhases() with id:null on every row, which made
  // the next save delete every phase AND its progress periods (they are keyed by
  // phase_id). Matching by name keeps a phase that is still in the standard, so
  // its weekly progress, its planned budget and its BOM links survive.
  //
  // The breakdown matters even more here, and it is now a TREE. Each node carries a
  // stable id, and project_progress_periods.sub_item_key plus the planned-budget
  // merge in ProjectDetailService.saveScopeBudgets both key off THAT id — not off
  // the name, which two nodes in different branches may legitimately share. So a
  // matched node keeps its id and its execution fields, and only the definition
  // (description / weight) is refreshed from the standard.
  //
  // Matching happens WITHIN EACH PARENT and then recurses, by id first and by name
  // as the fallback that carries pre-migration nodes through their first merge.
  // Matching globally by name would pair the "Excavation" under Civil with the one
  // under Substation and move a year of progress into the wrong branch.
  //
  // mergeTree (utils/scopeTree.js) is that rule, shared with the lead tab and
  // mirrored server-side by ScopeSubItems.mergePreservingExecutionData.
  const nameKey = (v) => String(v == null ? "" : v).trim().toLowerCase();

  const mergeSuggestedSubs = (prior, incoming) => mergeTree(prior, incoming);

  const loadDefaultPlan = async () => {
    if (phases.length) {
      const ok = await showConfirmation({
        title: 'Replace schedule', type: 'alert',
        message: 'This replaces the current rows with the suggested plan for this sub-group. '
          + 'Activities and sub-items whose names still match are kept, along with their progress, dates and budgets. Continue?',
        confirmText: 'Yes, Replace', cancelText: 'Cancel',
      });
      if (!ok) return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/projects/${orderBook.id}/scope/suggest?target=scope`, { credentials: 'include', headers: authHeaders });
      const data = await res.json();
      if (data.success) {
        // Template scope lines → parent rows: activity→phaseName, specification→phaseDescription.
        const tmpl = data.data.scopeItems || [];
        if (!tmpl.length) {
          const w = (data.data.warnings || [])[0];
          showError(w?.message || 'No standard template for this project’s sub-group yet. Add rows manually, or create a template.');
          return;
        }
        // Distribute the template phases across the ACTUAL plan duration so a
        // short plan doesn't get phases at months 1–12. If dates aren't set,
        // keep no bucket (blank), same as before.
        const u = scope.planUnit || 'WEEK';
        const dur = bucketCount(scope.plannedStartDate, scope.plannedEndDate, u);
        let mapped;
        // The template defines each activity's share of project progress, so the
        // suggested rows carry it through instead of falling back to the equal
        // split at save time. The backend guarantees every line has one.
        // Weights stay fully editable here afterwards.
        // Existing phases by name, so a re-suggest can keep the ones still standard.
        const priorByKey = new Map();
        phases.forEach(ph => {
          const k = nameKey(ph.phaseName);
          if (k && !priorByKey.has(k)) priorByKey.set(k, ph);
        });

        if (dur > 0 && tmpl.length > 0) {
          mapped = tmpl.map((p, i) => {
            // Phase i spans its proportional slice of [1..dur].
            const start = Math.floor((i / tmpl.length) * dur) + 1;
            const end = Math.max(start, Math.floor(((i + 1) / tmpl.length) * dur));
            return { id: null, seqNo: i + 1, phaseName: p.activity, phaseDescription: p.specification || '', startWeek: start, endWeek: end, weightPct: p.weightPct != null ? Number(p.weightPct) : '', customName: !PHASE_SUGGESTIONS.includes(p.activity) };
          });
        } else {
          mapped = tmpl.map((p, i) => ({
            id: null, seqNo: i + 1, phaseName: p.activity, phaseDescription: p.specification || '',
            startWeek: '', endWeek: '',
            weightPct: p.weightPct != null ? Number(p.weightPct) : '',
            customName: !PHASE_SUGGESTIONS.includes(p.activity),
          }));
        }

        // Carry the template's sub-item breakdown onto each row, and restore
        // anything a matched phase/sub-item had already accumulated.
        mapped = mapped.map((row, i) => {
          const prior = priorByKey.get(nameKey(row.phaseName));
          const subs = mergeSuggestedSubs(prior ? prior.subItems : [], tmpl[i].subItems);
          if (!prior) return { ...row, subItems: subs, expanded: false };
          return {
            ...prior,                     // id, dates, status, progress, budget
            seqNo: row.seqNo,
            phaseName: prior.phaseName,   // stored spelling is the identity
            phaseDescription: row.phaseDescription || prior.phaseDescription,
            startWeek: prior.startWeek !== '' && prior.startWeek != null ? prior.startWeek : row.startWeek,
            endWeek: prior.endWeek !== '' && prior.endWeek != null ? prior.endWeek : row.endWeek,
            weightPct: row.weightPct === '' ? prior.weightPct : row.weightPct,
            customName: prior.customName,
            subItems: subs,
            expanded: false,
          };
        });
        setPhases(mapped);
      }
    } catch { showError('Failed to load suggested plan'); }
  };

  const loadFromLineItems = async () => {
    if (phases.length) {
      const ok = await showConfirmation({
        title: 'Load line items', type: 'confirm',
        message: 'Add the order book line items as schedule rows? Existing rows are kept.',
        confirmText: 'Yes, Add', cancelText: 'Cancel',
      });
      if (!ok) return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/projects/${orderBook.id}/items`, { credentials: 'include', headers: authHeaders });
      const data = await res.json();
      if (data.success) {
        const items = (data.data || []).map((it) => {
          const qty = Number(it.quantity || 0);
          const name = qty ? `${it.itemName} (${qty}${it.unit ? ' ' + it.unit : ''})` : it.itemName;
          return { id: null, phaseName: name, phaseDescription: it.specification || '', startWeek: '', endWeek: '', customName: true };
        });
        setPhases(prev => [...prev, ...items].map((p, idx) => ({ ...p, seqNo: idx + 1 })));
      }
    } catch { showError('Failed to load line items'); }
  };

  const updatePhase = (i, field, val, extra) => setPhases(prev => prev.map((p, idx) => idx === i ? { ...p, [field]: val, ...(extra || {}) } : p));

  // ── Sub-item weights: now the SHARED engine, applied per parent at any depth ──
  //
  // This file used to carry its own copy of the weight rules (distributeSubWeights /
  // snapSubGroup / resetSubWeights) while the templates and lead screens used
  // utils/scopeWeights.js. The two had already drifted — this one snapped on blur
  // within ±0.5 and gated at ±0.01, the other absorbed 0.005 per row — so the same
  // breakdown could save on one screen and be rejected on another. Nesting made
  // keeping both untenable: every rule would have needed writing twice, at every
  // level. Both now run utils/scopeWeights.js through utils/scopeTree.js.
  //
  // What changes for a user here: the blur-snap is gone, because it is no longer
  // needed — typing a weight rebalances the other rows immediately, so the group
  // is never left off 100 to be snapped back later.
  const updateSubTree = (i, next) => updatePhase(i, "subItems", next);

  /**
   * Set one field on the node with this id, wherever it is in the tree.
   *
   * Addressed by ID rather than by index because the progress inputs are rendered
   * by the recursive editor, which knows the node but not the path back to the
   * phase. An index would also be wrong the moment a branch above it was
   * reordered — the id is the only stable handle.
   */
  const setNodeField = (nodes, id, key, value) => (nodes || []).map((n) => (
    n.id === id
      ? { ...n, [key]: value }
      : { ...n, children: setNodeField(n.children, id, key, value) }
  ));

  /**
   * The breakdown tree as the save payload, recursively.
   *
   * Drops unnamed nodes at every level (a half-typed row is not scope), and writes
   * each node's progress from the right source: a LEAF from its own typed value or
   * its weekly cells, a PARENT from the roll-up of its children. `children` is
   * omitted for a leaf so it serialises exactly as it did before nesting existed.
   */
  const serialiseNodes = (nodes, p) => (nodes || [])
    .filter(si => si.name && si.name.trim())
    .map(si => {
      const kids = kidsOf(si);
      const children = serialiseNodes(si.children, p);
      const actual = kids.length
        ? rollUpNodes(kids, p, leafActualVal)
        : (isSimple ? (Number(si.progressPercent) || 0) : leafActual(leafForSub(p, si)));
      const planned = kids.length
        ? rollUpNodes(kids, p, leafPlannedVal)
        : (isSimple
          ? (si.plannedProgressPct === '' || si.plannedProgressPct == null ? null : Number(si.plannedProgressPct))
          : (si.plannedProgressPct ?? null));
      return {
        ...si,
        progressPercent: isSimple ? actual : Math.round(actual),
        plannedProgressPct: planned,
        ...(children.length ? { children } : { children: undefined }),
      };
    });

  /** A parent node's status, read off its own breakdown rather than typed. */
  const derivedNodeStatus = (node, p) => {
    const a = rollUpNodes(kidsOf(node), p, leafActualVal);
    if (a >= 99.995) return "Completed";
    return a > 0 ? "In Progress" : "Not Started";
  };

  // ── Per-node scheduling ────────────────────────────────────────────────────
  //
  // A node that carries a span and a unit defines a GRID of week or month periods,
  // and everything beneath it is placed on that grid. A node without one inherits
  // its nearest scheduled ancestor's, falling back to the project header — which is
  // exactly today's behaviour, so a project nobody has scheduled per-node behaves
  // as it always did.
  const projectGrid = nodeGrid({
    plannedStartDate: scope.plannedStartDate,
    plannedEndDate: scope.plannedEndDate,
    planUnit: scope.planUnit,
  });
  /** The grid a PHASE's children sit on: the phase's own, else the project's. */
  const phaseGrid = (p) => nodeGrid(p) || projectGrid;
  /** The grid a node's children sit on: its own, else whatever it inherited. */
  const gridUnder = (node, inherited) => nodeGrid(node) || inherited;

  const addSubItem = (i) => {
    const p = phases[i];
    updatePhase(i, "subItems", distributeWeights([...(p.subItems || []), blankNode()]), { expanded: true });
  };

  /**
   * Every sub-item edit routes through here: the editor hands back the whole tree
   * for this phase, already rebalanced within whichever group changed.
   */
  const onSubTreeChange = (i, next) => updateSubTree(i, next);

  // Reset a parent's DIRECT sub-item weights back to an equal auto-split. Deeper
  // groups have their own Reset inside the editor, next to the group they affect.
  const resetSubWeights = (i) => {
    const p = phases[i];
    updatePhase(i, "subItems", resetWeights(p.subItems || []));
  };

  const addPhase    = () => setPhases(prev => [...prev, blankPhase(prev.length + 1)]);

  // Pull BOM/BOQ lines in as sub-items under a phase, segregating the parent's
  // bucket range (start..end) across them so each sub-item gets its own slice.
  const pullBomIntoPhase = async (i) => {
    const p = phases[i];
    const ps = num(p.startWeek) || 1;
    const pe = num(p.endWeek) || ps;
    if (!p.startWeek || !p.endWeek) {
      showError('Set this phase\u2019s start and end first, so dates can be split across BOM items.');
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/projects/${orderBook.id}/bom`, { credentials: 'include', headers: authHeaders });
      const data = await res.json();
      const lines = (data.success && Array.isArray(data.lines)) ? data.lines : (Array.isArray(data.data?.lines) ? data.data.lines : []);
      if (!lines.length) { showError('No BOM / BOQ items found. Add them in the BOM / BOQ tab first.'); return; }

      // Segregate [ps..pe] across N items: contiguous, near-equal slices.
      const span = Math.max(1, pe - ps + 1);
      const nItems = lines.length;
      const slice = (idx) => {
        const s = ps + Math.floor((idx * span) / nItems);
        const e = ps + Math.ceil(((idx + 1) * span) / nItems) - 1;
        return { startWeek: s, endWeek: Math.max(s, e) };
      };
      const bomSubs = lines.map((l, idx) => {
        const { startWeek, endWeek } = slice(idx);
        return {
          ...blankSubItem(),
          name: l.itemName + (l.make ? ` (${l.make})` : ''),
          description: [l.category, l.quantity ? `${l.quantity} ${l.unit || ''}`.trim() : ''].filter(Boolean).join(' \u00b7 '),
          startWeek, endWeek,
          weightPct: '', // left blank by design — user sets weights
        };
      });

      const existing = (p.subItems || []).filter(si => si.name && si.name.trim());
      let mode = 'replace';
      if (existing.length > 0) {
        const append = await showConfirmation({
          title: 'Existing sub-items found', type: 'confirm',
          message: `This phase already has ${existing.length} sub-item(s). Append the ${bomSubs.length} BOM item(s), or replace?`,
          confirmText: 'Append', cancelText: 'Replace',
        });
        mode = append ? 'append' : 'replace';
      }
      const next = mode === 'append' ? [...(p.subItems || []), ...bomSubs] : bomSubs;
      updatePhase(i, 'subItems', next, { expanded: true });
      showSuccess(`${bomSubs.length} BOM item(s) added as sub-items with date ranges.`);
    } catch { showError('Failed to fetch BOM / BOQ items.'); }
  };
  const removePhase = (i) => { setFocusRow(null); setPhases(prev => prev.filter((_, idx) => idx !== i).map((p, idx) => ({ ...p, seqNo: idx + 1 }))); };

  const save = async () => {
    // light validation
    for (const p of phases) {
      if (!p.phaseName.trim()) { showError('Every row needs a name'); return; }
      if (p.startWeek && p.endWeek && Number(p.endWeek) < Number(p.startWeek)) {
        showError(`"${p.phaseName}": end is before start`); return;
      }
    }
    // EVERY group in the tree must total 100% of its own parent, at every level.
    // validateTree walks the whole breakdown and names the specific branch — "Under
    // 'Electrical Works › PV Module': …" — because with several levels, "the
    // sub-item weights are wrong" gives the user nothing to act on. It is the same
    // check the templates and lead screens run, and the server re-runs it.
    for (const p of phases) {
      const check = validateTree(p.subItems, p.phaseName);
      if (!check.ok) { showError(check.error); return; }
      // Dates and periods, per parent, at every level. There was previously NO date
      // validation at all here — the old inputs' min/max were browser-level only, so
      // an end-before-start, or an item scheduled outside its own phase, saved silently.
      const sched = validateSchedule(p.subItems, phaseGrid(p), p.phaseName);
      if (!sched.ok) { showError(sched.error); return; }
    }
    // Item weights drive physical progress, so they must total 100% before the
    // scope is stored. Blank rows already absorb whatever the typed rows leave,
    // so this only fires when the typed weights themselves are wrong — 110%
    // across the rows, or 90% with nothing blank left to make up the difference.
    if (phases.length > 0 && Math.abs(parentWeightSum - 100) > WEIGHT_TOLERANCE) {
      showError(`Item weights total ${fmtW(parentWeightSum)}% — they must add up to 100% before saving.`);
      return;
    }
    setSaving(true);
    try {
      const { siteLat: _sLat, siteLng: _sLng, ...scopeRest } = scope;
      const body = {
        ...scopeRest,
        totalPlannedWeeks: hasDates ? planDuration : null,
        planUnit: scope.planUnit || 'WEEK',
        trackingMode: isSimple ? 'SIMPLE' : 'DETAILED',
        plannedStartDate: scope.plannedStartDate || null,
        plannedEndDate: scope.plannedEndDate || null,
        // Site location is owned by the Overview tab (PATCH /site-location). We
        // still send the currently-loaded copy so this PUT does not blank it,
        // but coerce lat/lng to numbers|null to keep BigDecimal binding happy.
        siteLat: scope.siteLat === '' || scope.siteLat == null ? null : Number(scope.siteLat),
        siteLng: scope.siteLng === '' || scope.siteLng == null ? null : Number(scope.siteLng),
        phases: phases.map((p, i) => ({
          id: p.id, seqNo: i + 1, phaseName: p.phaseName, phaseDescription: p.phaseDescription,
          // A phase's own span, and how it divides for the items under it.
          //
          // These were NEVER SENT before — project_phases.planned_start_date and
          // planned_end_date have existed and been wired end-to-end on the server the
          // whole time, but because the client omitted them, saveScope wrote NULL into
          // both on every single save. A phase could not carry a date at all.
          plannedStartDate: p.plannedStartDate || null,
          plannedEndDate: p.plannedEndDate || null,
          planUnit: p.planUnit || null,
          startWeek: p.startWeek === '' ? null : Number(p.startWeek),
          endWeek: p.endWeek === '' ? null : Number(p.endWeek),
          // Persist the AUTO status (progress drives it; Delayed/On Hold stick).
          status: derivedStatus(p),
          progressPercent: 0, // set below (weekly roll-up in DETAILED, typed value in SIMPLE)
          plannedProgressPct: isSimple
            ? (p.plannedProgressPct === '' || p.plannedProgressPct == null ? null : Number(p.plannedProgressPct))
            : null,
          // Parent weight is editable & stored: the typed weight, else this row's
          // share of what the typed rows left over — the same number the grid
          // showed, so what is saved is what the user validated.
          weightPct: (p.weightPct === '' || p.weightPct == null)
            ? Number(autoSlice.toFixed(4))
            : Number(p.weightPct),
          // The breakdown TREE. Each node's weightPct is RELATIVE to its own parent
          // (sums to 100 within it) at every level, and each keeps its id so its
          // progress rows and its budget stay attached across the save.
          //
          // A node's stored progress depends on whether it is a leaf: a leaf gets
          // its own figure (typed in SIMPLE, summed from its weeks in DETAILED),
          // while a parent gets the roll-up of its children. Writing a parent's own
          // stale number here is what would let the headline disagree with the
          // breakdown underneath it.
          subItems: serialiseNodes(p.subItems, p),
        })).map((pay, i) => {
          // Actual (phaseActualProgress is mode-aware): SIMPLE = typed value / sub-item
          // roll-up; DETAILED = weekly roll-up. Keep decimals in SIMPLE, round in DETAILED.
          pay.progressPercent = isSimple
            ? phaseActualProgress(phases[i])
            : Math.round(phaseActualProgress(phases[i]));
          return pay;
        }),
      };
      const res = await fetch(`${API_BASE_URL}/projects/${orderBook.id}/scope`, {
        method: 'PUT', credentials: 'include',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        // Also persist the week-wise planned/actual cells so "Save Schedule"/"Save
        // Scope" saves EVERYTHING in one click. Phase ids are preserved by the
        // backend upsert, so the cells (keyed by phase id) stay linked.
        try { await persistProgress(); } catch { /* non-fatal — phases already saved */ }
        showSuccess('Technical scope saved');
        load();
      }
      else showError(data.message || 'Save failed');
    } catch { showError('Save failed'); }
    finally { setSaving(false); }
  };

  // Final approval: enforces that all weights total exactly 100% (±tolerance).
  // Saves the scope first so the approved figures are what's persisted.
  const approve = async () => {
    if (!hasAnyWeight) { showError('Enter item weights before approving.'); return; }
    if (!weightOk) {
      showError(`Total weight is ${fmtW(grandTotalWeight)}% — it must equal 100% to approve the full scope.`);
      return;
    }
    const ok = await showConfirmation({
      title: 'Approve full scope', type: 'confirm',
      message: 'All item weights total 100%. Approve and save the complete scope?',
      confirmText: 'Yes, Approve', cancelText: 'Cancel',
    });
    if (!ok) return;
    await save();
    showSuccess('Scope approved — weights total 100%.');
  };

  // ── Excel export — EPC-tracker style sheet built from the scope data ────────
  // Layout mirrors EPC_Hybrid_80MW_Tracker: S.No | Category | Item | Unit | Qty |
  // Weight% | Unit Rate | Package Budget | [per-bucket Plan%/Act%/PlanCap/ActCap] |
  // Cum Plan% | Cum Act% | Total Plan Cap | Total Act Cap. Category = parent phase;
  // its sub-items are the line items beneath it (parent shown as a subtotal band).
  const exportExcel = () => {
    const u = scope.planUnit || 'WEEK';
    const n = nBuckets;
    const bucketHdr = (b) => (u === 'MONTH' ? bucketLabel(scope.plannedStartDate, b, u) : `${unitAbbr} ${b + 1}`);
    // ── Build header rows ──
    const title = `${scope.projectType || orderBook.orderTitle || 'EPC'} — Progress Tracker`;
    const meta = `Project: ${orderBook.orderTitle || ''} | Total Value: ${fmtMoney(projectTotal)} | ` +
                 `Plan: ${scope.plannedStartDate || '—'} to ${scope.plannedEndDate || '—'}`;
    const fixedCols = ['S.No', 'S.No', 'Category', 'Scope of Work Item', 'Unit', 'Qty', 'Weight (%)', 'Unit Rate', 'Package Budget'];
    const perBucket = ['Plan Phy%', 'Act Phy%', 'Plan Budget', 'Act Budget'];
    const cumCols = ['Cum Plan Phy%', 'Cum Act Phy%', 'Total Plan Budget', 'Total Act Budget'];
    const header2 = [...fixedCols.map(() => ''), ...Array.from({ length: n }).flatMap(() => perBucket), ...cumCols];
    const header1 = [...fixedCols, ...Array.from({ length: n }).flatMap((_, b) => [bucketHdr(b), '', '', '']), 'CUMULATIVE', '', '', ''];

    const rows = [[title], [meta], [], header1, header2];
    // Track row roles by index for styling. 0=title,1=meta,2=blank,3=header1,4=header2.
    const rowMeta = ['title', 'meta', 'blank', 'header1', 'header2'];

    // Build a row from real data: per-week planned/actual come from the weeks grid;
    // planned budget comes from Cost-to-Procure (plannedBudget); actual budget left blank.
    // parentNo goes in col A (numbered per parent, blank on sub-item rows),
    // childNo goes in col B (numbered per sub-item, restarting under each parent,
    // blank on parent rows). Pass '' for whichever does not apply to the row.
    const itemRow = (parentNo, childNo, category, name, unit, qty, weightPct, lf, plannedBudgetVal) => {
      const w = num(weightPct);
      const pBudget = num(plannedBudgetVal); // Cost-to-Procure planned budget for this item
      const s = Math.max(1, Math.min(lf.start, n));
      const e = Math.max(s, Math.min(lf.end, n));
      const row = [parentNo, childNo, category, name, unit || 'LS', qty || 1, w, '', pBudget ? Number(pBudget.toFixed(2)) : ''];
      let cumPlan = 0, cumAct = 0;
      for (let b = 1; b <= n; b++) {
        const cell = getCell(lf.phaseId, lf.subKey, b);
        const planPct = num(cell.plannedPct);
        const actPct = num(cell.actualPct);
        if (planPct !== 0 || actPct !== 0) {
          cumPlan += planPct; cumAct += actPct;
          // Planned capital this period = budget × (period planned % / 100). Actual budget left blank.
          const planCap = pBudget ? (pBudget * planPct / 100) : '';
          row.push(planPct || '', actPct || '', planCap === '' ? '' : Number(planCap.toFixed(2)), '');
        } else { row.push('', '', '', ''); }
      }
      // Cumulative columns: cum planned %, cum actual %, total planned budget, actual budget (blank).
      row.push(Number(cumPlan.toFixed(2)), Number(cumAct.toFixed(2)), pBudget ? Number(pBudget.toFixed(2)) : '', '');
      return row;
    };

    // Cycle category band colors across parents (amber, teal, then repeat).
    const bandColors = ['FFB800', '00B0A0', 'C0504D', '8064A2', '4F81BD'];
    let bandIdx = 0;
    let parentNo = 0;
    phases.forEach((p) => {
      const subs = (p.subItems || []).filter(si => si.name && si.name.trim());
      const hasSub = subs.length > 0;
      parentNo += 1;
      if (hasSub) {
        // Colored category band spanning the row.
        rows.push([`${p.phaseName.toUpperCase()} (${fmtW(parentSlice())}%)`]);
        rowMeta.push({ role: 'band', color: bandColors[bandIdx % bandColors.length] });
        bandIdx++;
        // Parent data row: col A = parent number, col B blank, weight = parent
        // slice, carries the parent's own schedule/budget.
        rows.push(itemRow(parentNo, '', p.phaseName, p.phaseName, 'LS', 1, parentSlice(), leafForPhase(p), p.plannedBudget));
        rowMeta.push('phase');
        // Child rows: col A blank, col B = 1..k (restarts under each parent),
        // weight = the sub-item's weight RELATIVE to its parent (sums to 100).
        let childNo = 0;
        subs.forEach((si) => {
          childNo += 1;
          rows.push(itemRow('', childNo, p.phaseName, si.name, '', '', num(si.weightPct), leafForSub(p, si), si.plannedBudget));
          rowMeta.push('item');
        });
      } else {
        // Childless parent: single row, col A numbered, col B blank.
        rows.push(itemRow(parentNo, '', p.phaseName, p.phaseName, 'LS', 1, parentSlice(), leafForPhase(p), p.plannedBudget));
        rowMeta.push('phase');
      }
    });

    // Grand total row — planned budget = sum of Cost-to-Procure budgets; actual budget blank.
    const totalCostBudget = phases.reduce((s, p) => {
      const subs = (p.subItems || []).filter(si => si.name && si.name.trim());
      if (subs.length) return s + subs.reduce((a, si) => a + num(si.plannedBudget), 0);
      return s + num(p.plannedBudget);
    }, 0);
    const totalRow = ['', '', 'GRAND TOTAL', '', '', '', Number(grandTotalWeight.toFixed(4)), '', Number(totalCostBudget.toFixed(2))];
    for (let b = 0; b < n; b++) totalRow.push('', '', '', '');
    totalRow.push(Number(weightedProgress.toFixed(2)), Number(detailedWeightedActual.toFixed(2)),
                  Number(totalCostBudget.toFixed(2)), '');
    rows.push([]); rowMeta.push('blank');
    rows.push(totalRow); rowMeta.push('total');

    const ws = XLSXStyle.utils.aoa_to_sheet(rows);
    const totalCols = fixedCols.length + n * 4 + cumCols.length;

    // ── Palette (matches the attached EPC tracker) ──
    const NAVY = '1F3864', MIDBLUE = '2E5FA3', LIGHTBLUE = 'BDD7EE', ZEBRA = 'F2F2F2';
    const border = { style: 'thin', color: { rgb: 'D9D9D9' } };
    const allBorders = { top: border, bottom: border, left: border, right: border };
    const setCell = (r, c, style) => {
      const addr = XLSXStyle.utils.encode_cell({ r, c });
      if (!ws[addr]) ws[addr] = { t: 's', v: '' };
      ws[addr].s = { ...(ws[addr].s || {}), ...style };
    };
    const fill = (rgb) => ({ fill: { patternType: 'solid', fgColor: { rgb } } });
    const fontW = (bold = true) => ({ font: { bold, color: { rgb: 'FFFFFF' } } });
    const fontDark = (bold = false) => ({ font: { bold, color: { rgb: NAVY } } });
    const center = { alignment: { horizontal: 'center', vertical: 'center', wrapText: true } };

    rowMeta.forEach((rm, r) => {
      const role = typeof rm === 'string' ? rm : rm.role;
      for (let c = 0; c < totalCols; c++) {
        if (role === 'title') {
          setCell(r, c, { ...fill(NAVY), ...fontW(true), alignment: { horizontal: 'left', vertical: 'center' } });
        } else if (role === 'meta') {
          setCell(r, c, { ...fill(MIDBLUE), font: { bold: false, color: { rgb: 'FFFFFF' } }, alignment: { horizontal: 'left' } });
        } else if (role === 'header1' || role === 'header2') {
          const isSub = role === 'header2';
          setCell(r, c, { ...fill(isSub ? LIGHTBLUE : NAVY), font: { bold: true, color: { rgb: isSub ? NAVY : 'FFFFFF' } }, ...center, border: allBorders });
        } else if (role === 'band') {
          setCell(r, c, { ...fill(rm.color), ...fontW(true), border: allBorders });
        } else if (role === 'total') {
          setCell(r, c, { ...fill(NAVY), ...fontW(true), border: allBorders });
        } else if (role === 'phase') {
          // Childless parent phase — a light steel-blue band so it reads as a top-level
          // phase, not a sub-item of the preceding category.
          setCell(r, c, { ...fill('DCE6F1'), font: { bold: true, color: { rgb: NAVY } }, border: allBorders });
        } else if (role === 'item') {
          // zebra striping for readability
          const zebra = (r % 2 === 0);
          setCell(r, c, { ...(zebra ? fill(ZEBRA) : {}), ...fontDark(false), border: allBorders });
        }
      }
    });

    // Merge title and meta across all columns
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } },
    ];
    // Merge each per-bucket header group (4 cols) in header1
    let mc = fixedCols.length;
    for (let b = 0; b < n; b++) { ws['!merges'].push({ s: { r: 3, c: mc }, e: { r: 3, c: mc + 3 } }); mc += 4; }
    ws['!merges'].push({ s: { r: 3, c: mc }, e: { r: 3, c: mc + 3 } }); // CUMULATIVE group
    // Merge each band row across all columns
    rowMeta.forEach((rm, r) => {
      if ((typeof rm === 'object' && rm.role === 'band')) ws['!merges'].push({ s: { r, c: 0 }, e: { r, c: totalCols - 1 } });
    });

    ws['!cols'] = [
      { wch: 6 }, { wch: 6 }, { wch: 20 }, { wch: 28 }, { wch: 6 }, { wch: 6 }, { wch: 10 }, { wch: 9 }, { wch: 14 },
      ...Array.from({ length: n * 4 }).map(() => ({ wch: 9 })),
      { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 },
    ];
    ws['!rows'] = rows.map((_, r) => ({ hpt: r === 0 ? 24 : (r === 3 || r === 4 ? 20 : 16) }));

    const wb = XLSXStyle.utils.book_new();
    XLSXStyle.utils.book_append_sheet(wb, ws, 'EPC Tracker');
    const fname = `EPC_Tracker_${(orderBook.orderBookNo || orderBook.id || 'project')}.xlsx`;
    XLSXStyle.writeFile(wb, fname);
    showSuccess('Excel exported.');
  };

  // Real schedule duration from the dates (0 = dates not set / invalid).
  const unit = scope.planUnit || 'WEEK';
  const planDuration = bucketCount(scope.plannedStartDate, scope.plannedEndDate, unit);
  const hasDates = !!(scope.plannedStartDate && scope.plannedEndDate) && planDuration > 0;
  // The grid and the Start/End dropdowns are bounded by the PLAN DURATION only —
  // never stretched by a phase's stored number. (A template seeded with week
  // numbers up to 12 must not expand a 2-month plan's grid to 12.) When dates
  // aren't set yet, fall back to a small default so the grid still renders.
  const nBuckets = hasDates ? planDuration : 12;
  const unitWord = unit === 'MONTH' ? 'Month' : 'Week';
  const unitAbbr = unit === 'MONTH' ? 'M' : 'Wk';
  // Clamp a stored phase bucket to the visible range for display/positioning.
  const clampBucket = (v) => {
    const n = Number(v);
    if (!n || n < 1) return '';
    return Math.min(n, nBuckets);
  };

  // ── Weighted-average model (mirrors the EPC tracker) ───────────────────────
  // Sub-item weights are ABSOLUTE project-level %; a parent's effective weight is
  // the sum of its sub-items (locked), else the parent's own typed weight. All
  // parents must sum to 100%. Project progress = Σ(leaf weight% × leaf progress%).
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  // ── NEW weight model ───────────────────────────────────────────────────────
  // • Every PARENT gets an equal slice of the whole project:  100 / COUNT(parents).
  // • SUB-ITEM weights are RELATIVE to their parent's slice and sum to 100 within
  //   that parent (auto = 100 / COUNT(sub-items); user may edit, must stay ≤100).
  // • A leaf's ABSOLUTE project weight = parentSlice × (subRelative / 100).
  // • Childless parents are leaves whose absolute weight IS the parent slice.
  const parentCount = phases.length;
  // The fixed project slice each parent owns (equal split of 100%).
  const parentSlice = () => (parentCount > 0 ? 100 / parentCount : 0);
  // A row the user typed a weight into HOLDS that weight; the blank rows share
  // whatever is left of 100 between them. Giving every blank row an equal slice
  // of the WHOLE (the old fallback) pushed the total over 100 the moment one row
  // was typed — five rows with one set to 30 came to 110%.
  const typedWeightSum = phases.reduce((s, p) => s + Math.max(0, num(p.weightPct)), 0);
  const autoWeightCount = phases.filter(p => !(num(p.weightPct) > 0)).length;
  const autoSlice = autoWeightCount > 0 ? Math.max(0, 100 - typedWeightSum) / autoWeightCount : 0;
  // A parent's effective weight: its own typed weight when set, else its share of
  // what the typed rows left over. This is what physical progress (backend) rolls
  // up, so it is also what the total and the approve gate must measure.
  const parentWeightOf = (p) => { const w = num(p.weightPct); return w > 0 ? w : autoSlice; };
  const parentWeightSum = phases.reduce((s, p) => s + parentWeightOf(p), 0);
  const parentWeightsOff = parentCount > 0 && Math.abs(parentWeightSum - 100) > 0.5;
  const hasSubs = (p) => !!(p.subItems && p.subItems.filter(si => si.name != null).length > 0);
  // Sum of a parent's RELATIVE sub-item weights (should be ≤100).
  const subWeightSum = (p) => (p.subItems || []).reduce((s, si) => s + num(si.weightPct), 0);
  // A single sub-item's ABSOLUTE project weight, at DEPTH 1 only. Kept because a
  // few call sites deal exclusively with a phase's direct children; anything that
  // walks the tree uses absWeightOf below, which is the same rule applied down a
  // whole chain of ancestors.
  const absSubWeight = (si) => parentSlice() * (num(si.weightPct) / 100);
  // The breakdown is now a TREE of any depth, so a node's absolute project weight
  // is its parent's absolute weight × its own share of that parent — the same rule
  // as before, applied once per level instead of exactly once. The chain starts at
  // parentSlice(), so a depth-1 node comes out identical to absSubWeight(si) and
  // nothing about the existing single-level numbers moves.
  const absWeightOf = (node, ancestorAbs) => ancestorAbs * (num(node.weightPct) / 100);
  const kidsOf = (n) => (n.children || []).filter(c => c.name && c.name.trim());
  const namedSubsOf = (p) => (p.subItems || []).filter(si => si.name && si.name.trim());
  // A parent's effective ABSOLUTE project weight — the weight it will be SAVED
  // with, so the banner, the approve gate and the weighted progress shown here
  // all agree with what the backend rolls up.
  const effectiveWeight = (p) => parentWeightOf(p);
  // Live total of the real weights. This used to sum parentSlice() instead, which
  // is 100 by construction — so the banner read "100% ✓ ready to approve" and the
  // approve gate passed even when the typed weights totalled 110%.
  const grandTotalWeight = parentWeightSum;
  // ±0.01% tolerance so raw Excel-derived fractions still validate (exact 100.000000
  // is unreachable with hand-typed weights and float dust).
  const WEIGHT_TOLERANCE = 0.01;
  const weightOk = Math.abs(grandTotalWeight - 100) <= WEIGHT_TOLERANCE;
  const hasAnyWeight = phases.some(p => effectiveWeight(p) > 0);
  // Weighted-average planned progress across the whole project.
  const weightedProgress = grandTotalWeight > 0
    ? phases.reduce((s, p) => {
        const w = effectiveWeight(p);
        const prog = (p.subItems && p.subItems.length > 0)
          ? (subWeightSum(p) > 0
              ? p.subItems.reduce((a, si) => a + num(si.weightPct) * num(si.progressPercent), 0) / subWeightSum(p)
              : 0)
          : num(p.progressPercent);
        return s + (w * prog) / 100;
      }, 0)
    : 0;
  const fmtW = (v) => {
    const n = num(v);
    // Show up to 4 decimals but trim trailing zeros, so raw fractions read cleanly.
    return n.toFixed(4).replace(/\.?0+$/, '');
  };

  // ── Capital allocation (derived, mirrors EPC tracker) ──────────────────────
  // Package budget = weight% × total project value (orderBook.totalAmount).
  // Planned capital = package budget. Actual capital = planned × progress%.
  const projectTotal = num(orderBook.totalAmount);
  const plannedCap = (weightPct) => (num(weightPct) / 100) * projectTotal;
  // Capital sums DOWN THE TREE: a branch's planned capital is its leaves' capital,
  // not the one level directly beneath it. A single-level sum would have dropped
  // every level-3 node's money out of the project total entirely.
  const nodesPlannedCap = (nodes, ancestorAbs) => nodes.reduce((s, n) => {
    const abs = absWeightOf(n, ancestorAbs);
    const kids = kidsOf(n);
    return s + (kids.length ? nodesPlannedCap(kids, abs) : plannedCap(abs));
  }, 0);
  const nodesActualCap = (nodes, ancestorAbs) => nodes.reduce((s, n) => {
    const abs = absWeightOf(n, ancestorAbs);
    const kids = kidsOf(n);
    return s + (kids.length
      ? nodesActualCap(kids, abs)
      : plannedCap(abs) * (num(n.progressPercent) / 100));
  }, 0);
  const phasePlannedCap = (p) =>
    hasSubs(p)
      ? nodesPlannedCap(namedSubsOf(p), parentSlice())
      : plannedCap(parentSlice());   // childless parent owns its full slice
  const phaseActualCap = (p) => {
    if (hasSubs(p)) return nodesActualCap(namedSubsOf(p), parentSlice());
    return plannedCap(parentSlice()) * (num(p.progressPercent) / 100);
  };
  const totalPlannedCap = phases.reduce((s, p) => s + phasePlannedCap(p), 0);
  const totalActualCap = phases.reduce((s, p) => s + phaseActualCap(p), 0);

  // ── Planning granularity ──────────────────────────────────────────────────
  // Solar_Rooftop under 100 kW → SIMPLE: Planned/Actual % are typed directly in
  // the grid (no weekly Weeks modal). Capacity comes from the free-text System
  // Capacity field; blank/unparseable on a rooftop → Simple (rooftop is small).
  // Everything else → DETAILED (the weekly Weeks modal).
  const isRooftop = /rooftop/i.test(orderBook.subGroupName || '');
  const isSimple = isRooftop && (() => { const kw = parseCapacityKw(scope.systemCapacity); return kw == null || kw < 100; })();
  const isDetailed = !isSimple;
  // Flatten scope into leaf entries: {phaseId, subKey|null, label, start, end, weight}
  //
  // A LEAF is a node with no breakdown of its own, wherever it sits in the tree —
  // that is the level progress is actually recorded at. Walking recursively is what
  // makes a four-level branch contribute its real leaves instead of its top row.
  const leaves = [];
  const collectLeaves = (nodes, phase, ancestorAbs, parentLabel) => {
    nodes.forEach(n => {
      const abs = absWeightOf(n, ancestorAbs);
      const kids = kidsOf(n);
      if (kids.length) { collectLeaves(kids, phase, abs, n.name); return; }
      leaves.push({
        // subKey is the node's ID, not its name: two nodes may share a name in
        // different branches, and their progress must never pool into one row.
        phaseId: phase.id, subKey: n.id, label: n.name, parent: parentLabel,
        start: num(n.startWeek) || num(phase.startWeek) || 1,
        end: num(n.endWeek) || num(n.startWeek) || num(phase.endWeek) || num(phase.startWeek) || nBuckets,
        weight: abs,
      });
    });
  };
  phases.forEach(p => {
    if (hasSubs(p)) {
      collectLeaves(namedSubsOf(p), p, parentSlice(), p.phaseName);
    } else {
      leaves.push({ phaseId: p.id, subKey: null, label: p.phaseName, parent: null,
        start: num(p.startWeek) || 1, end: num(p.endWeek) || num(p.startWeek) || nBuckets, weight: parentSlice() });
    }
  });
  const pKey = (phaseId, subKey, period) => `${phaseId}|${subKey || ''}|${period}`;
  // Build the leaf object the week-modal expects, from a schedule row.
  const leafForPhase = (p) => ({ phaseId: p.id, subKey: null, label: p.phaseName, parent: null,
    start: num(p.startWeek) || 1, end: num(p.endWeek) || num(p.startWeek) || nBuckets, weight: parentSlice() });
  const leafForSub = (p, si) => ({ phaseId: p.id, subKey: si.id, label: si.name, parent: p.phaseName,
    start: num(si.startWeek) || num(p.startWeek) || 1,
    end: num(si.endWeek) || num(si.startWeek) || num(p.endWeek) || num(p.startWeek) || nBuckets,
    weight: absSubWeight(si) });
  const getCell = (phaseId, subKey, period) => progress[pKey(phaseId, subKey, period)] || { plannedPct: 0, actualPct: 0 };
  const setCell = (phaseId, subKey, period, field, val) => {
    const k = pKey(phaseId, subKey, period);
    setProgress(prev => ({ ...prev, [k]: { ...(prev[k] || { plannedPct: 0, actualPct: 0 }), [field]: val === '' ? 0 : Math.max(0, Number(val)) } }));
  };
  // Even-fill the PLANNED curve for ONE leaf across its active periods.
  const seedLeafEven = (lf) => {
    const s = Math.max(1, Math.min(lf.start, nBuckets));
    const e = Math.max(s, Math.min(lf.end, nBuckets));
    const span = e - s + 1;
    const each = 100 / span;
    setProgress(prev => {
      const next = { ...prev };
      for (let b = s; b <= e; b++) {
        const k = pKey(lf.phaseId, lf.subKey, b);
        next[k] = { plannedPct: Number(each.toFixed(4)), actualPct: (next[k]?.actualPct ?? 0) };
      }
      return next;
    });
  };
  // Cumulative actual % for a leaf = sum of its actual increments (capped 100).
  const leafActual = (lf) => {
    let sum = 0;
    for (let b = 1; b <= nBuckets; b++) sum += num(getCell(lf.phaseId, lf.subKey, b).actualPct);
    return Math.min(100, sum);
  };
  const leafPlanned = (lf) => {
    let sum = 0;
    for (let b = 1; b <= nBuckets; b++) sum += num(getCell(lf.phaseId, lf.subKey, b).plannedPct);
    return Math.min(100, sum);
  };

  // Phase-level progress from the weeks data:
  //  - childless phase → its own leaf sum
  //  - parent with sub-items → WEIGHTED roll-up by sub-item weight (EPC standard).
  //    Falls back to a plain average only if no sub-item has a weight set.
  // Actual/planned readers for a leaf: SIMPLE = typed value; DETAILED = weekly periods.
  const leafActualVal = (p, si) => isSimple
    ? (Number((si || p).progressPercent) || 0)
    : leafActual(si ? leafForSub(p, si) : leafForPhase(p));
  const leafPlannedVal = (p, si) => isSimple
    ? (Number((si || p).plannedProgressPct) || 0)
    : leafPlanned(si ? leafForSub(p, si) : leafForPhase(p));
  //
  // Roll a group up: a LEAF contributes its own value, a node WITH children the
  // weighted average of theirs — and since those children may be parents too, the
  // recursion is what makes a deep branch correct. A mid-level node's own stored
  // progressPercent is deliberately ignored when it has children: it is never
  // updated once a breakdown exists, so trusting it would report a finished branch
  // as 0%. Mirrors ScopeSubItems.rollUp on the server, so the screen and the stored
  // headline cannot disagree.
  const rollUpNodes = (nodes, p, readLeaf) => {
    if (!nodes.length) return null;
    let acc = 0, wsum = 0, plain = 0;
    nodes.forEach(n => {
      const kids = kidsOf(n);
      const v = kids.length ? (rollUpNodes(kids, p, readLeaf) ?? 0) : readLeaf(p, n);
      plain += v;
      const w = num(n.weightPct);
      if (w > 0) { acc += w * v; wsum += w; }
    });
    // No child carries a weight → plain mean, which is what the single-level
    // version did and keeps a half-configured branch reporting something sane.
    return wsum > 0 ? acc / wsum : plain / nodes.length;
  };
  const phaseActualProgress = (p) => {
    const subs = namedSubsOf(p);
    if (subs.length === 0) return leafActualVal(p, null);
    return rollUpNodes(subs, p, leafActualVal);
  };
  const phasePlannedProgress = (p) => {
    const subs = namedSubsOf(p);
    if (subs.length === 0) return leafPlannedVal(p, null);
    return rollUpNodes(subs, p, leafPlannedVal);
  };
  // Auto status from a phase's actual progress (progress drives status). A manual
  // Delayed / On Hold always wins. In SIMPLE mode (no weekly data) status stays a
  // manual field, so it is returned as-is.
  const derivedStatus = (p) => {
    if (MANUAL_PHASE_STATUSES.includes(p.status)) return p.status;
    // Actual drives status (phaseActualProgress is mode-aware: typed in SIMPLE,
    // weekly roll-up in DETAILED; parents roll up from their sub-items either way).
    const a = phaseActualProgress(p);
    if (a >= 99.995) return 'Completed';
    if (a > 0) return 'In Progress';
    return 'Not Started';
  };
  // Project weighted progress from DETAILED actuals = Σ(leaf weight% × leaf actual%) / Σweight.
  const detailedWeightedActual = (() => {
    const wsum = leaves.reduce((s, lf) => s + lf.weight, 0);
    if (wsum <= 0) return 0;
    return leaves.reduce((s, lf) => s + lf.weight * leafActual(lf), 0) / wsum;
  })();

  // Collect the non-empty week cells for every leaf, keyed by phase id (+ sub-item).
  // Only leaves with a real phase id are sent — an unsaved phase (id == null) can't
  // own periods, and the Weeks button is disabled for it.
  const collectProgressCells = () => {
    const cells = [];
    leaves.forEach(lf => {
      if (lf.phaseId == null) return;
      for (let b = 1; b <= nBuckets; b++) {
        const c = getCell(lf.phaseId, lf.subKey, b);
        if (num(c.plannedPct) !== 0 || num(c.actualPct) !== 0) {
          cells.push({ phaseId: lf.phaseId, subItemKey: lf.subKey, periodNo: b,
            plannedPct: num(c.plannedPct), actualPct: num(c.actualPct) });
        }
      }
    });
    return cells;
  };

  // Persist the week cells. Returns true on success. No toast — callers decide.
  const persistProgress = async () => {
    const res = await fetch(`${API_BASE_URL}/projects/${orderBook.id}/scope/progress`, {
      method: 'PUT', credentials: 'include',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cells: collectProgressCells() }),
    });
    const data = await res.json();
    return !!data.success;
  };

  const saveProgress = async () => {
    setSavingProgress(true);
    try {
      if (await persistProgress()) showSuccess('Progress saved');
      else showError('Save failed');
    } catch { showError('Save failed'); }
    finally { setSavingProgress(false); }
  };

  if (loading) return <div className="obd-empty">Loading technical scope…</div>;

  return (
    <div className="obd-stack">
      <ConfirmationModal {...confirmModal} />
      <div className="obd-card">
        <div className="obd-card-head">
          <h4 className="obd-card-title">Scope of Work</h4>
        </div>
        <div className="obd-form-grid">
          <label className="obd-field"><span>Project Type</span>
            <input value={scope.projectType} onChange={e => setScope({ ...scope, projectType: e.target.value })} placeholder="Solar Rooftop / Ground Mount / Wind / EPC" />
          </label>
          <label className="obd-field"><span>System Capacity</span>
            <input value={scope.systemCapacity} onChange={e => setScope({ ...scope, systemCapacity: e.target.value })} placeholder="e.g. 2.5 MWp" />
          </label>
          <label className="obd-field"><span>Planned Start</span>
            <input type="date" value={scope.plannedStartDate || ''} onChange={e => setScope({ ...scope, plannedStartDate: e.target.value })} />
          </label>
          <label className="obd-field"><span>Planned End</span>
            <input type="date" value={scope.plannedEndDate || ''} onChange={e => setScope({ ...scope, plannedEndDate: e.target.value })} />
          </label>
          <label className="obd-field"><span>Planned Duration</span>
            <input className="obd-readonly" value={hasDates ? `${planDuration} ${unit === 'MONTH' ? 'month(s)' : 'week(s)'}` : '—'} readOnly tabIndex={-1} />
          </label>
          <label className="obd-field"><span>Schedule Granularity</span>
            <div className="obd-unit-toggle">
              <button type="button" className={unit === 'WEEK' ? 'active' : ''} onClick={() => setScope({ ...scope, planUnit: 'WEEK' })}>Weekly</button>
              <button type="button" className={unit === 'MONTH' ? 'active' : ''} onClick={() => setScope({ ...scope, planUnit: 'MONTH' })}>Monthly</button>
            </div>
          </label>
        </div>

        <label className="obd-field obd-field--full"><span>Scope of Work</span>
          <textarea rows={3} value={scope.scopeOfWork} onChange={e => setScope({ ...scope, scopeOfWork: e.target.value })} placeholder="High-level description of deliverables, boundaries, exclusions…" />
        </label>
        <label className="obd-field obd-field--full"><span>Technical Notes</span>
          <textarea rows={2} value={scope.technicalNotes} onChange={e => setScope({ ...scope, technicalNotes: e.target.value })} />
        </label>

        <div className="obd-schedule-footer">
          <button className="obd-btn obd-btn--primary" onClick={save} disabled={saving}>
            <Save size={14} /> {saving ? 'Saving…' : 'Save Scope'}
          </button>
        </div>
      </div>

      <div className="obd-card">
        <div className="obd-card-head">
          <h4 className="obd-card-title">Work Breakdown &amp; Schedule</h4>
          <div className="obd-card-head-actions">
            {isLeadDerived ? (
              <button className="obd-btn obd-btn--ghost" onClick={resetScope}
                title="Clear this imported scope and re-enable Suggest plan">
                <RotateCcw size={14} /> Reset scope
              </button>
            ) : (
              <button className="obd-btn obd-btn--ghost" onClick={loadDefaultPlan}><Wand2 size={14} /> Suggest plan</button>
            )}
            <button className="obd-btn obd-btn--ghost" onClick={loadFromLineItems}><Plus size={14} /> Load line items</button>
            <button className="obd-btn obd-btn--ghost" onClick={addPhase}><Plus size={14} /> Add row</button>
          </div>
        </div>

        {!hasDates ? (
          <div className="obd-banner obd-banner--warn">
            {(scope.plannedStartDate && scope.plannedEndDate)
              ? 'Planned End is on or before Planned Start — fix the dates to build the timeline.'
              : `Set Planned Start and Planned End above to build the schedule timeline. The grid divides that range into ${unit === 'MONTH' ? 'months' : 'weeks'}.`}
          </div>
        ) : null}

        {phases.length === 0 ? (
          <div className="obd-empty">No rows yet. Use "Suggest plan", "Load line items", or "Add row" to begin.</div>
        ) : (
          <>
            {parentWeightsOff && (
              <div className="obd-banner obd-banner--warn">
                Phase weights total {parentWeightSum.toFixed(1)}% — they must add up to 100% before the scope can be saved. Blank rows share whatever the typed rows leave over, so clearing a weight hands it back to the automatic split.
              </div>
            )}
            <div className="obd-table-wrap obd-table-wrap--sticky">
              <table className="obd-table obd-phase-table">
                <thead>
                  <tr>
                    <th style={{width:28}}></th>
                    <th>#</th>
                    <th>Activity / Item</th>
                    <th>Description</th>
                    <th>Weight %</th>
                    <th>Start {unitWord}</th>
                    <th>End {unitWord}</th>
                    <th>Status</th>
                    <th>Planned %</th>
                    <th>Actual %</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {phases.map((p, i) => {
                    const hasSubItems = p.subItems && p.subItems.length > 0;
                    return (
                      <React.Fragment key={i}>
                        {/* ── Parent phase row ─────────────────────────── */}
                        <tr className={hasSubItems ? 'obd-row-parent' : undefined}>
                          {/* Opens the breakdown in its own dialog, rather than
                              expanding it inline under this row — a deep tree
                              rendered as extra <tr>s here is exactly what made
                              this table congested. Clickable even with no
                              sub-items yet, so the modal is also how a phase
                              gets its FIRST one. */}
                          <td style={{ textAlign: 'center', padding: '0 4px' }}>
                            <button
                              type="button"
                              title={hasSubItems ? 'View / edit breakdown' : 'Add a breakdown'}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#2563eb', display: 'inline-flex' }}
                              onClick={() => setOpenBreakdown(i)}
                            >
                              <Maximize2 size={13} />
                            </button>
                          </td>
                          <td>{i + 1}</td>
                          <td>
                            {p.customName ? (
                              <div className="obd-cat-custom">
                                <input className="obd-inp" value={p.phaseName} autoFocus={focusRow === i} placeholder="Enter phase or item name"
                                  onChange={e => updatePhase(i, 'phaseName', e.target.value)}
                                  onBlur={e => registerActivity(e.target.value)} />
                                <button type="button" className="obd-cat-back" title="Back to list"
                                  onClick={() => { setFocusRow(null); updatePhase(i, 'customName', false, { phaseName: '' }); }}>↩</button>
                              </div>
                            ) : (
                              <select className="obd-inp"
                                value={ACTIVITY_OPTIONS.includes(p.phaseName) ? p.phaseName : ''}
                                onChange={e => {
                                  if (e.target.value === '__OTHER__') { setFocusRow(i); updatePhase(i, 'customName', true, { phaseName: '' }); }
                                  else updatePhase(i, 'phaseName', e.target.value);
                                }}>
                                <option value="">Select phase / item…</option>
                                {ACTIVITY_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                                <option value="__OTHER__">Other (type your own)…</option>
                              </select>
                            )}
                          </td>
                          <td><input className="obd-inp" value={p.phaseDescription} onChange={e => updatePhase(i, 'phaseDescription', e.target.value)} placeholder="Optional" /></td>
                          <td>
                            <div className="obd-progress-cell">
                              <input className="obd-inp obd-inp--xs" type="number" min="0" max="100" step="any"
                                value={p.weightPct ?? ''}
                                title="Weight % of this phase in the whole project. Blank = equal split. All phases should total 100%."
                                placeholder={fmtW(autoSlice)}
                                onChange={e => updatePhase(i, 'weightPct', e.target.value)} />
                              <span className="obd-progress-cell-pct">%</span>
                            </div>
                          </td>
                          <td>
                            <select className="obd-inp obd-inp--sm" value={clampBucket(p.startWeek)} onChange={e => updatePhase(i, 'startWeek', e.target.value)}>
                              <option value="">—</option>
                              {Array.from({ length: nBuckets }).map((_, b) => (
                                <option key={b} value={b + 1}>{unitAbbr} {b + 1} · {bucketLabel(scope.plannedStartDate, b, unit)}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select className="obd-inp obd-inp--sm" value={clampBucket(p.endWeek)} onChange={e => updatePhase(i, 'endWeek', e.target.value)}>
                              <option value="">—</option>
                              {Array.from({ length: nBuckets }).map((_, b) => (
                                <option key={b} value={b + 1}>{unitAbbr} {b + 1} · {bucketLabel(scope.plannedStartDate, b, unit)}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select className="obd-inp obd-inp--sm" value={derivedStatus(p)}
                              title="Auto from progress — pick Delayed / On Hold to override"
                              onChange={e => {
                                const st = e.target.value;
                                if (isDetailed) {
                                  // Progress drives status; only Delayed / On Hold are manual
                                  // overrides. Choosing a progress status hands control back.
                                  updatePhase(i, 'status', MANUAL_PHASE_STATUSES.includes(st) ? st : null);
                                } else {
                                  const extra = st === 'Completed' ? { progressPercent: 100 } : st === 'Not Started' ? { progressPercent: 0 } : {};
                                  updatePhase(i, 'status', st, extra);
                                }
                              }}>
                              {PHASE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </td>
                          {/* SIMPLE mode (rooftop < 100 kW): type Planned/Actual % directly.
                              DETAILED mode (and phases with sub-items): read-only weekly roll-up. */}
                          {isSimple && !hasSubItems ? (
                            <td style={{ textAlign: 'center' }}>
                              <input className="obd-inp obd-inp--xs" type="number" min="0" max="100" step="any"
                                value={p.plannedProgressPct ?? ''} placeholder="0"
                                title="Planned % for this phase"
                                onChange={e => updatePhase(i, 'plannedProgressPct', e.target.value)} />
                            </td>
                          ) : (
                            <td style={{ textAlign: 'center', fontWeight: 600 }}
                              className={phasePlannedProgress(p) > 100.01 ? 'obd-weight-banner--warn' : 'obd-cell-muted'}
                              title="Planned % — derived from the weeks modal">
                              {fmtW(phasePlannedProgress(p))}%
                            </td>
                          )}
                          {isSimple && !hasSubItems ? (
                            <td style={{ textAlign: 'center' }}>
                              <input className="obd-inp obd-inp--xs" type="number" min="0" max="100" step="any"
                                value={p.progressPercent ?? ''} placeholder="0"
                                title="Actual % for this phase"
                                onChange={e => updatePhase(i, 'progressPercent', e.target.value)} />
                            </td>
                          ) : (
                            <td style={{ textAlign: 'center', fontWeight: 600 }}
                              className={phaseActualProgress(p) > phasePlannedProgress(p) + 0.01 ? 'obd-weight-banner--warn' : 'obd-cap-cell--actual'}
                              title="Actual % — derived from the weeks modal (amber if ahead of plan)">
                              {fmtW(phaseActualProgress(p))}%
                            </td>
                          )}
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {isDetailed && !hasSubItems && (
                              // Week-wise progress is stored per phase id — a phase must be
                              // saved first (id != null), else the periods can't be persisted
                              // (and unsaved rows would collide on a null id). Save the schedule,
                              // then set weekly progress.
                              <button className="obd-btn obd-btn--ghost obd-btn--sm" style={{ marginRight: 4 }}
                                disabled={p.id == null}
                                title={p.id == null
                                  ? 'Save the schedule first, then set week-wise progress'
                                  : 'Set week-wise planned & actual progress'}
                                onClick={() => setWeekModalLeaf(leafForPhase(p))}>Weeks</button>
                            )}
                            <button className="obd-icon-btn" title="Add sub-item"
                              style={{ color: '#2563eb', marginRight: 4 }}
                              onClick={() => addSubItem(i)}>＋</button>
                            {hasSubItems && (
                              <button className="obd-icon-btn" title="Reset sub-item weights to equal auto-split"
                                style={{ color: '#6b7280', marginRight: 4 }}
                                onClick={() => resetSubWeights(i)}>↺</button>
                            )}
                            {(p.phaseName || '').trim().toLowerCase() === 'procurement' && (
                              <button className="obd-btn obd-btn--ghost obd-btn--sm" style={{ marginRight: 4 }}
                                title="Pull BOM / BOQ items in as sub-items, with dates split across this phase's range"
                                onClick={() => pullBomIntoPhase(i)}>Pull BOM</button>
                            )}
                            <button className="obd-icon-btn obd-icon-btn--danger" onClick={() => removePhase(i)} title="Remove row"><Trash2 size={14} /></button>
                          </td>
                        </tr>

                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── The breakdown TREE, in its own dialog ───────────────────────
                Was rendered as extra <tr>s squeezed under the phase row, in the
                SAME table, at whatever indentation depth it reached — exactly
                what made this table congested past a shallow breakdown. Now one
                phase's whole nested tree (any depth) opens in ScopeBreakdownModal
                instead; ScopeTreeEditor's own chevrons/indentation are unchanged,
                only where they render moved. One recursive editor, shared with
                the templates admin page and the lead Technical Scope tab.

                The progress/schedule/status cells are passed in through
                renderExtra rather than living in the editor, because they are
                the one thing genuinely specific to a running project — a
                template and a lead have neither progress nor a calendar. */}
            {openBreakdown != null && phases[openBreakdown] && (() => {
              const i = openBreakdown;
              const p = phases[i];
              return (
                <ScopeBreakdownModal
                  open
                  parentName={p.phaseName}
                  subs={p.subItems || []}
                  onChange={(next) => onSubTreeChange(i, next)}
                  options={ACTIVITY_OPTIONS}
                  register={registerActivity}
                  onClose={() => setOpenBreakdown(null)}
                  renderExtra={(si, ctx) => {
                    const kids = kidsOf(si);
                    // The grid this node is placed ON — its parent's own grid
                    // when the parent has one, else whatever the parent
                    // inherited, ending at the project header.
                    const onGrid = ctx.parent
                      ? gridUnder(ctx.parent, phaseGrid(p))
                      : phaseGrid(p);
                    const write = (k, v) =>
                      onSubTreeChange(i, setNodeField(p.subItems, si.id, k, v));

                    // Only a LEAF carries progress. A node with children shows
                    // the roll-up of those children instead, so a mid-level
                    // row can never be typed into and then silently outranked
                    // by its own breakdown.
                    const progress = kids.length ? (
                      <span className="obd-cell-muted" title="Rolled up from this item&apos;s own breakdown">
                        {fmtW(rollUpNodes(kids, p, leafPlannedVal))}% / {fmtW(rollUpNodes(kids, p, leafActualVal))}%
                      </span>
                    ) : isSimple ? (
                      <span style={{ display: "inline-flex", gap: 4 }}>
                        <input className="obd-inp obd-inp--xs" type="number" min="0" max="100" step="any"
                          value={si.plannedProgressPct ?? ""} placeholder="Plan" title="Planned % for this item"
                          onChange={(e) => write("plannedProgressPct", e.target.value)} />
                        <input className="obd-inp obd-inp--xs" type="number" min="0" max="100" step="any"
                          value={si.progressPercent ?? ""} placeholder="Act" title="Actual % for this item"
                          onChange={(e) => write("progressPercent", e.target.value)} />
                      </span>
                    ) : (
                      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <span className="obd-cell-muted" title="Planned % / Actual % — from this item&apos;s weeks">
                          {fmtW(leafPlanned(leafForSub(p, si)))}% / {fmtW(leafActual(leafForSub(p, si)))}%
                        </span>
                        {si.name && si.name.trim() && (
                          <button className="obd-btn obd-btn--ghost obd-btn--sm"
                            title="Set week-wise planned & actual progress"
                            onClick={() => setWeekModalLeaf(leafForSub(p, si))}>Weeks</button>
                        )}
                      </span>
                    );

                    return (
                      <span className="obd-sched-cell">
                        <NodeScheduleCell node={si} hasKids={kids.length > 0}
                          grid={onGrid} write={write} cls="obd" />
                        {/* Restored with the dates: the status select was
                            dropped in the same refactor. A parent's status is
                            derived from its children's progress, so only a
                            leaf is editable here. */}
                        {kids.length === 0 ? (
                          <select className="obd-inp obd-inp--sm" value={si.status || "Not Started"}
                            title="Status of this item"
                            onChange={(e) => {
                              const st = e.target.value;
                              let next = setNodeField(p.subItems, si.id, "status", st);
                              // Status and progress must agree — picking
                              // Completed and leaving 40% would show two
                              // different answers on the same row.
                              if (st === "Completed") next = setNodeField(next, si.id, "progressPercent", 100);
                              if (st === "Not Started") next = setNodeField(next, si.id, "progressPercent", 0);
                              onSubTreeChange(i, next);
                            }}>
                            {PHASE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        ) : (
                          <span className="obd-cell-faint" title="Derived from this item's breakdown">
                            {derivedNodeStatus(si, p)}
                          </span>
                        )}
                        {progress}
                      </span>
                    );
                  }}
                />
              );
            })()}

            {/* Save / Approve — placed directly under the table for easy reach */}
            <div className="obd-schedule-footer">
              {hasAnyWeight && (
                <div className={`obd-weight-banner ${weightOk ? 'obd-weight-banner--ok' : 'obd-weight-banner--warn'}`}>
                  <span>Total weight: {fmtW(grandTotalWeight)}% {weightOk ? '✓ ready to approve' : '(needs 100% to approve)'}</span>
                  <span className="obd-cell-muted" style={{ fontWeight: 500 }}>
                    Weighted progress: {fmtW(weightedProgress)}%
                  </span>
                  {isDetailed && (
                    <span className="obd-cap-cell--actual" style={{ fontWeight: 600 }}>
                      Actual (from weeks): {fmtW(detailedWeightedActual)}%
                    </span>
                  )}
                </div>
              )}
              <button className="obd-btn obd-btn--ghost" onClick={exportExcel} title="Export EPC tracker to Excel">
                <Download size={14} /> Export Excel
              </button>
              <button className="obd-btn obd-btn--primary" onClick={save} disabled={saving}>
                <Save size={14} /> {saving ? 'Saving…' : 'Save Schedule'}
              </button>
              <button className="obd-btn obd-btn--success" onClick={approve} disabled={saving || !weightOk}
                title={weightOk ? 'Approve the full scope (weights = 100%)' : 'Weights must total 100% to approve'}>
                <Check size={14} /> Approve scope
              </button>
            </div>

            {/* Inline Gantt-style timeline — buckets with real dates underneath */}
            <div className="obd-gantt" style={{ '--cols': nBuckets }}>
              <div className="obd-gantt-head">
                <div className="obd-gantt-label">Planned timeline</div>
                <div className="obd-gantt-weeks">
                  {Array.from({ length: nBuckets }).map((_, b) => (
                    <div key={b} className="obd-gantt-wk">
                      <span className="obd-gantt-wk-num">{b + 1}</span>
                      <span className="obd-gantt-wk-date">{bucketLabel(scope.plannedStartDate, b, unit)}</span>
                    </div>
                  ))}
                </div>
              </div>
              {phases.map((p, i) => {
                // Clamp to the visible range so bars never overflow the grid.
                const sRaw = Number(p.startWeek) || 1;
                const eRaw = Number(p.endWeek) || sRaw;
                const s = Math.min(Math.max(1, sRaw), nBuckets);
                const e = Math.min(Math.max(s, eRaw), nBuckets);
                const left = ((s - 1) / nBuckets) * 100;
                const width = ((e - s + 1) / nBuckets) * 100;
                return (
                  <div key={i} className="obd-gantt-row">
                    <div className="obd-gantt-label" title={p.phaseName}>{p.phaseName || `Row ${i + 1}`}</div>
                    <div className="obd-gantt-track">
                      <div className="obd-gantt-bar obd-gantt-bar--planned" style={{ left: `${left}%`, width: `${width}%` }}>
                        <span className="obd-gantt-pct">{s === e ? `${unitAbbr} ${s}` : `${unitAbbr} ${s}–${e}`}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Per-item week-by-week entry modal (opened from schedule rows in DETAILED mode) */}
      {weekModalLeaf && (() => {
        const lf = weekModalLeaf;
        const s = Math.max(1, Math.min(lf.start, nBuckets));
        const e = Math.max(s, Math.min(lf.end, nBuckets));
        const planTot = leafPlanned(lf);
        const actTot = leafActual(lf);
        return (
          <div className="obd-fv-overlay" onClick={() => setWeekModalLeaf(null)}>
            <div className="obd-week-modal" onClick={ev => ev.stopPropagation()}>
              <div className="obd-fv-header">
                <div className="obd-fv-title">
                  {lf.parent && <span className="obd-cell-faint" style={{ fontWeight: 400, marginRight: 6 }}>{lf.parent} ·</span>}
                  {lf.label}
                  <span className="obd-cell-faint" style={{ fontWeight: 400, marginLeft: 8 }}>wt {fmtW(lf.weight)}%</span>
                </div>
                <button className="obd-fv-close" onClick={() => setWeekModalLeaf(null)}>×</button>
              </div>
              <div style={{ padding: '12px 16px' }}>
                <p className="obd-cell-muted" style={{ fontSize: 12, marginTop: 0 }}>
                  Enter the % completed <strong>in</strong> each {unitWord.toLowerCase()} (incremental). Planned cells should add up to 100%.
                </p>
                <div style={{ marginBottom: 8 }}>
                  <button className="obd-btn obd-btn--ghost obd-btn--sm" onClick={() => seedLeafEven(lf)}
                    title="Spread 100% evenly across this item's periods">
                    <Wand2 size={13} /> Auto-fill planned evenly
                  </button>
                </div>
                <div className="obd-table-wrap" style={{ maxHeight: '50vh' }}>
                  <table className="obd-table">
                    <thead>
                      <tr><th>{unitWord}</th><th>Date</th><th>Planned %</th><th>Actual %</th></tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: nBuckets }).map((_, b) => {
                        const period = b + 1;
                        const active = period >= s && period <= e;
                        const c = getCell(lf.phaseId, lf.subKey, period);
                        return (
                          <tr key={b} style={active ? undefined : { opacity: 0.5 }}>
                            <td style={{ fontWeight: 600 }}>{unitAbbr} {period}</td>
                            <td className="obd-cell-faint" style={{ fontSize: 11 }}>{bucketLabel(scope.plannedStartDate, b, unit)}</td>
                            <td>
                              <input className="obd-inp obd-inp--sm" type="number" min="0" max="100" step="any"
                                style={{ width: 80 }} value={c.plannedPct || ''} placeholder={active ? '0' : '—'}
                                onChange={ev => setCell(lf.phaseId, lf.subKey, period, 'plannedPct', ev.target.value)} />
                            </td>
                            <td>
                              <input className="obd-inp obd-inp--sm" type="number" min="0" max="100" step="any"
                                style={{ width: 80, ...(num(c.actualPct) > num(c.plannedPct) + 0.01 ? { borderColor: '#f59e0b', background: 'rgba(245,158,11,0.08)' } : {}) }}
                                title={num(c.actualPct) > num(c.plannedPct) + 0.01 ? 'Actual exceeds planned for this period (ahead of schedule)' : undefined}
                                value={c.actualPct || ''} placeholder={active ? '0' : '—'}
                                onChange={ev => setCell(lf.phaseId, lf.subKey, period, 'actualPct', ev.target.value)} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ fontWeight: 700 }}>
                        <td colSpan={2} style={{ textAlign: 'right' }}>Total</td>
                        <td className={Math.abs(planTot - 100) > 0.01 ? 'obd-weight-banner--warn' : 'obd-cap-cell--actual'}
                          title={Math.abs(planTot - 100) > 0.01 ? 'Planned weekly %s should add up to 100% for this item' : 'Planned total is 100%'}>
                          {fmtW(planTot)}%</td>
                        <td className="obd-cap-cell--actual">{fmtW(actTot)}%</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className="obd-schedule-footer" style={{ marginTop: 10 }}>
                  <button className="obd-btn obd-btn--ghost obd-btn--sm" onClick={() => setWeekModalLeaf(null)}>Close</button>
                  <button className="obd-btn obd-btn--primary obd-btn--sm" onClick={async () => { await saveProgress(); setWeekModalLeaf(null); }} disabled={savingProgress}>
                    <Save size={13} /> {savingProgress ? 'Saving…' : 'Save Progress'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
// ── Item-keyed finance block (billing receivables OR cost payables) ──────────
const blankFinance = (seq) => ({ id: null, seqNo: seq, itemName: '', amount: '', plannedDate: '', notes: '' });

export const CommercialTab = ({ orderBook, authHeaders, showSuccess, showError }) => {
  const [billing, setBilling] = useState([]);
  const [cost, setCost] = useState([]);
  const [summary, setSummary] = useState(null);
  const [phaseNames, setPhaseNames] = useState([]); // tech-scope items (name + bucket span) for seeding
  const [scopeTree, setScopeTree] = useState([]);    // full scope phases incl. weight + budget + subItems
  const [savingBudget, setSavingBudget] = useState(false);
  const [planMeta, setPlanMeta] = useState({ start: '', unit: 'WEEK' });
  const [loading, setLoading] = useState(true);
  const [savingB, setSavingB] = useState(false);
  const [savingC, setSavingC] = useState(false);
  const { confirmModal, showConfirmation } = useConfirmationModal();
  const xHeaders = { 'X-User-Id': authHeaders['User-Id'], 'X-User-Role': authHeaders['User-Role'] };
  const [invoices, setInvoices] = useState([]);
  const [pos, setPos] = useState([]);
  const [expenses, setExpenses] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bRes, cRes, sRes, scRes] = await Promise.all([
        fetch(`${API_BASE_URL}/projects/${orderBook.id}/billing`, { credentials: 'include', headers: authHeaders }),
        fetch(`${API_BASE_URL}/projects/${orderBook.id}/cost`, { credentials: 'include', headers: authHeaders }),
        fetch(`${API_BASE_URL}/projects/${orderBook.id}/commercial-summary-v2`, { credentials: 'include', headers: authHeaders }),
        fetch(`${API_BASE_URL}/projects/${orderBook.id}/scope`, { credentials: 'include', headers: authHeaders }),
      ]);
      const bData = await bRes.json();
      const cData = await cRes.json();
      const sData = await sRes.json();
      const scData = await scRes.json();
      if (bData.success) setBilling((bData.data.lines || []).map(l => ({ id: l.id, seqNo: l.seqNo, itemName: l.itemName, amount: l.amount ?? '', plannedDate: l.plannedDate || '', notes: l.notes || '' })));
      if (cData.success) setCost((cData.data.lines || []).map(l => ({ id: l.id, seqNo: l.seqNo, itemName: l.itemName, amount: l.amount ?? '', plannedDate: l.plannedDate || '', notes: l.notes || '' })));
      if (sData.success) setSummary(sData.data.summary);
      if (scData.success) {
        const tree = (scData.data.phases || []).map(p => ({
          id: p.id, phaseName: p.phaseName, startWeek: p.startWeek, endWeek: p.endWeek,
          weightPct: p.weightPct, plannedBudget: p.plannedBudget,
          subItems: Array.isArray(p.subItems) ? p.subItems.map(si => ({ ...si })) : [],
          expanded: false, // UI-only: collapse children by default (like Technical Scope)
          // carry through all phase fields needed for a faithful scope re-save
          phaseDescription: p.phaseDescription, status: p.status,
          progressPercent: p.progressPercent, seqNo: p.seqNo, responsibleUserId: p.responsibleUserId,
        }));
        setScopeTree(tree);
        setPhaseNames(tree.map(p => ({ name: p.phaseName, startWeek: p.startWeek, endWeek: p.endWeek })).filter(p => p.name));
        const sc = scData.data.scope;
        setPlanMeta({ start: sc?.plannedStartDate || '', unit: sc?.planUnit || 'WEEK' });
      }

      const pid = orderBook.projectId;
      if (pid) {
        try {
          const ivRes = await fetch(`${API_BASE_URL}/invoices?projectId=${encodeURIComponent(pid)}&size=200`, { credentials: 'include', headers: xHeaders });
          const ivData = await ivRes.json();
          setInvoices(ivData.invoices || []);
        } catch { /* non-fatal */ }
        try {
          const poRes = await fetch(`${API_BASE_URL}/purchase-orders?projectId=${encodeURIComponent(pid)}&size=100`, { credentials: 'include', headers: xHeaders });
          const poData = await poRes.json();
          setPos(poData.purchaseOrders || []);
        } catch { /* non-fatal */ }
        try {
          const exRes = await fetch(`${API_BASE_URL}/project-expenses?projectId=${encodeURIComponent(pid)}&size=100`, { credentials: 'include', headers: xHeaders });
          const exData = await exRes.json();
          setExpenses(exData.content || exData.data || exData.expenses || []);
        } catch { /* non-fatal */ }
      }
    } catch (e) { showError('Failed to load commercial data'); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderBook.id]);

  useEffect(() => { load(); }, [load]);

  const seedFromScope = (setList, list, dateAnchor) => {
    if (!phaseNames.length) { showError('No technical-scope items to seed from. Add them in the Technical Scope tab first.'); return; }
    const existing = new Set(list.map(l => l.itemName));
    const additions = phaseNames.filter(p => !existing.has(p.name)).map(p => {
      // Billing → phase START bucket; Cost → phase END bucket. Buckets are 1-based.
      const bucket = dateAnchor === 'end' ? (p.endWeek || p.startWeek) : p.startWeek;
      const plannedDate = bucket ? bucketToISODate(planMeta.start, bucket - 1, planMeta.unit) : '';
      return { id: null, itemName: p.name, amount: '', plannedDate, notes: '' };
    });
    if (!additions.length) { showError('All technical-scope items are already listed.'); return; }
    setList(prev => [...prev, ...additions].map((l, i) => ({ ...l, seqNo: i + 1 })));
  };

  const upd = (setList) => (i, field, val) => setList(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: val } : l));
  const add = (setList) => () => setList(prev => [...prev, blankFinance(prev.length + 1)]);
  const rm  = (setList) => (i) => setList(prev => prev.filter((_, idx) => idx !== i).map((l, idx) => ({ ...l, seqNo: idx + 1 })));

  const saveBlock = async (kind) => {
    const list = kind === 'billing' ? billing : cost;
    for (const l of list) { if (!l.itemName || !l.itemName.trim()) { showError('Every line needs an item name'); return; } }
    const setSaving = kind === 'billing' ? setSavingB : setSavingC;
    setSaving(true);
    try {
      const body = { lines: list.map((l, i) => ({ id: l.id, seqNo: i + 1, itemName: l.itemName.trim(), amount: l.amount === '' ? 0 : Number(l.amount), plannedDate: l.plannedDate || null, notes: l.notes })) };
      const res = await fetch(`${API_BASE_URL}/projects/${orderBook.id}/${kind}`, {
        method: 'PUT', credentials: 'include',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) { showSuccess(kind === 'billing' ? 'Billing plan saved' : 'Cost plan saved'); if (data.data) setSummary(data.data); }
      else showError(data.message || 'Save failed');
    } catch { showError('Save failed'); }
    finally { setSaving(false); }
  };

  // ── Scope-based budget allocation (Cost to Procure) ────────────────────────
  // Mirrors the Technical Scope tree. Budgets are entered on leaves (sub-items, or
  // childless parents); a parent with children shows the auto-summed total (locked),
  // exactly like the weight rollup. Saved via the surgical /scope/budgets endpoint.
  const bnum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  // Money adds UP THE TREE: only a leaf carries a typed figure, and every parent
  // above it — at any depth — is the sum of its own children. A single-level sum
  // would have silently dropped every node below level 1 out of the project total.
  const budgetLeaves = (nodes) => (nodes || []).flatMap(n =>
    ((n.children || []).length ? budgetLeaves(n.children) : [n]));
  const subBudgetSum = (p) => budgetLeaves(p.subItems).reduce((s, si) => s + bnum(si.plannedBudget), 0);
  const nodeBudget = (n) => ((n.children || []).length
    ? (n.children || []).reduce((s, c) => s + nodeBudget(c), 0)
    : bnum(n.plannedBudget));
  const phaseBudget = (p) => (p.subItems && p.subItems.length > 0) ? subBudgetSum(p) : bnum(p.plannedBudget);
  const scopePartTotal = scopeTree.reduce((s, p) => s + phaseBudget(p), 0);
  // Budget-only extras live in the existing flat `cost` list (not the scope tree).
  const extrasTotal = cost.reduce((s, l) => s + bnum(l.amount), 0);
  const totalScopeBudget = scopePartTotal + extrasTotal;

  const setLeafBudget = (pi, val) => setScopeTree(prev => prev.map((p, idx) =>
    idx === pi ? { ...p, plannedBudget: val === '' ? '' : Math.max(0, Number(val)) } : p));
  // Addressed by node ID, not by index: the row may be several levels down, and an
  // index would be wrong the moment a branch above it was reordered.
  const setSubBudget = (pi, nodeId, val) => setScopeTree(prev => prev.map((p, idx) => {
    if (idx !== pi) return p;
    const write = (nodes) => (nodes || []).map(n => (n.id === nodeId
      ? { ...n, plannedBudget: val === '' ? '' : Math.max(0, Number(val)) }
      : { ...n, children: write(n.children) }));
    return { ...p, subItems: write(p.subItems) };
  }));
  const toggleExpand = (pi) => setScopeTree(prev => prev.map((p, idx) =>
    idx === pi ? { ...p, expanded: !p.expanded } : p));

  /**
   * The budget rows for one branch of the tree, recursively.
   *
   * A LEAF gets an editable cell; a node WITH children gets its children's total,
   * read-only — the same "a parent is the sum of its parts" rule the save enforces
   * server-side, so what the user sees here is what gets stored. Depth is shown by
   * indenting the name, which keeps every budget figure in one aligned column
   * however deep the branch goes.
   */
  const budgetRows = (nodes, pi, depth) => (nodes || []).flatMap((si) => {
    const kids = si.children || [];
    const sBudget = nodeBudget(si);
    const sPct = totalScopeBudget > 0 ? (sBudget / totalScopeBudget) * 100 : 0;
    const row = (
      <tr key={si.id}>
        <td></td>
        <td></td>
        <td style={{ paddingLeft: 16 + depth * 14 }} className="obd-cell-muted">↳ {si.name}</td>
        <td className="obd-cell-faint">{si.weightPct != null && si.weightPct !== '' ? `${Number(si.weightPct)}%` : '—'}</td>
        <td>
          {kids.length ? (
            <span className="obd-cell-faint" title="Summed from this item's own breakdown — edit the items under it">
              {fmtMoney(sBudget)}
            </span>
          ) : (
            <input className="obd-inp obd-inp--sm" type="number" min="0" placeholder="0"
              value={si.plannedBudget ?? ''}
              onChange={e => setSubBudget(pi, si.id, e.target.value)} />
          )}
        </td>
        <td className="obd-cell-faint">{sPct.toFixed(1)}%</td>
        <td></td>
      </tr>
    );
    return [row, ...budgetRows(kids, pi, depth + 1)];
  });
  // Extra budget-only line helpers (operate on the flat `cost` list).
  const addExtra = () => setCost(prev => [...prev, { id: null, itemName: '', amount: '', plannedDate: '', notes: '' }]);
  const setExtra = (i, field, val) => setCost(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: val } : l));
  const removeExtra = (i) => setCost(prev => prev.filter((_, idx) => idx !== i));

  const saveScopeBudgets = async () => {
    // Validate extras have names
    for (const l of cost) { if ((l.amount !== '' && l.amount != null) && (!l.itemName || !l.itemName.trim())) { showError('Every extra item needs a name'); return; } }
    setSavingBudget(true);
    try {
      // 1) Scope item budgets → surgical scope endpoint
      const items = scopeTree.map(p => ({
        phaseId: p.id,
        plannedBudget: (p.subItems && p.subItems.length > 0) ? null
          : (p.plannedBudget === '' || p.plannedBudget == null ? null : Number(p.plannedBudget)),
        // Every LEAF in the tree, at any depth, keyed by its node ID.
        //
        // This used to send `{ name, plannedBudget }` for one flat level, and the
        // server matched on the name with an exact equals. A tree repeats names
        // across branches, so that would have written one branch's money onto
        // another's — and it would have missed every node below level 1 entirely.
        // Only leaves are sent: a parent's figure is the sum of its children,
        // recomputed server-side, so sending one would be overwritten anyway.
        subBudgets: budgetLeaves(p.subItems).map(si => ({
          id: si.id,
          name: si.name,   // for logs and error messages only; the id is the key
          plannedBudget: si.plannedBudget === '' || si.plannedBudget == null ? null : Number(si.plannedBudget),
        })),
      }));
      const scopeRes = await fetch(`${API_BASE_URL}/projects/${orderBook.id}/scope/budgets`, {
        method: 'PUT', credentials: 'include',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const scopeData = await scopeRes.json();
      if (!scopeData.success) { showError(scopeData.message || 'Save failed'); setSavingBudget(false); return; }

      // 2) Extra budget-only lines → existing cost endpoint
      const extras = cost.filter(l => l.itemName && l.itemName.trim());
      const costRes = await fetch(`${API_BASE_URL}/projects/${orderBook.id}/cost`, {
        method: 'PUT', credentials: 'include',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines: extras.map((l, i) => ({ id: l.id, seqNo: i + 1, itemName: l.itemName.trim(), amount: l.amount === '' ? 0 : Number(l.amount), plannedDate: l.plannedDate || null, notes: l.notes || '' })) }),
      });
      const costData = await costRes.json();
      if (costData.success) { showSuccess('Budget allocation saved'); load(); }
      else showError(costData.message || 'Saved scope budgets, but extra lines failed');
    } catch { showError('Save failed'); }
    finally { setSavingBudget(false); }
  };

  if (loading) return <div className="obd-empty">Loading commercial data…</div>;

  const billingPlanned = billing.reduce((s, l) => s + Number(l.amount || 0), 0);
  const costPlanned = cost.reduce((s, l) => s + Number(l.amount || 0), 0);
  const invoiced = Number(summary?.totalInvoiced || 0);
  const paid = Number(summary?.totalPaid || 0);
  const procurement = Number(summary?.totalProcurement || 0);
  const spend = Number(summary?.totalSpend || 0);
  const actualCost = procurement + spend;
  const projectLinked = summary?.projectLinked;

  const pct = (a, b) => b > 0 ? Math.min(100, (a / b) * 100) : 0;

  const renderBlock = (title, list, setList, kind, saving, planned, actualLabel, actualValue) => (
    <div className="obd-card">
      <div className="obd-card-head">
        <h4 className="obd-card-title">{title}</h4>
        <div className="obd-card-head-actions">
          <button className="obd-btn obd-btn--ghost" onClick={() => seedFromScope(setList, list, kind === 'billing' ? 'start' : 'end')}><Plus size={14} /> Seed from scope</button>
          <button className="obd-btn obd-btn--ghost" onClick={add(setList)}><Plus size={14} /> Add line</button>
        </div>
      </div>

      {/* planned vs actual summary strip */}
      <div className="obd-stat-row">
        <div className="obd-stat"><label>Planned</label><span>{fmtMoney(planned)}</span></div>
        <div className="obd-stat"><label>{actualLabel}</label><span>{fmtMoney(actualValue)}</span></div>
        {kind === 'billing' && <div className="obd-stat"><label>Collected</label><span>{fmtMoney(paid)}</span></div>}
        <div className={`obd-stat ${actualValue > planned && planned > 0 ? 'obd-stat--over' : 'obd-stat--ok'}`}>
          <label>{kind === 'billing' ? 'Yet to Invoice' : 'Remaining'}</label>
          <span>{fmtMoney(Math.max(0, planned - actualValue))}</span>
        </div>
      </div>
      {planned > 0 && (
        <div className="obd-progress">
          <div className={`obd-progress-fill ${actualValue > planned ? 'obd-progress-fill--over' : ''}`} style={{ width: `${pct(actualValue, planned)}%` }} />
          <span className="obd-progress-label">{pct(actualValue, planned).toFixed(1)}% {kind === 'billing' ? 'invoiced' : 'spent'} of planned</span>
        </div>
      )}
      {!projectLinked && (
        <div className="obd-banner obd-banner--warn">No project linked — live {kind === 'billing' ? 'invoice' : 'procurement/spend'} actuals can't be shown. Planning still works.</div>
      )}

      {list.length === 0 ? (
        <div className="obd-empty">No lines yet. "Seed from scope" pulls your technical-scope items, or "Add line" for a custom one.</div>
      ) : (
        <div className="obd-table-wrap">
          <table className="obd-table">
            <thead><tr><th>#</th><th>Item</th><th>{kind === 'billing' ? 'Amount to Bill' : 'Cost'}</th><th>{kind === 'billing' ? 'Invoice Date' : 'Pay Date'}</th><th>Notes</th><th></th></tr></thead>
            <tbody>
              {list.map((l, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td><input className="obd-inp" value={l.itemName} onChange={e => upd(setList)(i, 'itemName', e.target.value)} placeholder="Item / scope name" /></td>
                  <td><input className="obd-inp obd-inp--sm" type="number" min="0" value={l.amount} onChange={e => upd(setList)(i, 'amount', e.target.value)} /></td>
                  <td><input className="obd-inp obd-inp--sm" type="date" value={l.plannedDate || ''} onChange={e => upd(setList)(i, 'plannedDate', e.target.value)} /></td>
                  <td><input className="obd-inp" value={l.notes} onChange={e => upd(setList)(i, 'notes', e.target.value)} /></td>
                  <td><button className="obd-icon-btn obd-icon-btn--danger" onClick={() => rm(setList)(i)}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td style={{ textAlign: 'right', fontWeight: 700 }}>Total</td>
                <td /><td style={{ fontWeight: 700 }}>{fmtMoney(planned)}</td><td colSpan={3} /></tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="obd-schedule-footer">
        <button className="obd-btn obd-btn--primary" onClick={() => saveBlock(kind)} disabled={saving}>
          <Save size={14} /> {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="obd-stack">
      <ConfirmationModal {...confirmModal} />

      {renderBlock('Invoices to Raise (Client Billing)', billing, setBilling, 'billing', savingB, billingPlanned, 'Invoiced', invoiced)}

      {/* Budget Allocation (Cost to Procure) — scope tree + budget-only extras */}
      <div className="obd-card">
        <div className="obd-card-head">
          <h4 className="obd-card-title">Budget Allocation (Cost to Procure)</h4>
          <div className="obd-card-head-actions">
            <div className="obd-stat" style={{ marginRight: 12 }}>
              <label>Total Allocated</label><span>{fmtMoney(totalScopeBudget)}</span>
            </div>
          </div>
        </div>

        {scopeTree.length === 0 && cost.length === 0 ? (
          <div className="obd-empty">
            No items yet. Scope items from the Technical Scope tab appear here automatically, or add procurement costs not tied to the scope (freight, contingency, etc.).
            <div style={{ marginTop: 12 }}>
              <button className="obd-btn obd-btn--ghost obd-btn--sm" onClick={addExtra}><Plus size={13} /> Add extra item</button>
            </div>
          </div>
        ) : (
          <>
            <div className="obd-table-wrap">
              <table className="obd-table obd-phase-table">
                <thead>
                  <tr>
                    <th style={{ width: 28 }}></th>
                    <th>#</th><th>Item</th><th>Weight %</th>
                    <th>Planned Budget</th><th>% of Total</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {scopeTree.map((p, pi) => {
                    const hasSub = p.subItems && p.subItems.length > 0;
                    const pBudget = phaseBudget(p);
                    const pctOfTotal = totalScopeBudget > 0 ? (pBudget / totalScopeBudget) * 100 : 0;
                    return (
                      <React.Fragment key={p.id ?? pi}>
                        <tr className="obd-row-parent">
                          <td style={{ textAlign: 'center' }}>
                            {hasSub ? (
                              <button className="obd-icon-btn" title={p.expanded ? 'Collapse sub-items' : 'Expand sub-items'}
                                style={{ color: '#2563eb' }} onClick={() => toggleExpand(pi)}>
                                {p.expanded ? '▾' : '▸'}
                              </button>
                            ) : <span className="obd-dash">—</span>}
                          </td>
                          <td>{pi + 1}</td>
                          <td>{p.phaseName}</td>
                          <td>{p.weightPct != null && p.weightPct !== '' ? `${Number(p.weightPct)}%` : (scopeTree.length > 0 ? `${Number((100 / scopeTree.length).toFixed(2))}%` : '—')}</td>
                          <td>
                            {hasSub ? (
                              <span title="Auto-summed from sub-items" className="obd-cell-muted">{fmtMoney(pBudget)}</span>
                            ) : (
                              <input className="obd-inp obd-inp--sm" type="number" min="0" placeholder="0"
                                value={p.plannedBudget ?? ''}
                                onChange={e => setLeafBudget(pi, e.target.value)} />
                            )}
                          </td>
                          <td>{pctOfTotal.toFixed(1)}%</td>
                          <td></td>
                        </tr>
                        {/* The breakdown, to full depth. Rendered recursively so a
                            level-3 node gets its own budget cell — the flat version
                            showed only the phase's direct children, which meant money
                            below that simply had nowhere to be entered.

                            Only a LEAF is typeable: a parent shows the auto-summed
                            total of its own children, locked, exactly like the weight
                            roll-up above it. */}
                        {hasSub && p.expanded && budgetRows(p.subItems, pi, 1)}
                      </React.Fragment>
                    );
                  })}

                  {/* Budget-only extra items (not part of the scope tree) */}
                  {cost.map((l, i) => {
                    const ePct = totalScopeBudget > 0 ? (bnum(l.amount) / totalScopeBudget) * 100 : 0;
                    return (
                      <tr key={'extra-' + i}>
                        <td style={{ textAlign: 'center' }}><span title="Extra (non-scope) item" style={{ color: '#f59e0b' }}>＊</span></td>
                        <td>{scopeTree.length + i + 1}</td>
                        <td><input className="obd-inp obd-inp--sm" value={l.itemName} placeholder="e.g. Freight, Contingency"
                          onChange={e => setExtra(i, 'itemName', e.target.value)} /></td>
                        <td className="obd-dash">—</td>
                        <td><input className="obd-inp obd-inp--sm" type="number" min="0" placeholder="0"
                          value={l.amount} onChange={e => setExtra(i, 'amount', e.target.value)} /></td>
                        <td>{ePct.toFixed(1)}%</td>
                        <td><button className="obd-icon-btn obd-icon-btn--danger" title="Remove extra item"
                          onClick={() => removeExtra(i)}><Trash2 size={14} /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 700 }}>
                    <td></td><td></td><td>Total</td><td></td>
                    <td>{fmtMoney(totalScopeBudget)}</td><td>100%</td><td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {/* Add extra item: its own line below the last row, right-aligned */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 12px 4px' }}>
              <button className="obd-btn obd-btn--ghost obd-btn--sm" onClick={addExtra}><Plus size={13} /> Add extra item</button>
            </div>
            <div className="obd-schedule-footer">
              <div className="obd-stat" style={{ marginRight: 'auto' }}>
                <label>vs Order Value</label>
                <span>{fmtMoney(totalScopeBudget)} of {fmtMoney(Number(orderBook.totalAmount || 0))}
                  {Number(orderBook.totalAmount) > 0 && ` (${((totalScopeBudget / Number(orderBook.totalAmount)) * 100).toFixed(1)}%)`}</span>
              </div>
              <button className="obd-btn obd-btn--primary obd-btn--sm" onClick={saveScopeBudgets} disabled={savingBudget}>
                <Save size={13} /> {savingBudget ? 'Saving…' : 'Save Budget Allocation'}
              </button>
            </div>
          </>
        )}
      </div>


      {/* Live invoices for this order's project */}
      {projectLinked && (
        <div className="obd-card">
          <h4 className="obd-card-title">Invoices Raised — {orderBook.projectId}</h4>
          {invoices.length === 0 ? <div className="obd-empty">No invoices raised yet for this project.</div> : (
            <div className="obd-table-wrap">
              <table className="obd-table">
                <thead><tr><th>Invoice #</th><th>Date</th><th>Status</th><th>Total</th><th>Paid</th><th>Balance</th></tr></thead>
                <tbody>
                  {invoices.map((iv, i) => (
                    <tr key={iv.id || i}>
                      <td>{iv.invoiceNumber || iv.id}</td>
                      <td>{fmtDate(iv.invoiceDate)}</td>
                      <td>{iv.status || '-'}</td>
                      <td>{fmtMoney(iv.totalAmount)}</td>
                      <td>{fmtMoney(iv.paidAmount)}</td>
                      <td>{fmtMoney(iv.balanceAmount != null ? iv.balanceAmount : (Number(iv.totalAmount||0) - Number(iv.paidAmount||0)))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Live procurement + spend */}
      {projectLinked && (
        <div className="obd-card">
          <h4 className="obd-card-title">Procurement & Spend — {orderBook.projectId}</h4>
          {pos.length === 0 && expenses.length === 0 ? <div className="obd-empty">No purchase orders or expenses for this project.</div> : (
            <div className="obd-table-wrap">
              <table className="obd-table">
                <thead><tr><th>Type</th><th>Ref</th><th>Date</th><th>Status</th><th>Amount</th></tr></thead>
                <tbody>
                  {pos.map((p, i) => (
                    <tr key={'po' + (p.id || i)}>
                      <td>PO</td><td>{p.poNumber || p.poNo || p.id}</td><td>{fmtDate(p.orderDate)}</td><td>{p.status || '-'}</td><td>{fmtMoney(p.totalValue)}</td>
                    </tr>
                  ))}
                  {expenses.map((x, i) => (
                    <tr key={'ex' + (x.id || i)}>
                      <td>Expense</td><td>{x.expenseCode || x.id}</td><td>{fmtDate(x.tripDate || x.date)}</td><td>{x.status || '-'}</td><td>{fmtMoney(x.totalAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
//  BOM / BOQ TAB — bill of materials / quantities for the order book
//  Each line: category, item, make, unit, qty, unit rate → amount (qty × rate).
//  amount auto-derives on the client; a manual override is still honoured by
//  the backend if sent. PUT replaces the whole list (same pattern as cost/billing).
// ─────────────────────────────────────────────────────────────────────────────
const blankBom = (seq) => ({
  id: null, seqNo: seq, category: '', itemName: '', make: '',
  unit: '', quantity: '', unitRate: '', notes: '',
});

const lineAmount = (l) => Number(l.quantity || 0) * Number(l.unitRate || 0);

// Static template lives at public/templates/bom_boq_template.xlsx (served at
// /templates/...). The importer below accepts that template's headers and a few
// plain-field fallbacks so a sheet exported elsewhere still maps. Amount is
// always derived from qty * rate, never read from the sheet.
const bomRowToLine = (row, seq) => ({
  id: null, seqNo: seq,
  // "Specifications" is stored in the category column (no separate spec column
  // in the schema). "Component" is the required item_name. Old header names are
  // kept as fallbacks so previously-downloaded sheets still import.
  category: String(row['Specifications'] ?? row['Specification'] ?? row['Category'] ?? row['category'] ?? '').trim(),
  itemName: String(row['Component'] ?? row['Item'] ?? row['Item Name'] ?? row['itemName'] ?? '').trim(),
  make:     String(row['Make'] ?? row['make'] ?? '').trim(),
  unit:     String(row['Units'] ?? row['Unit'] ?? row['unit'] ?? '').trim(),
  quantity: row['Qty'] ?? row['Quantity'] ?? row['quantity'] ?? '',
  unitRate: row['Unit Price'] ?? row['Unit Rate'] ?? row['unitRate'] ?? row['Rate'] ?? '',
  notes:    String(row['Notes'] ?? row['notes'] ?? row['Remarks'] ?? '').trim(),
});

export const BomTab = ({ orderBook, authHeaders, showSuccess, showError }) => {
  const [lines, setLines] = useState([]);
  const { confirmModal, showConfirmation } = useConfirmationModal();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/projects/${orderBook.id}/bom`, { credentials: 'include', headers: authHeaders });
      const data = await res.json();
      if (data.success) {
        setLines((data.data.lines || []).map(l => ({
          id: l.id, seqNo: l.seqNo,
          category: l.category || '', itemName: l.itemName || '', make: l.make || '',
          unit: l.unit || '',
          quantity: l.quantity ?? '', unitRate: l.unitRate ?? '',
          notes: l.notes || '',
        })));
      } else showError(data.message || 'Failed to load BOM');
    } catch { showError('Failed to load BOM / BOQ'); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderBook.id]);

  useEffect(() => { load(); }, [load]);

  const upd = (i, field, val) => setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: val } : l));
  const add = () => setLines(prev => [...prev, blankBom(prev.length + 1)]);
  const rm  = (i) => setLines(prev => prev.filter((_, idx) => idx !== i).map((l, idx) => ({ ...l, seqNo: idx + 1 })));

  // Download the pre-made template that ships in public/templates. No client-side
  // generation — this just points the browser at the static file.
  const downloadTemplate = () => {
    const a = document.createElement('a');
    a.href = `${process.env.PUBLIC_URL || ''}/templates/bom_boq_template.xlsx`;
    a.download = 'bom_boq_template.xlsx';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  // Parse an uploaded .xlsx/.xls/.csv and APPEND its rows to the current list
  // (existing lines are kept). Rows with no item name are skipped.
  const importExcel = async (file) => {
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) { showError('The file has no data rows'); return; }
      const mapped = rows
        .map((r, idx) => bomRowToLine(r, idx + 1))
        .filter(l => l.itemName && l.itemName.trim() !== '');
      if (!mapped.length) { showError('No valid rows found. Each row needs an Item.'); return; }
      setLines(prev => [...prev, ...mapped].map((l, idx) => ({ ...l, seqNo: idx + 1 })));
      showSuccess(`Imported ${mapped.length} row${mapped.length === 1 ? '' : 's'} from Excel. Review, then Save.`);
    } catch {
      showError('Could not read the file. Use the template format (.xlsx, .xls or .csv).');
    }
  };

  const onFilePicked = (e) => {
    const file = e.target.files && e.target.files[0];
    importExcel(file);
    e.target.value = ''; // allow re-importing the same file
  };

  // Seed BOM lines from the order book's own line items (GET /{id}/items).
  const seedFromItems = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/projects/${orderBook.id}/items`, { credentials: 'include', headers: authHeaders });
      const data = await res.json();
      const items = (data.success && Array.isArray(data.data?.items)) ? data.data.items
                  : (Array.isArray(data.items) ? data.items : (Array.isArray(data.data) ? data.data : []));
      if (!items.length) { showError('No order book line items found to seed from.'); return; }
      const seeded = items.map((it, idx) => ({
        id: null, seqNo: idx + 1,
        category: '', itemName: it.itemName || '', make: '',
        unit: it.unit || '',
        quantity: it.quantity ?? '', unitRate: it.unitPrice ?? '',
        notes: it.specification || it.description || '',
      })).filter(l => l.itemName && l.itemName.trim());
      if (!seeded.length) { showError('Line items have no usable item names.'); return; }

      let mode = 'replace';
      if (lines.length > 0) {
        const append = await showConfirmation({
          title: 'BOM lines already exist', type: 'confirm',
          message: `This BOM already has ${lines.length} line(s). Append the ${seeded.length} order-book item(s), or replace?`,
          confirmText: 'Append', cancelText: 'Replace',
        });
        mode = append ? 'append' : 'replace';
      }
      const next = mode === 'append' ? [...lines, ...seeded] : seeded;
      setLines(next.map((l, idx) => ({ ...l, seqNo: idx + 1 })));
      showSuccess(`Seeded ${seeded.length} item(s) from the order book. Review, then Save.`);
    } catch { showError('Failed to seed from order book items.'); }
  };

  const save = async () => {
    for (const l of lines) { if (!l.itemName || !l.itemName.trim()) { showError('Every BOM line needs an item name'); return; } }
    setSaving(true);
    try {
      const body = {
        lines: lines.map((l, i) => ({
          id: l.id, seqNo: i + 1,
          category: l.category ? l.category.trim() : null,
          itemName: l.itemName.trim(),
          make: l.make ? l.make.trim() : null,
          unit: l.unit ? l.unit.trim() : null,
          quantity: l.quantity === '' ? 0 : Number(l.quantity),
          unitRate: l.unitRate === '' ? 0 : Number(l.unitRate),
          amount: lineAmount(l),
          notes: l.notes,
        })),
      };
      const res = await fetch(`${API_BASE_URL}/projects/${orderBook.id}/bom`, {
        method: 'PUT', credentials: 'include',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) { showSuccess('BOM / BOQ saved'); load(); }
      else showError(data.message || 'Save failed');
    } catch { showError('Save failed'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="obd-empty">Loading BOM / BOQ…</div>;

  const total = lines.reduce((s, l) => s + lineAmount(l), 0);

  return (
    <div className="obd-stack">
      <ConfirmationModal {...confirmModal} />
      <div className="obd-card">
        <div className="obd-card-head">
          <h4 className="obd-card-title">Bill of Materials / Quantities</h4>
          <div className="obd-card-head-actions">
            <button className="obd-btn obd-btn--ghost" onClick={seedFromItems} title="Fill from the order book's line items"><Plus size={14} /> Seed line items</button>
            <button className="obd-btn obd-btn--ghost" onClick={downloadTemplate}><FaFileDownload /> Download Template</button>
            <button className="obd-btn obd-btn--ghost" onClick={() => fileInputRef.current && fileInputRef.current.click()}><Plus size={14} /> Import Excel</button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={onFilePicked} />
            <button className="obd-btn obd-btn--ghost" onClick={add}><Plus size={14} /> Add line</button>
            <button className="obd-btn obd-btn--primary" onClick={save} disabled={saving}><Save size={14} /> {saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>

        <div className="obd-stat-row">
          <div className="obd-stat"><label>Line Items</label><span>{lines.length}</span></div>
          <div className="obd-stat"><label>Total Value</label><span>{fmtMoney(total)}</span></div>
        </div>

        {lines.length === 0 ? (
          <div className="obd-empty">No BOM / BOQ lines yet. "Add line" to start recording materials and quantities for this order book.</div>
        ) : (
          <div className="obd-table-wrap">
            <table className="obd-table">
              <thead>
                <tr>
                  <th>S.No</th><th>Component</th><th>Specifications</th><th>Make</th>
                  <th>Qty</th><th>Units</th><th>Unit Price</th><th>Amount</th><th>Notes</th><th></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td><input className="obd-inp" value={l.itemName} onChange={e => upd(i, 'itemName', e.target.value)} placeholder="Component name" /></td>
                    <td><input className="obd-inp" value={l.category} onChange={e => upd(i, 'category', e.target.value)} placeholder="Specifications" /></td>
                    <td><input className="obd-inp" value={l.make} onChange={e => upd(i, 'make', e.target.value)} placeholder="Make / brand" /></td>
                    <td><input className="obd-inp obd-inp--sm" type="number" min="0" step="any" value={l.quantity} onChange={e => upd(i, 'quantity', e.target.value)} /></td>
                    <td><UnitSelectCell className="obd-inp obd-inp--sm" value={l.unit} onChange={v => upd(i, 'unit', v)} /></td>
                    <td><input className="obd-inp obd-inp--sm" type="number" min="0" step="any" value={l.unitRate} onChange={e => upd(i, 'unitRate', e.target.value)} /></td>
                    <td style={{ fontWeight: 600 }}>{fmtMoney(lineAmount(l))}</td>
                    <td><input className="obd-inp" value={l.notes} onChange={e => upd(i, 'notes', e.target.value)} /></td>
                    <td><button className="obd-icon-btn obd-icon-btn--danger" onClick={() => rm(i)}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7} style={{ textAlign: 'right', fontWeight: 700 }}>Total</td>
                  <td style={{ fontWeight: 700 }}>{fmtMoney(total)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
//  PROGRESS TAB — planned vs actual across the three scopes
//  • Schedule:  real per-phase status + % (captured in Technical Scope)
//  • Billing:   planned-to-bill vs invoiced vs collected (live invoices)
//  • Cost:      planned vs actual procurement + spend (live PO/expenses)
// ─────────────────────────────────────────────────────────────────────────────
// (STATUS_CLASS map removed — unused after the port; status styling is inline below)

export const ProgressTab = ({ orderBook, authHeaders, showError, scheduleTitle, showFinancials = true }) => {
  const [phases, setPhases] = useState([]);
  const [summary, setSummary] = useState(null);
  const [planMeta, setPlanMeta] = useState({ start: '', end: '', unit: 'WEEK' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [scRes, sRes] = await Promise.all([
          fetch(`${API_BASE_URL}/projects/${orderBook.id}/scope`, { credentials: 'include', headers: authHeaders }),
          fetch(`${API_BASE_URL}/projects/${orderBook.id}/commercial-summary-v2`, { credentials: 'include', headers: authHeaders }),
        ]);
        const scData = await scRes.json();
        const sData = await sRes.json();
        if (cancelled) return;
        if (scData.success) {
          setPhases((scData.data.phases || []).map(p => {
            const subItems = Array.isArray(p.subItems) ? p.subItems : [];
            // Effective progress = WEIGHTED mean of sub-items (by weightPct), matching
            // the backend physical-progress roll-up. Falls back to a plain mean only
            // when no sub-item has a weight, and to the stored value when childless.
            let effectiveProgress;
            if (subItems.length > 0) {
              const wsum = subItems.reduce((s, si) => s + (Number(si.weightPct) || 0), 0);
              effectiveProgress = wsum > 0
                ? Math.round(subItems.reduce((s, si) => s + (Number(si.weightPct) || 0) * (Number(si.progressPercent) || 0), 0) / wsum)
                : Math.round(subItems.reduce((s, si) => s + (Number(si.progressPercent) || 0), 0) / subItems.length);
            } else {
              effectiveProgress = p.progressPercent != null ? Number(p.progressPercent) : 0;
            }
            return {
              phaseName: p.phaseName, status: p.status || 'Not Started',
              progressPercent: effectiveProgress,
              weightPct: p.weightPct,
              startWeek: p.startWeek ?? '', endWeek: p.endWeek ?? '',
              subItems,
            };
          }));
          const sc = scData.data.scope;
          setPlanMeta({ start: sc?.plannedStartDate || '', end: sc?.plannedEndDate || '', unit: sc?.planUnit || 'WEEK' });
        }
        if (sData.success) setSummary(sData.data.summary);
      } catch { if (!cancelled) showError('Failed to load progress'); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderBook.id]);

  if (loading) return <div className="obd-empty">Loading progress…</div>;

  const pct = (a, b) => b > 0 ? Math.min(100, (a / b) * 100) : 0;

  // Schedule: WEIGHTED average of per-phase progress by parent weight (matches the
  // backend physical-progress roll-up); plain mean only when no phase has a weight.
  const phaseWeightSum = phases.reduce((s, p) => s + (Number(p.weightPct) || 0), 0);
  const schedAvg = phases.length
    ? (phaseWeightSum > 0
        ? phases.reduce((s, p) => s + (Number(p.weightPct) || 0) * (Number(p.progressPercent) || 0), 0) / phaseWeightSum
        : phases.reduce((s, p) => s + (Number(p.progressPercent) || 0), 0) / phases.length)
    : 0;
  // A phase counts as "done" when its actual progress reaches 100% OR it's marked
  // Completed — so setting actuals to 100% updates the count even if the status
  // field wasn't manually flipped (progress drives completion).
  const doneCount = phases.filter(p => (Number(p.progressPercent) || 0) >= 100 || p.status === 'Completed').length;
  // Gantt grid: buckets across the plan dates ONLY (not stretched by a phase's
  // stored bucket). Bars clamp to this range — matches the Technical tab.
  const pUnit = planMeta.unit || 'WEEK';
  const pDuration = bucketCount(planMeta.start, planMeta.end, pUnit);
  const pCols = pDuration > 0 ? pDuration : 12;
  const pAbbr = pUnit === 'MONTH' ? 'M' : 'Wk';
  const hasGrid = pDuration > 0;

  // Billing + cost actuals
  const billPlanned = Number(summary?.totalBillingPlanned || 0);
  const billingLines = summary?.billingLines || [];
  const costLines = summary?.costLines || [];
  const invoiced = Number(summary?.totalInvoiced || 0);
  const paid = Number(summary?.totalPaid || 0);
  const costPlanned = Number(summary?.totalCostPlanned || 0);
  const actualCost = Number(summary?.totalProcurement || 0) + Number(summary?.totalSpend || 0);
  const projectLinked = summary?.projectLinked;

  // Waterfall allocation: distribute a real actual pool across planned items in
  // PLANNED-DATE order, filling each item up to its planned amount before moving
  // to the next. Items without a date sort last. Attributes untagged real money
  // (invoices / PO+spend) to scope items by schedule. Heuristic, not a tagged fact.
  const allocateWaterfall = (lines, pool) => {
    const ordered = lines
      .map((l, i) => ({ _i: i, amt: Number(l.amount || 0), t: parseDate(l.plannedDate)?.getTime() ?? Infinity }))
      .sort((a, b) => a.t - b.t);
    let remaining = Math.max(0, pool);
    const alloc = {};
    for (const l of ordered) {
      const fill = Math.min(l.amt, remaining);
      alloc[l._i] = fill;
      remaining -= fill;
    }
    return alloc;
  };

  // Timeline of single-date markers (billing invoice-dates / cost pay-dates) on
  // the same week/month grid as the schedule. Each line is a dot at its planned
  // date, labelled with item + amount. Items without a date are listed separately.
  const renderMarkerTimeline = (lines, accent) => {
    const dated = lines.map((l, i) => ({ ...l, _i: i, frac: dateToGridFraction(planMeta.start, planMeta.end, l.plannedDate) }));
    const placed = dated.filter(l => l.frac != null);
    const undated = dated.filter(l => l.frac == null);
    if (!hasGrid) return <div className="obd-banner obd-banner--warn">Set Planned Start and End in Technical Scope to plot the timeline.</div>;
    return (
      <div className="obd-mtl" style={{ '--cols': pCols }}>
        {/* header */}
        <div className="obd-mtl-head">
          {Array.from({ length: pCols }).map((_, b) => (
            <div key={b} className="obd-gantt-wk">
              <span className="obd-gantt-wk-num">{b + 1}</span>
              <span className="obd-gantt-wk-date">{bucketLabel(planMeta.start, b, pUnit)}</span>
            </div>
          ))}
        </div>
        {/* marker track */}
        <div className="obd-mtl-track">
          {placed.map((l) => (
            <div key={l._i} className="obd-mtl-marker" style={{ left: `${l.frac * 100}%` }} title={`${l.itemName}: ${fmtMoney(l.amount)} (${fmtDate(l.plannedDate)})`}>
              <span className={`obd-mtl-dot obd-mtl-dot--${accent}`} />
              <span className="obd-mtl-flag">{fmtMoney(l.amount)}<em>{l.itemName}</em></span>
            </div>
          ))}
        </div>
        {undated.length > 0 && (
          <p className="obd-spec" style={{ marginTop: 8 }}>
            No date set: {undated.map(l => l.itemName).join(', ')} — add a date in the Financial / Commercial tab to place these on the timeline.
          </p>
        )}
      </div>
    );
  };

  // Per-item actuals via waterfall: collected (paid) onto billing; spent onto cost.
  const billingAlloc = allocateWaterfall(billingLines, paid);
  const costAlloc = allocateWaterfall(costLines, actualCost);

  return (
    <div className="obd-stack">

      {/* ── 1. Schedule progress — two-bar Gantt (planned vs actual) ── */}
      <div className="obd-card">
        <h4 className="obd-card-title">{scheduleTitle || 'Schedule Progress (Planned vs Actual)'}</h4>
        {phases.length === 0 ? (
          <div className="obd-empty">No schedule phases yet. Add them in the Technical Scope tab.</div>
        ) : !hasGrid ? (
          <div className="obd-banner obd-banner--warn">Set Planned Start and End dates in Technical Scope to draw the timeline.</div>
        ) : (
          <>
            <div className="obd-stat-row">
              <div className="obd-stat"><label>Overall Actual</label><span>{schedAvg.toFixed(0)}%</span></div>
              <div className="obd-stat"><label>Phases Done</label><span>{doneCount} / {phases.length}</span></div>
            </div>

            <div className="obd-gantt obd-gantt--progress" style={{ '--cols': pCols }}>
              {/* header */}
              <div className="obd-gantt-head">
                <div className="obd-gantt-label">Phase</div>
                <div className="obd-gantt-weeks">
                  {Array.from({ length: pCols }).map((_, b) => (
                    <div key={b} className="obd-gantt-wk">
                      <span className="obd-gantt-wk-num">{b + 1}</span>
                      <span className="obd-gantt-wk-date">{bucketLabel(planMeta.start, b, pUnit)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {phases.map((p, i) => {
                const sRaw = Number(p.startWeek) || 1;
                const eRaw = Number(p.endWeek) || sRaw;
                const s = Math.min(Math.max(1, sRaw), pCols);
                const e = Math.min(Math.max(s, eRaw), pCols);
                const span = e - s + 1;
                const left = ((s - 1) / pCols) * 100;
                const plannedW = (span / pCols) * 100;
                const prog = Math.max(0, Math.min(100, Number(p.progressPercent) || 0));
                const actualW = plannedW * (prog / 100);
                return (
                  <div key={i} className="obd-gantt-prow">
                    <div className="obd-gantt-label" title={p.phaseName}>
                      {p.phaseName || `Phase ${i + 1}`}
                      {p.subItems?.length > 0 && <span className="obd-cell-faint" style={{ marginLeft: 5, fontSize: 10 }}>({p.subItems.length} items)</span>}
                    </div>
                    <div className="obd-gantt-ptrack">
                      <div className="obd-gantt-prow-line">
                        <div className="obd-gbar obd-gbar--planned" style={{ left: `${left}%`, width: `${plannedW}%` }}>
                          <span className="obd-gbar-tag">{pAbbr} {s}{s !== e ? `–${e}` : ''}</span>
                        </div>
                      </div>
                      <div className="obd-gantt-prow-line">
                        <div className="obd-gbar obd-gbar--actual" style={{ left: `${left}%`, width: `${actualW}%` }}>
                          {prog > 0 && <span className="obd-gbar-tag">{prog}%</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="obd-gantt-legend">
              <span><i className="obd-swatch obd-swatch--planned" /> Planned</span>
              <span><i className="obd-swatch obd-swatch--actual" /> Actual</span>
            </div>
          </>
        )}
      </div>

      {/* Financial timelines (Billing + Cost) — hidden when showFinancials=false
          (e.g. on the Project Dashboard, which shows only the tech-scope Gantt). */}
      {showFinancials && (<>
      {/* ── 2. Billing progress (receivables) — itemized ── */}
      <div className="obd-card">
        <h4 className="obd-card-title">Billing Progress (Receivables)</h4>
        {!projectLinked && <div className="obd-banner obd-banner--warn">No project linked — live invoice actuals unavailable.</div>}
        <div className="obd-stat-row">
          <div className="obd-stat"><label>Planned to Bill</label><span>{fmtMoney(billPlanned)}</span></div>
          <div className="obd-stat"><label>Invoiced</label><span>{fmtMoney(invoiced)}</span></div>
          <div className="obd-stat"><label>Collected</label><span>{fmtMoney(paid)}</span></div>
          <div className={`obd-stat ${invoiced > billPlanned && billPlanned > 0 ? 'obd-stat--over' : 'obd-stat--ok'}`}>
            <label>Yet to Invoice</label><span>{fmtMoney(Math.max(0, billPlanned - invoiced))}</span>
          </div>
        </div>
        {billingLines.length === 0 ? (
          <div className="obd-empty">No billing items planned yet. Add them in the Financial / Commercial tab.</div>
        ) : (
          <div className="obd-table-wrap">
            <table className="obd-table">
              <thead><tr><th>Item</th><th>Planned to Bill</th><th>Collected</th><th>Progress</th></tr></thead>
              <tbody>
                {billingLines.map((l, i) => {
                  const amt = Number(l.amount || 0);
                  const got = billingAlloc[i] || 0;
                  const p = amt > 0 ? Math.min(100, (got / amt) * 100) : 0;
                  return (
                    <tr key={i}>
                      <td>{l.itemName}</td>
                      <td>{fmtMoney(amt)}</td>
                      <td>{fmtMoney(got)}</td>
                      <td style={{ minWidth: 160 }}>
                        <div className="obd-mini-progress"><div className="obd-mini-progress-fill obd-mini-progress-fill--completed" style={{ width: `${p}%` }} /></div>
                        <span className="obd-mini-progress-label">{p.toFixed(0)}%</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr><td style={{ fontWeight: 700 }}>Total</td><td style={{ fontWeight: 700 }}>{fmtMoney(billPlanned)}</td><td style={{ fontWeight: 700 }}>{fmtMoney(paid)}</td><td /></tr></tfoot>
            </table>
          </div>
        )}
        {billingLines.length > 0 && (
          <>
            <div className="obd-mtl-title">Invoice timeline (planned dates)</div>
            {renderMarkerTimeline(billingLines, 'bill')}
          </>
        )}
        {billPlanned > 0 && (
          <>
            <div className="obd-progress" style={{ marginTop: 12 }}>
              <div className="obd-progress-fill" style={{ width: `${pct(invoiced, billPlanned)}%` }} />
              <span className="obd-progress-label">{pct(invoiced, billPlanned).toFixed(1)}% invoiced of planned (total)</span>
            </div>
            <div className="obd-progress" style={{ marginTop: 8 }}>
              <div className="obd-progress-fill obd-progress-fill--paid" style={{ width: `${pct(paid, billPlanned)}%` }} />
              <span className="obd-progress-label">{pct(paid, billPlanned).toFixed(1)}% collected of planned (total)</span>
            </div>
            <p className="obd-spec" style={{ marginTop: 8 }}>Per-item "Collected" is the real total collected ({fmtMoney(paid)}) allocated across items by planned invoice date (earliest first), since invoices aren't tagged to individual scope items. It's an estimate from invoice data, not a tagged figure.</p>
          </>
        )}
      </div>

      {/* ── 3. Cost progress (payables) — itemized ── */}
      <div className="obd-card">
        <h4 className="obd-card-title">Cost Progress (Payables)</h4>
        {!projectLinked && <div className="obd-banner obd-banner--warn">No project linked — live procurement/spend actuals unavailable.</div>}
        <div className="obd-stat-row">
          <div className="obd-stat"><label>Planned Cost</label><span>{fmtMoney(costPlanned)}</span></div>
          <div className="obd-stat"><label>Actual (PO + Spend)</label><span>{fmtMoney(actualCost)}</span></div>
          <div className={`obd-stat ${actualCost > costPlanned && costPlanned > 0 ? 'obd-stat--over' : 'obd-stat--ok'}`}>
            <label>Remaining</label><span>{fmtMoney(Math.max(0, costPlanned - actualCost))}</span>
          </div>
        </div>
        {costLines.length === 0 ? (
          <div className="obd-empty">No cost items planned yet. Add them in the Financial / Commercial tab.</div>
        ) : (
          <div className="obd-table-wrap">
            <table className="obd-table">
              <thead><tr><th>Item</th><th>Planned Cost</th><th>Spent</th><th>Progress</th></tr></thead>
              <tbody>
                {costLines.map((l, i) => {
                  const amt = Number(l.amount || 0);
                  const sp = costAlloc[i] || 0;
                  const p = amt > 0 ? Math.min(100, (sp / amt) * 100) : 0;
                  return (
                    <tr key={i}>
                      <td>{l.itemName}</td>
                      <td>{fmtMoney(amt)}</td>
                      <td>{fmtMoney(sp)}</td>
                      <td style={{ minWidth: 160 }}>
                        <div className="obd-mini-progress"><div className="obd-mini-progress-fill obd-mini-progress-fill--in-progress" style={{ width: `${p}%` }} /></div>
                        <span className="obd-mini-progress-label">{p.toFixed(0)}%</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr><td style={{ fontWeight: 700 }}>Total</td><td style={{ fontWeight: 700 }}>{fmtMoney(costPlanned)}</td><td style={{ fontWeight: 700 }}>{fmtMoney(actualCost)}</td><td /></tr></tfoot>
            </table>
          </div>
        )}
        {costLines.length > 0 && (
          <>
            <div className="obd-mtl-title">Payment timeline (planned dates)</div>
            {renderMarkerTimeline(costLines, 'cost')}
          </>
        )}
        {costPlanned > 0 && (
          <>
            <div className="obd-progress" style={{ marginTop: 12 }}>
              <div className={`obd-progress-fill ${actualCost > costPlanned ? 'obd-progress-fill--over' : ''}`} style={{ width: `${pct(actualCost, costPlanned)}%` }} />
              <span className="obd-progress-label">{pct(actualCost, costPlanned).toFixed(1)}% spent of planned (total)</span>
            </div>
            <p className="obd-spec" style={{ marginTop: 8 }}>Per-item "Spent" is the real total ({fmtMoney(actualCost)}) allocated across items by planned pay date (earliest first), since POs/expenses aren't tagged to individual scope items. It's an estimate from procurement data, not a tagged figure.</p>
          </>
        )}
      </div>
      </>)}

    </div>
  );
};

export default OrderBookDetailPage;