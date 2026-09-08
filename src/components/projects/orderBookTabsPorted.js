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
 *      name-matched merge rather than a wholesale replace: a phase or sub-item
 *      whose name is still in the standard keeps its id, dates, progress and
 *      budget. This matters because a sub-item has no id anywhere — its name is
 *      the key for project_progress_periods.sub_item_key and for the planned-
 *      budget merge in ProjectDetailService.saveScopeBudgets, both of which
 *      compare with an exact String.equals. A matched row therefore keeps its
 *      STORED spelling; only description/weight are refreshed from the template.
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
import { ArrowLeft, Plus, Trash2, Save, Wand2, Check, Download, RotateCcw } from 'lucide-react';
import { FaFilePdf, FaFileImage, FaFileAlt, FaFileDownload, FaExternalLinkAlt } from 'react-icons/fa';
import '../../pages-css/OrderBookDetail.css';
import ConfirmationModal from '../ConfirmationModal.js';
import useConfirmationModal from '../HandleConfirmationModal.js';
import LocationPicker from '../LocationPicker.js';
import UnitSelectCell from '../Dropdowns/UnitSelectCell.js';

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
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Tolerant date parser: accepts ISO (yyyy-mm-dd, what <input type=date> emits and
// what the backend LocalDate serializes to) AND dd-mm-yyyy / dd/mm/yyyy (what may
// have been stored earlier or come from a display layer). Returns a Date or null.
const parseDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  const str = String(v).trim();
  // ISO: yyyy-mm-dd (optionally with time)
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) { const d = new Date(+m[1], +m[2] - 1, +m[3]); return isNaN(d) ? null : d; }
  // dd-mm-yyyy or dd/mm/yyyy
  m = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) { const d = new Date(+m[3], +m[2] - 1, +m[1]); return isNaN(d) ? null : d; }
  const d = new Date(str); // last resort
  return isNaN(d) ? null : d;
};

// How many buckets between start and end for the given unit. Returns 0 when the
// dates are missing/invalid (caller treats 0 as "not set" — no misleading default).
const bucketCount = (startStr, endStr, unit) => {
  const s = parseDate(startStr), e = parseDate(endStr);
  if (!s || !e || e < s) return 0;
  if (unit === 'MONTH') {
    return Math.max(1, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1);
  }
  const days = Math.round((e - s) / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.ceil((days + 1) / 7));
};

// Label for bucket index n (0-based): weekly → "10 Jun", monthly → "Jun 2026".
const bucketLabel = (startStr, n, unit) => {
  const s = parseDate(startStr);
  if (!s) return unit === 'MONTH' ? `M${n + 1}` : `W${n + 1}`;
  if (unit === 'MONTH') {
    const d = new Date(s.getFullYear(), s.getMonth() + n, 1);
    return `${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`;
  }
  const d = new Date(s); d.setDate(d.getDate() + n * 7);
  return `${d.getDate()} ${MONTH_ABBR[d.getMonth()]}`;
};

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
const bucketToISODate = (startStr, n, unit) => {
  const s = parseDate(startStr);
  if (!s || n == null || n < 0) return '';
  const d = unit === 'MONTH'
    ? new Date(s.getFullYear(), s.getMonth() + n, 1)
    : (() => { const x = new Date(s); x.setDate(x.getDate() + n * 7); return x; })();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

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

const blankSubItem = () => ({ name: '', status: 'Not Started', progressPercent: 0, weightPct: '', weightManual: false, description: '', startDate: '', endDate: '', startWeek: '', endWeek: '', customName: false });

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
          }
          return {
            id: p.id, seqNo: p.seqNo, phaseName: p.phaseName, phaseDescription: p.phaseDescription || '',
            startWeek: p.startWeek ?? '', endWeek: p.endWeek ?? '',
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
  // Sub-items matter even more here: they have no id at all, so their NAME is the
  // key for project_progress_periods.sub_item_key and for the planned-budget merge
  // in ProjectDetailService.saveScopeBudgets — which compares with an exact
  // String.equals. So a matched sub-item keeps its STORED spelling and its
  // execution fields; only the definition (description/weight) is refreshed.
  //
  // Matching is trim + lowercase, the same normalisation the backend's
  // ProjectLeadSeedService.activityKey uses.
  const nameKey = (v) => String(v == null ? '' : v).trim().toLowerCase();

  const mergeSuggestedSubs = (prior, incoming) => {
    const inc = incoming || [];
    if (!inc.length) return [];
    const byKey = new Map();
    (prior || []).forEach(si => {
      const k = nameKey(si.name);
      if (k && !byKey.has(k)) byKey.set(k, si); // first wins; duplicate names are possible
    });
    return distributeSubWeights(inc.map(si => {
      const was = byKey.get(nameKey(si.name));
      const base = {
        ...blankSubItem(),
        name: si.name || '',
        description: si.description || '',
        weightPct: si.weightPct != null ? Number(si.weightPct) : '',
        weightManual: si.weightManual === true,
        customName: !ACTIVITY_OPTIONS.includes(si.name),
      };
      if (!was) return base;
      return {
        ...was,                                   // status, progress, dates, budget
        name: was.name,                           // stored spelling is the identity
        description: si.description || was.description,
        weightPct: base.weightPct === '' ? was.weightPct : base.weightPct,
        weightManual: base.weightManual || was.weightManual === true,
      };
    }));
  };

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

  // ── Auto weight distribution for sub-items (relative-to-parent, sum = 100) ──
  // Manually-edited sub-items (weightManual === true) keep their value; the rest
  // share whatever is left of 100 equally. This is what makes the system
  // "auto-calc first, editable after" without clobbering the user's inputs.
  const distributeSubWeights = (subItems) => {
    const named = subItems.filter(si => si != null);
    if (named.length === 0) return subItems;
    const manual = named.filter(si => si.weightManual === true);
    const manualSum = manual.reduce((s, si) => s + (Number(si.weightPct) || 0), 0);
    const remaining = Math.max(0, 100 - manualSum);
    // Indices (within subItems) of the auto sub-items, in order.
    const autoIdx = subItems.map((si, idx) => ({ si, idx }))
      .filter(x => x.si != null && x.si.weightManual !== true)
      .map(x => x.idx);
    const nAuto = autoIdx.length;
    if (nAuto === 0) return subItems;
    // Base share rounded to 2 decimals; the LAST auto sub absorbs the remainder
    // so the auto portion sums to exactly `remaining` (and the group to 100).
    const base = Number((remaining / nAuto).toFixed(2));
    const lastAuto = autoIdx[autoIdx.length - 1];
    const allButLast = base * (nAuto - 1);
    const lastShare = Number((remaining - allButLast).toFixed(2));
    return subItems.map((si, idx) => {
      if (si == null || si.weightManual === true) return si;
      return { ...si, weightPct: idx === lastAuto ? lastShare : base };
    });
  };
  // Add a sub-item, then re-even the auto-weighted ones so the group targets 100.
  const addSubItem = (i) => {
    const p = phases[i];
    const next = distributeSubWeights([...(p.subItems || []), blankSubItem()]);
    updatePhase(i, 'subItems', next, { expanded: true });
  };
  // Remove a sub-item, then re-even the remaining auto-weighted ones.
  const removeSubItem = (i, si_i) => {
    const p = phases[i];
    const next = distributeSubWeights((p.subItems || []).filter((_, idx) => idx !== si_i));
    updatePhase(i, 'subItems', next);
  };
  // Live edit while typing: mark the sub manual, update its value, and warn if
  // the group is off 100 in EITHER direction. No snapping yet — snapping while
  // the user is mid-type would make digits jump. Snap happens on blur.
  const setSubWeight = (i, si_i, raw) => {
    const p = phases[i];
    const val = raw === '' ? '' : Math.max(0, Number(raw));
    const updated = (p.subItems || []).map((si, idx) =>
      idx === si_i ? { ...si, weightPct: val, weightManual: raw !== '' } : si);
    const sum = updated.reduce((s, si) => s + (Number(si.weightPct) || 0), 0);
    if (sum > 100.005) {
      showError(`Sub-item weights under "${p.phaseName || 'this item'}" total ${sum.toFixed(2)}% — reduce to 100%.`);
    } else if (sum < 99.995 && sum > 0) {
      showError(`Sub-item weights under "${p.phaseName || 'this item'}" total ${sum.toFixed(2)}% — must add up to 100%.`);
    }
    updatePhase(i, 'subItems', updated);
  };
  // On blur: if the group is within a rounding whisker of 100 (±0.5), snap it
  // to EXACTLY 100 by putting the delta on the last AUTO sub (or, if all subs
  // are manual, on the one just edited). This is what lets a user type
  // 33.33/33.33/33.33 and still save — the last one becomes 33.34. If the group
  // is genuinely wrong (e.g. 90 or 110), it is left alone so save rejects it.
  const snapSubGroup = (i, editedIdx) => {
    const p = phases[i];
    const subs = p.subItems || [];
    if (subs.length === 0) return;
    const sum = subs.reduce((s, si) => s + (Number(si.weightPct) || 0), 0);
    if (sum === 0) return;
    const delta = 100 - sum;
    if (Math.abs(delta) > 0.5) return; // real mismatch — let the save gate catch it
    if (Math.abs(delta) < 0.0001) return; // already exact
    const autoIdxs = subs.map((si, idx) => ({ si, idx }))
      .filter(x => x.si.weightManual !== true).map(x => x.idx);
    const target = autoIdxs.length > 0 ? autoIdxs[autoIdxs.length - 1] : editedIdx;
    const updated = subs.map((si, idx) => idx === target
      ? { ...si, weightPct: Number(((Number(si.weightPct) || 0) + delta).toFixed(2)) }
      : si);
    updatePhase(i, 'subItems', updated);
  };
  // Reset a parent's sub-item weights back to equal auto-split.
  const resetSubWeights = (i) => {
    const p = phases[i];
    const cleared = (p.subItems || []).map(si => ({ ...si, weightManual: false }));
    updatePhase(i, 'subItems', distributeSubWeights(cleared));
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
    // A sub-item group MUST total 100% (it is relative-to-parent). Because
    // auto-split and the blur-snap both resolve to exactly 100, a genuine
    // rounding case never reaches here; only a real mismatch (e.g. 90 or 110)
    // gets blocked. Tiny epsilon guards against float noise.
    for (const p of phases) {
      const subs = (p.subItems || []).filter(si => si.name && si.name.trim());
      if (subs.length > 0) {
        const sum = subs.reduce((s, si) => s + (Number(si.weightPct) || 0), 0);
        if (Math.abs(sum - 100) > 0.01) {
          showError(`Sub-item weights under "${p.phaseName}" total ${sum.toFixed(2)}% — they must add up to exactly 100% before saving.`);
          return;
        }
      }
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
          // Sub-item weightPct is RELATIVE to the parent (sums to 100 within it).
          subItems: (p.subItems || []).filter(si => si.name && si.name.trim()).map(si => ({
            ...si,
            progressPercent: isSimple
              ? (Number(si.progressPercent) || 0)
              : Math.round(leafActual(leafForSub(p, si))),
            plannedProgressPct: isSimple
              ? (si.plannedProgressPct === '' || si.plannedProgressPct == null ? null : Number(si.plannedProgressPct))
              : (si.plannedProgressPct ?? null),
          })),
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
  // A single sub-item's ABSOLUTE project weight.
  const absSubWeight = (si) => parentSlice() * (num(si.weightPct) / 100);
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
  // Sub-item capital uses its ABSOLUTE project weight (parentSlice × relative%).
  const subPlannedCap = (si) => plannedCap(absSubWeight(si));
  const subActualCap = (si) => subPlannedCap(si) * (num(si.progressPercent) / 100);
  const phasePlannedCap = (p) =>
    hasSubs(p)
      ? p.subItems.reduce((s, si) => s + subPlannedCap(si), 0)
      : plannedCap(parentSlice());   // childless parent owns its full slice
  const phaseActualCap = (p) => {
    if (hasSubs(p))
      return p.subItems.reduce((s, si) => s + subActualCap(si), 0);
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
  const leaves = [];
  phases.forEach(p => {
    if (hasSubs(p)) {
      p.subItems.filter(si => si.name && si.name.trim()).forEach(si => {
        leaves.push({ phaseId: p.id, subKey: si.name, label: si.name, parent: p.phaseName,
          start: num(p.startWeek) || 1, end: num(p.endWeek) || num(p.startWeek) || nBuckets, weight: absSubWeight(si) });
      });
    } else {
      leaves.push({ phaseId: p.id, subKey: null, label: p.phaseName, parent: null,
        start: num(p.startWeek) || 1, end: num(p.endWeek) || num(p.startWeek) || nBuckets, weight: parentSlice() });
    }
  });
  const pKey = (phaseId, subKey, period) => `${phaseId}|${subKey || ''}|${period}`;
  // Build the leaf object the week-modal expects, from a schedule row.
  const leafForPhase = (p) => ({ phaseId: p.id, subKey: null, label: p.phaseName, parent: null,
    start: num(p.startWeek) || 1, end: num(p.endWeek) || num(p.startWeek) || nBuckets, weight: parentSlice() });
  const leafForSub = (p, si) => ({ phaseId: p.id, subKey: si.name, label: si.name, parent: p.phaseName,
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
  const phaseActualProgress = (p) => {
    const subs = (p.subItems || []).filter(si => si.name && si.name.trim());
    if (subs.length === 0) return leafActualVal(p, null);
    const wsum = subs.reduce((s, si) => s + num(si.weightPct), 0);
    if (wsum > 0) return subs.reduce((s, si) => s + num(si.weightPct) * leafActualVal(p, si), 0) / wsum;
    return subs.reduce((s, si) => s + leafActualVal(p, si), 0) / subs.length;
  };
  const phasePlannedProgress = (p) => {
    const subs = (p.subItems || []).filter(si => si.name && si.name.trim());
    if (subs.length === 0) return leafPlannedVal(p, null);
    const wsum = subs.reduce((s, si) => s + num(si.weightPct), 0);
    if (wsum > 0) return subs.reduce((s, si) => s + num(si.weightPct) * leafPlannedVal(p, si), 0) / wsum;
    return subs.reduce((s, si) => s + leafPlannedVal(p, si), 0) / subs.length;
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
            <div className="obd-table-wrap">
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
                          {/* expand/collapse toggle */}
                          <td style={{ textAlign: 'center', padding: '0 4px' }}>
                            <button
                              type="button"
                              title={p.expanded ? 'Collapse sub-items' : 'Expand sub-items'}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#2563eb', padding: 2 }}
                              onClick={() => updatePhase(i, 'expanded', !p.expanded)}
                            >
                              {hasSubItems ? (p.expanded ? '▾' : '▸') : <span className="obd-dash">—</span>}
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

                        {/* ── Sub-item rows (visible when expanded) ────── */}
                        {p.expanded && (p.subItems || []).map((si, si_i) => (
                          <tr key={`${i}-si-${si_i}`} className="obd-row-sub-alt">
                            <td colSpan={2} className="obd-cell-faint" style={{ paddingLeft: 28, fontSize: 12 }}>└ {si_i + 1}</td>
                            <td>
                              {si.customName ? (
                                <div className="obd-cat-custom">
                                  <input className="obd-inp" value={si.name} autoFocus placeholder="Enter sub-item name"
                                    onChange={e => {
                                      const updated = [...p.subItems];
                                      updated[si_i] = { ...si, name: e.target.value };
                                      updatePhase(i, 'subItems', updated);
                                    }}
                                    onBlur={e => registerActivity(e.target.value)} />
                                  <button type="button" className="obd-cat-back" title="Back to list"
                                    onClick={() => {
                                      const updated = [...p.subItems];
                                      updated[si_i] = { ...si, customName: false, name: '' };
                                      updatePhase(i, 'subItems', updated);
                                    }}>↩</button>
                                </div>
                              ) : (
                                <select className="obd-inp"
                                  value={ACTIVITY_OPTIONS.includes(si.name) ? si.name : (si.name ? '__CURRENT__' : '')}
                                  onChange={e => {
                                    const updated = [...p.subItems];
                                    if (e.target.value === '__OTHER__') updated[si_i] = { ...si, customName: true, name: '' };
                                    else if (e.target.value === '__CURRENT__') return;
                                    else updated[si_i] = { ...si, name: e.target.value };
                                    updatePhase(i, 'subItems', updated);
                                  }}>
                                  <option value="">Select sub-item…</option>
                                  {si.name && !ACTIVITY_OPTIONS.includes(si.name) && <option value="__CURRENT__">{si.name}</option>}
                                  {ACTIVITY_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                                  <option value="__OTHER__">Other (type your own)…</option>
                                </select>
                              )}
                            </td>
                            <td>
                              <input className="obd-inp" value={si.description || ''} placeholder="Optional"
                                onChange={e => {
                                  const updated = [...p.subItems];
                                  updated[si_i] = { ...si, description: e.target.value };
                                  updatePhase(i, 'subItems', updated);
                                }} />
                            </td>
                            <td>
                              <div className="obd-progress-cell">
                                <input className={`obd-inp obd-inp--xs ${Math.abs(subWeightSum(p) - 100) > 0.5 ? 'obd-weight-banner--warn' : ''}`} type="number" min="0" max="100" step="any"
                                  value={si.weightPct ?? ''} placeholder="0"
                                  title="Weight relative to this parent (sub-items sum to 100% within the parent). Auto-filled; edit to override."
                                  onChange={e => setSubWeight(i, si_i, e.target.value)}
                                  onBlur={() => snapSubGroup(i, si_i)} />
                                <span className="obd-progress-cell-pct">%</span>
                              </div>
                            </td>
                            <td>
                              <input type="date" className="obd-inp obd-inp--sm" value={si.startDate || ''}
                                min={scope.plannedStartDate || undefined}
                                max={scope.plannedEndDate || undefined}
                                onChange={e => {
                                  const updated = [...p.subItems];
                                  updated[si_i] = { ...si, startDate: e.target.value };
                                  updatePhase(i, 'subItems', updated);
                                }} />
                            </td>
                            <td>
                              <input type="date" className="obd-inp obd-inp--sm" value={si.endDate || ''}
                                min={si.startDate || scope.plannedStartDate || undefined}
                                max={scope.plannedEndDate || undefined}
                                onChange={e => {
                                  const updated = [...p.subItems];
                                  updated[si_i] = { ...si, endDate: e.target.value };
                                  updatePhase(i, 'subItems', updated);
                                }} />
                            </td>                            <td>
                              <select className="obd-inp obd-inp--sm" value={si.status || 'Not Started'}
                                onChange={e => {
                                  const st = e.target.value;
                                  const updated = [...p.subItems];
                                  updated[si_i] = { ...si, status: st, progressPercent: st === 'Completed' ? 100 : st === 'Not Started' ? 0 : si.progressPercent };
                                  updatePhase(i, 'subItems', updated);
                                }}>
                                {PHASE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </td>
                            {isSimple ? (
                              <>
                                <td style={{ textAlign: 'center' }}>
                                  <input className="obd-inp obd-inp--xs" type="number" min="0" max="100" step="any"
                                    value={si.plannedProgressPct ?? ''} placeholder="0" title="Planned % for this sub-item"
                                    onChange={e => { const u = [...p.subItems]; u[si_i] = { ...si, plannedProgressPct: e.target.value }; updatePhase(i, 'subItems', u); }} />
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                  <input className="obd-inp obd-inp--xs" type="number" min="0" max="100" step="any"
                                    value={si.progressPercent ?? ''} placeholder="0" title="Actual % for this sub-item"
                                    onChange={e => { const u = [...p.subItems]; u[si_i] = { ...si, progressPercent: e.target.value }; updatePhase(i, 'subItems', u); }} />
                                </td>
                              </>
                            ) : (
                              <>
                                <td style={{ textAlign: 'center' }}
                                  className={leafPlanned(leafForSub(p, si)) > 100.01 ? 'obd-weight-banner--warn' : 'obd-cell-muted'}
                                  title="Planned % — from this item's weeks">
                                  {fmtW(leafPlanned(leafForSub(p, si)))}%
                                </td>
                                <td style={{ textAlign: 'center' }}
                                  className={leafActual(leafForSub(p, si)) > leafPlanned(leafForSub(p, si)) + 0.01 ? 'obd-weight-banner--warn' : 'obd-cap-cell--actual'}
                                  title="Actual % — from this item's weeks">
                                  {fmtW(leafActual(leafForSub(p, si)))}%
                                </td>
                              </>
                            )}
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {isDetailed && si.name && si.name.trim() && (
                                <button className="obd-btn obd-btn--ghost obd-btn--sm" style={{ marginRight: 4 }}
                                  title="Set week-wise planned & actual progress"
                                  onClick={() => setWeekModalLeaf(leafForSub(p, si))}>Weeks</button>
                              )}
                              <button className="obd-icon-btn obd-icon-btn--danger" title="Remove sub-item"
                                onClick={() => removeSubItem(i, si_i)}><Trash2 size={13} /></button>
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

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
  const subBudgetSum = (p) => (p.subItems || []).reduce((s, si) => s + bnum(si.plannedBudget), 0);
  const phaseBudget = (p) => (p.subItems && p.subItems.length > 0) ? subBudgetSum(p) : bnum(p.plannedBudget);
  const scopePartTotal = scopeTree.reduce((s, p) => s + phaseBudget(p), 0);
  // Budget-only extras live in the existing flat `cost` list (not the scope tree).
  const extrasTotal = cost.reduce((s, l) => s + bnum(l.amount), 0);
  const totalScopeBudget = scopePartTotal + extrasTotal;

  const setLeafBudget = (pi, val) => setScopeTree(prev => prev.map((p, idx) =>
    idx === pi ? { ...p, plannedBudget: val === '' ? '' : Math.max(0, Number(val)) } : p));
  const setSubBudget = (pi, si, val) => setScopeTree(prev => prev.map((p, idx) => {
    if (idx !== pi) return p;
    const subItems = p.subItems.map((s, j) => j === si ? { ...s, plannedBudget: val === '' ? '' : Math.max(0, Number(val)) } : s);
    return { ...p, subItems };
  }));
  const toggleExpand = (pi) => setScopeTree(prev => prev.map((p, idx) =>
    idx === pi ? { ...p, expanded: !p.expanded } : p));
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
        subBudgets: (p.subItems || []).map(si => ({
          name: si.name,
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
                        {hasSub && p.expanded && p.subItems.map((si, si_i) => {
                          const sBudget = bnum(si.plannedBudget);
                          const sPct = totalScopeBudget > 0 ? (sBudget / totalScopeBudget) * 100 : 0;
                          return (
                            <tr key={si_i}>
                              <td></td>
                              <td></td>
                              <td style={{ paddingLeft: 28 }} className="obd-cell-muted">↳ {si.name}</td>
                              <td className="obd-cell-faint">{si.weightPct != null && si.weightPct !== '' ? `${Number(si.weightPct)}%` : '—'}</td>
                              <td>
                                <input className="obd-inp obd-inp--sm" type="number" min="0" placeholder="0"
                                  value={si.plannedBudget ?? ''}
                                  onChange={e => setSubBudget(pi, si_i, e.target.value)} />
                              </td>
                              <td className="obd-cell-faint">{sPct.toFixed(1)}%</td>
                              <td></td>
                            </tr>
                          );
                        })}
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