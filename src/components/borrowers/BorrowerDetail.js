// src/components/borrowers/BorrowerDetail.js
//
// The borrower record. Reached by clicking a row in the registry, and landed on
// directly after an import completes — that is the moment the derived panel
// earns its place, since the user sees nine values appear that they never typed.
//
// Organized into tabs (Overview / Sanction Letters / Repayment Schedule)
// rather than one long scroll — every card and action below is the same one
// that existed before the tabs, just grouped so only one section's worth is
// on screen at a time. There is no separate Documents tab and no separate
// Sanction Detail page: a sanction's document actions (View/Download/
// Attach) live on its row in Sanction Letters, and clicking a row
// simply selects that sanction as the page's shared context — Overview and
// Repayment Schedule both read from it — rather than navigating anywhere.
// Sanction Details / Derived Values / the schedule itself live in
// SanctionOverviewPanel.js, reused here card by card. Both the active tab
// (?tab=) and the selected sanction (?sanctionId=) live in the URL, so
// either survives a refresh, a direct link, or browser back/forward.

import React, {
  useCallback, useEffect, useRef, useState,
} from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, FileText, Pencil, Plus,
  Building2, Users, Paperclip, Upload, Trash2, AlertTriangle, CalendarClock,
  Eye, Download, Check,
} from 'lucide-react';
import borrowerApi from '../../services/borrowerApi';
import CrmPreloader from '../preLoader';
import BorrowerFormModal from './BorrowerFormModal';
import SanctionFormModal from './SanctionFormModal';
import HierarchyPicker, { EMPTY_HIERARCHY, hierarchyFromBorrower, resolveHierarchyGroupId } from './HierarchyPicker';
import DocumentViewerModal from './DocumentViewerModal';
import SanctionCompareModal from './SanctionCompareModal';
import SanctionStatusBadge from './SanctionStatusBadge';
import {
  RepaymentScheduleSection, statusLabel,
} from './SanctionOverviewPanel';
import SanctionDetailView from './SanctionDetailView';
import { deriveRepaymentSchedule, buildTermScheduleViews } from './sanctionDerive';
// The Group/Sub Group entity-detail branch (see the `groupId` route param
// below) reuses these exact presentational pieces — no separate
// "GroupEntityDetail" page/design; this is the SAME detail-view component
// GroupDetail.js's own Direct Companies / direct-sanctions tables already use.
import { TypeBadge } from './GroupDetail';
import '../../pages-css/BorrowerRegistry.css';
import '../../pages-css/BorrowerRegistryPremium.css';

// Documents live inside the Sanction Letters tab now (each row carries its own
// View/Download/Attach actions) rather than as a tab of their own —
// a sanction letter's row is "the" place to manage that sanction and its file.
const TABS = [
  { key: 'overview', label: 'Overview', icon: Building2 },
  { key: 'letters', label: 'Sanction Letters', icon: FileText },
  { key: 'schedule', label: 'Repayment Schedule', icon: CalendarClock },
];
const TAB_KEYS = new Set(TABS.map((t) => t.key));


// Ref no. | date | amount — same order for every sanction dropdown option on
// this page, Overview and Repayment Schedule alike, so the two never read as
// two different pickers for the same thing.
const sanctionOptionLabel = (s) => [s.refNo, s.sanctionDate, s.sanctionedAmount].filter(Boolean).join(' | ');

/**
 * The "which sanction am I looking at" picker — shared by Overview and
 * Repayment Schedule so both stay on the exact same selected-sanction state
 * (selectSanction/?sanctionId=, see below) rather than each keeping its own.
 * Only ever rendered when there's a real choice to make (sanctions.length > 1
 * — see the two call sites).
 */
const SanctionSwitcher = ({ label, sanctions, active, onSelect }) => (
  <div className="brx-sanction-switch">
    <span className="brx-sanction-switch-label">{label}</span>
    <select
      className="brx-sanction-switch-select"
      value={active?.id ?? ''}
      onChange={(e) => {
        const s = sanctions.find((x) => String(x.id) === e.target.value);
        if (s) onSelect(s);
      }}
    >
      {sanctions.map((s) => (
        <option key={s.id} value={s.id}>{sanctionOptionLabel(s)}</option>
      ))}
    </select>
  </div>
);

/**
 * The "Sanctions" list row — the SAME table used for a company's own
 * Sanction Letters tab and, unmodified, for a Group/Sub Group's own (see
 * the `groupId` branch below): click a row to select it, Eye/Download (or
 * Attach, if nothing's uploaded yet) plus Edit/Delete on the right. Every
 * action is a callback prop — this component owns no data and no save
 * logic, so which owner (borrower vs Group/Sub Group) a click actually
 * saves against is entirely decided by whichever handler the caller passed
 * in, never by this component.
 */
const SanctionsTable = ({
  sanctions, active, onSelect, onStatusChanged,
  onViewDoc, onAttach, attaching, onEdit, onDelete,
}) => (
  <table className="br-table">
    <tbody>
      {sanctions.map((s) => {
        const isSelected = s.id === active?.id;
        return (
          <tr
            key={s.id}
            className={isSelected ? 'br-row-active' : ''}
            onClick={() => onSelect(s)}
          >
            <td className="br-mono">
              {isSelected && (
                <Check size={14} className="brx-selected-check" aria-hidden="true" />
              )}
              {s.refNo}
            </td>
            <td className="br-muted">{s.sanctionDate || '—'}</td>
            <td>{s.sanctionedAmount || '—'}</td>
            <td>
              <span className="br-chip">{statusLabel(s.status)}</span>
              {isSelected && <span className="brx-selected-chip">Selected</span>}
            </td>
            <td onClick={(e) => e.stopPropagation()}>
              <SanctionStatusBadge
                sanctionId={s.id}
                refNo={s.refNo}
                cin={s.cin}
                status={s.activeStatus}
                onChanged={onStatusChanged}
              />
            </td>
            <td
              className="br-right"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="br-row-actions">
                {s.hasDocument ? (
                  <>
                    <button
                      type="button"
                      className="br-icon-btn"
                      title={`View ${s.refNo}`}
                      aria-label={`View ${s.refNo}`}
                      onClick={() => onViewDoc(s)}
                    >
                      <Eye size={15} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="br-icon-btn"
                      title={`Download ${s.refNo}`}
                      aria-label={`Download ${s.refNo}`}
                      onClick={() => borrowerApi.downloadDocFile(s.id, s.sanctionDocName)}
                    >
                      <Download size={15} aria-hidden="true" />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="br-icon-btn"
                    title={`Attach letter to ${s.refNo}`}
                    aria-label={`Attach letter to ${s.refNo}`}
                    onClick={() => onAttach(s)}
                    disabled={attaching}
                  >
                    <Paperclip size={15} aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  className="br-icon-btn"
                  title={`Edit ${s.refNo}`}
                  aria-label={`Edit ${s.refNo}`}
                  onClick={() => onEdit(s)}
                >
                  <Pencil size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="br-icon-btn br-icon-danger"
                  title={`Delete ${s.refNo}`}
                  aria-label={`Delete ${s.refNo}`}
                  onClick={() => onDelete(s)}
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            </td>
          </tr>
        );
      })}
    </tbody>
  </table>
);

const BorrowerDetail = () => {
  // Exactly one of these is ever present on a given mount — which URL
  // matched (see App.js) decides it, and never changes for the lifetime of
  // that mount. Company ids and Group ids live in separate DB tables with
  // independently-assigned auto-increment values, so a bare id alone can't
  // tell them apart; the route prefix (no "group/" vs "group/") is what
  // already does, same as GroupDetail.js/BorrowerDetail's own routes always
  // have — this isn't new disambiguation, just a second route landing on
  // this same component instead of a dedicated one.
  const { id, groupId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [borrower, setBorrower] = useState(null);
  // Both the active tab and the selected sanction live in the URL rather than
  // plain component state, so either survives a refresh, a direct link, and
  // browser back/forward — and so a sanction picked in Sanction Letters stays
  // picked when the user switches to Repayment Schedule or Overview, without
  // opening any other page.
  const tabParam = searchParams.get('tab');
  const activeTab = TAB_KEYS.has(tabParam) ? tabParam : 'overview';
  const sanctionIdParam = searchParams.get('sanctionId');
  const setActiveTab = useCallback((key) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', key);
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const selectSanction = useCallback((s) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('sanctionId', String(s.id));
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const sanctions = borrower?.sanctions || [];
  // Gates the sanction-picker dropdown on Overview and Repayment Schedule —
  // both tabs themselves stay visible regardless of sanction count, but a
  // dropdown with only one (or zero) options is nothing but clutter.
  const hasMultipleSanctions = sanctions.length > 1;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editIdentity, setEditIdentity] = useState(false);
  const [changeOrg, setChangeOrg] = useState(false);
  const [orgHierarchy, setOrgHierarchy] = useState(EMPTY_HIERARCHY);
  const [savingOrg, setSavingOrg] = useState(false);
  const [orgError, setOrgError] = useState('');
  const [sanctionModal, setSanctionModal] = useState(null); // { mode, initial }
  const [viewerFor, setViewerFor] = useState(null);         // sanction being read
  const [attaching, setAttaching] = useState(false);        // parse in flight
  const [compare, setCompare] = useState(null);             // { sanction, parsed, file }
  const attachRef = useRef(null);
  const attachTargetRef = useRef(null);
  const importRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [deleteSanction, setDeleteSanction] = useState(null); // row awaiting confirmation
  const [deleting, setDeleting] = useState(false);

  const backToRegistry = useCallback(() => navigate('/lender/borrowers'), [navigate]);

  // The primary "Back" affordance is context-aware: a company that sits
  // inside a group returns to that group's page (with its Sub Group, if any,
  // expanded) rather than jumping all the way back to the flat Level-1
  // registry — regardless of how the user actually arrived here (drill-down
  // or a search result), since the target is computed from the borrower's
  // own parentGroupId/subGroupId, not from how navigation got here. Only a
  // genuinely standalone company (no group at all) still goes to the
  // registry. The explicit "Lender · Borrower Registry" breadcrumb link
  // always goes to the registry regardless — that's the deliberate escape
  // hatch back to Level 1.
  const backLabel = borrower?.parentGroupId ? `Back to ${borrower.parentGroupName}` : 'Back to Registry';
  const goBack = useCallback(() => {
    if (!borrower?.parentGroupId) { navigate('/lender/borrowers'); return; }
    const base = `/lender/borrowers/group/${borrower.parentGroupId}`;
    navigate(borrower.subGroupId ? `${base}?openSubGroup=${borrower.subGroupId}` : base);
  }, [navigate, borrower]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await borrowerApi.getById(id);
      setBorrower(data);
    } catch (e) {
      // Clears any previously-loaded borrower too, not just on the very
      // first load — otherwise a refetch that fails after an action that
      // already succeeded (e.g. deleting the one sanction that was the
      // only reason this borrower was visible at all) leaves the stale
      // pre-action data on screen under the error banner, which reads as
      // "the action failed" when it actually didn't.
      setError(e.message || 'Could not load this borrower');
      setBorrower(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  // `id` is undefined on the group route (no `:id` segment there) — never
  // call getById(undefined) in that case; the group-mode loaders below own
  // data-loading for that branch instead.
  useEffect(() => { if (!groupId) load(); }, [load, groupId]);

  // ── Group / Sub Group entity-detail branch — see the render section's
  // `if (groupId)` below. Independent state/loaders, all guarded to no-op
  // on the company route, so none of this touches the borrower path above. ──
  const [group, setGroup] = useState(null);
  const [groupLoading, setGroupLoading] = useState(true);
  const [groupError, setGroupError] = useState('');
  const [groupSanctions, setGroupSanctions] = useState([]);
  const [groupSanctionsLoading, setGroupSanctionsLoading] = useState(true);

  const loadGroup = useCallback(async () => {
    if (!groupId) return;
    setGroupLoading(true);
    setGroupError('');
    try {
      setGroup(await borrowerApi.getGroupDetail(groupId));
    } catch (e) {
      setGroupError(e.message || 'Could not load this group');
      setGroup(null);
    } finally {
      setGroupLoading(false);
    }
  }, [groupId]);
  useEffect(() => { loadGroup(); }, [loadGroup]);

  // This IS the entity/sanction detail view — Direct Companies and Sub
  // Groups belong on the hierarchy MANAGEMENT page (GroupDetail.js) only,
  // never duplicated here; this branch only ever needs the Group/Sub
  // Group's own direct sanctions.
  const loadGroupSanctions = useCallback(async () => {
    if (!groupId) return;
    setGroupSanctionsLoading(true);
    try {
      setGroupSanctions(await borrowerApi.listGroupSanctions(groupId));
    } catch (e) {
      setGroupError(e.message || "Could not load this group's own sanction letters");
    } finally {
      setGroupSanctionsLoading(false);
    }
  }, [groupId]);
  useEffect(() => { loadGroupSanctions(); }, [loadGroupSanctions]);

  const reloadGroup = () => {
    loadGroup();
    loadGroupSanctions();
  };

  const openChangeOrg = () => {
    setOrgHierarchy(hierarchyFromBorrower(borrower));
    setOrgError('');
    setChangeOrg(true);
  };

  const handleSaveOrg = async () => {
    setOrgError('');
    setSavingOrg(true);
    try {
      const groupId = await resolveHierarchyGroupId(orgHierarchy);
      await borrowerApi.updateHierarchy(borrower.id, {
        groupId, isSubsidiary: orgHierarchy.isSubsidiary, isSpv: orgHierarchy.isSpv,
      });
      setChangeOrg(false);
      await load();
    } catch (e) {
      setOrgError(e.message || 'Could not update the organization');
    } finally {
      setSavingOrg(false);
    }
  };

  // Escape leaves the page the same way the Back button does — same
  // context-aware target — the same gesture that closes the modals, so it
  // stays consistent across the module.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !editIdentity && !sanctionModal && !viewerFor
          && !compare && !deleteSanction && !changeOrg) {
        goBack();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goBack, editIdentity, sanctionModal, viewerFor, compare, deleteSanction, changeOrg]);

  const openDocument = (sanction) => setViewerFor(sanction);

  /**
   * Add a further sanction by importing its letter. Same parse as the registry
   * import, but the borrower is already known, so the review screen saves
   * against this record rather than matching on the name.
   */
  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setImporting(true);
    setError('');
    try {
      const parsed = await borrowerApi.parseSanction(file);
      setSanctionModal({ mode: 'import', initial: parsed, file });
    } catch (err) {
      setError(err.message || 'Could not read the document');
    } finally {
      setImporting(false);
    }
  };

  /**
   * Soft-deletes one sanction, leaving the borrower and any other letters
   * intact. Frees the reference number for a corrected re-import.
   */
  const handleDeleteSanction = async () => {
    if (!deleteSanction) return;
    setDeleting(true);
    setError('');
    try {
      await borrowerApi.removeSanction(deleteSanction.id);
      // If the deleted row was the one selected, drop it from the URL so the
      // page falls back to the latest remaining sanction rather than showing
      // cards for a record that's gone.
      if (String(sanctionIdParam) === String(deleteSanction.id)) {
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.delete('sanctionId');
          return next;
        }, { replace: true });
      }
      setDeleteSanction(null);
      if (groupId) await reloadGroup(); else await load();
    } catch (err) {
      setError(err.message || 'Could not delete this sanction');
      setDeleteSanction(null);
    } finally {
      setDeleting(false);
    }
  };

  /** Open the file picker for a specific sanction. */
  const startAttach = (sanction) => {
    attachTargetRef.current = sanction;
    attachRef.current?.click();
  };

  /**
   * A letter is being attached to a sanction whose values were typed by hand.
   * Parse it first and compare, so a mistyped figure surfaces against what the
   * lender actually wrote — the whole reason for re-reading rather than just
   * storing the file.
   */
  const handleAttachFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file after a cancel
    const sanction = attachTargetRef.current;
    if (!file || !sanction) return;

    setAttaching(true);
    setError('');
    try {
      const parsed = await borrowerApi.parseSanction(file);
      setCompare({ sanction, parsed, file });
    } catch (err) {
      // The document may be a scan, or an unreadable format. Storing it is
      // still useful even when nothing could be read from it.
      setCompare({ sanction, parsed: {}, file, parseFailed: err.message });
    } finally {
      setAttaching(false);
    }
  };

  /**
   * Apply whichever values the user chose to adopt, then store the document.
   * The save runs first: if it fails, nothing is attached and the record is
   * left exactly as it was.
   */
  const handleCompareConfirm = async (updates) => {
    const { sanction, file } = compare;
    setCompare(null);
    setAttaching(true);
    setError('');
    try {
      if (Object.keys(updates).length > 0) {
        // Same save, routed to whichever owner this sanction actually has —
        // a company (borrowerId) or, on the group route, the Group/Sub
        // Group itself (saveGroupSanction) — never a fake borrower.
        if (groupId) {
          await borrowerApi.saveGroupSanction(groupId, { ...sanction, ...updates, id: sanction.id }, null);
        } else {
          await borrowerApi.saveSanction({
            ...sanction,
            ...updates,
            id: sanction.id,
            borrowerId: borrower.id,
          }, null);
        }
      }
      await borrowerApi.uploadDoc(sanction.id, file);
      if (groupId) await reloadGroup(); else await load();
    } catch (err) {
      setError(err.message || 'Could not attach the letter');
    } finally {
      setAttaching(false);
    }
  };

  // ── Group / Sub Group branch — same detail-view shell as the company
  // render below (.br-page/.br-back/.brx-head/.br-tabstrip/.br-grid-2/
  // .br-card), just fed Group/Sub Group data instead of a borrower's. No
  // separate page component/design; this is the one and only detail view,
  // entity-aware. Level 2 (GroupDetail.js, the hierarchy MANAGEMENT page —
  // Import/Add Sanction/Add Sub Group/Edit/Delete) is untouched and stays
  // reachable via "Manage" below or by clicking the entity's name anywhere
  // else in the registry. ──
  if (groupId) {
    if (groupLoading) return <div className="br-page"><p className="br-muted">Loading…</p></div>;

    if (!group) {
      return (
        <div className="br-page">
          <button type="button" className="br-back" onClick={() => navigate('/lender/borrowers')}>
            <ArrowLeft size={16} aria-hidden="true" />
            Back to Registry
          </button>
          <div className="br-banner br-banner-danger">{groupError || 'Group not found'}</div>
        </div>
      );
    }

    const isParentGroup = !group.parentGroupId;
    const kind = isParentGroup ? 'Parent Group' : 'Sub Group';
    // Unlike a standalone company (no parentGroupId = truly nothing to go
    // back to but the Registry), a Parent Group with no parentGroupId of
    // its own IS itself the originating page — its own GroupDetail
    // management page always exists at /group/{group.id}, so Back must
    // land there, never on the flat Registry. A Sub Group's own back
    // target (its Parent Group, with this Sub Group's panel opened) is
    // unchanged.
    const groupBackLabel = group.parentGroupId ? `Back to ${group.parentGroupName}` : `Back to ${group.groupName}`;
    const groupGoBack = () => {
      if (!group.parentGroupId) { navigate(`/lender/borrowers/group/${group.id}`); return; }
      navigate(`/lender/borrowers/group/${group.parentGroupId}?openSubGroup=${group.id}`);
    };
    const groupActiveTab = TAB_KEYS.has(activeTab) ? activeTab : 'overview';

    // This IS a sanction detail view, not a Group/Sub Group summary page —
    // the entity owning the sanction (a Group/Sub Group here, a borrower on
    // the company path above) only decides which record supplies the data;
    // the exact same shared view/tabs a company sanction gets are reused
    // unchanged below (SanctionDetailView/RepaymentScheduleSection, imported
    // from SanctionDetailView.js/SanctionOverviewPanel.js — the SAME
    // components, not lookalikes). `?sanctionId=` picks which of this
    // Group/Sub Group's own direct sanctions is active, exactly like the
    // company path's own `active`/`selectSanction` above.
    const groupHasMultipleSanctions = groupSanctions.length > 1;
    const activeGroupSanction = (sanctionIdParam
      ? groupSanctions.find((s) => String(s.id) === String(sanctionIdParam))
      : null) || groupSanctions[0] || null;
    const groupScheduleView = activeGroupSanction ? deriveRepaymentSchedule(activeGroupSanction) : null;
    const groupTermScheduleViews = activeGroupSanction ? buildTermScheduleViews(activeGroupSanction) : [];
    // Never persisted, never a real borrower row — SanctionDetailView and
    // RepaymentScheduleSection only ever read `borrower?.borrowerName` off
    // this (as a display-name fallback / export filename), so the Group/Sub
    // Group's own real, already-stored name is all that's needed here.
    const groupAsBorrower = { borrowerName: group.groupName };

    return (
      <div className="br-page">
        <button type="button" className="br-back" onClick={groupGoBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          {groupBackLabel}
        </button>

        <div className="br-head">
          <div className="br-head-text">
            <button type="button" className="br-crumb" onClick={() => navigate('/lender/borrowers')}>
              Lender · Borrower Registry
            </button>
            <div className="brx-crumb-path">
              <button type="button" className="brx-crumb-link" onClick={() => navigate('/lender/borrowers')}>
                Borrower Registry
              </button>
              {group.parentGroupId && (
                <>
                  <span className="brx-crumb-sep">›</span>
                  <button
                    type="button" className="brx-crumb-link"
                    onClick={() => navigate(`/lender/borrowers/group/${group.parentGroupId}`)}
                  >
                    {group.parentGroupName}
                  </button>
                </>
              )}
              <span className="brx-crumb-sep">›</span>
              <span className="brx-crumb-current">{group.groupName}</span>
            </div>
            <h1 className="br-title">
              {group.groupName}
              <span className="br-badge" style={{ marginLeft: 10, verticalAlign: 'middle' }}>
                <TypeBadge label={kind} />
              </span>
            </h1>
            <p className="br-sub">
              {activeGroupSanction
                ? `${activeGroupSanction.refNo}${activeGroupSanction.sanctionDate ? ` · ${activeGroupSanction.sanctionDate}` : ''}`
                : 'No sanction letter on file'}
            </p>
          </div>
        </div>

        {groupError && <div className="br-banner br-banner-danger">{groupError}</div>}

        <div className="br-tabstrip">
          {TABS.map((t) => (
            <button
              key={t.key} type="button"
              className={`br-tab ${groupActiveTab === t.key ? 'br-tab-on' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              <t.icon size={15} aria-hidden="true" />
              {t.label}
            </button>
          ))}
          {groupHasMultipleSanctions && (groupActiveTab === 'overview' || groupActiveTab === 'schedule') && (
            <div className="br-tabstrip-switch">
              <SanctionSwitcher
                label="Viewing sanction:"
                sanctions={groupSanctions}
                active={activeGroupSanction}
                onSelect={selectSanction}
              />
            </div>
          )}
        </div>

        {groupActiveTab === 'overview' && (
          <SanctionDetailView borrower={groupAsBorrower} sanction={activeGroupSanction} />
        )}

        {groupActiveTab === 'letters' && (
          <section className="br-card">
            <header className="br-card-head">
              <h2 className="br-card-title">Sanctions</h2>
              <div className="br-docstrip-actions">
                <button
                  type="button"
                  className="br-btn br-btn-sm"
                  onClick={() => setSanctionModal({ mode: 'create', initial: null })}
                >
                  <Plus size={14} aria-hidden="true" />
                  Add new manually
                </button>
                <button
                  type="button"
                  className="br-btn br-btn-sm br-btn-primary"
                  onClick={() => importRef.current?.click()}
                  disabled={importing}
                >
                  <Upload size={14} aria-hidden="true" />
                  {importing ? 'Reading…' : 'Import new sanction letter'}
                </button>
              </div>
            </header>

            <input
              ref={importRef}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={handleImportFile}
              hidden
            />

            {groupSanctionsLoading ? (
              <p className="br-muted br-pad">Loading…</p>
            ) : groupSanctions.length === 0 ? (
              <div className="br-empty">
                <p>No sanction letter yet.</p>
                <div className="br-docstrip-actions">
                  <button
                    type="button"
                    className="br-btn"
                    onClick={() => setSanctionModal({ mode: 'create', initial: null })}
                  >
                    <Plus size={15} aria-hidden="true" />
                    Add new manually
                  </button>
                  <button
                    type="button"
                    className="br-btn br-btn-primary"
                    onClick={() => importRef.current?.click()}
                    disabled={importing}
                  >
                    <Upload size={15} aria-hidden="true" />
                    {importing ? 'Reading…' : 'Import new sanction letter'}
                  </button>
                </div>
              </div>
            ) : (
              <SanctionsTable
                sanctions={groupSanctions}
                active={activeGroupSanction}
                onSelect={selectSanction}
                onStatusChanged={reloadGroup}
                onViewDoc={openDocument}
                onAttach={startAttach}
                attaching={attaching}
                onEdit={(s) => setSanctionModal({ mode: 'edit', initial: s })}
                onDelete={setDeleteSanction}
              />
            )}
          </section>
        )}

        {groupActiveTab === 'schedule' && (
          <RepaymentScheduleSection
            borrower={groupAsBorrower}
            sanction={activeGroupSanction}
            scheduleView={groupScheduleView}
            termScheduleViews={groupTermScheduleViews}
          />
        )}

        {compare && (
          <SanctionCompareModal
            current={compare.sanction}
            parsed={compare.parsed}
            fileName={compare.file?.name}
            onCancel={() => setCompare(null)}
            onConfirm={handleCompareConfirm}
          />
        )}

        {viewerFor && (
          <DocumentViewerModal
            sanctionId={viewerFor.id}
            fileName={viewerFor.sanctionDocName}
            onClose={() => setViewerFor(null)}
          />
        )}

        {deleteSanction && (
          <div className="br-modal-backdrop" onMouseDown={() => setDeleteSanction(null)}>
            <div
              className="br-modal br-modal-confirm"
              onMouseDown={(e) => e.stopPropagation()}
              role="alertdialog"
              aria-modal="true"
              aria-label="Confirm delete sanction"
            >
              <div className="br-modal-head">
                <div className="br-viewer-title">
                  <AlertTriangle size={18} className="br-tone-warn" aria-hidden="true" />
                  <div className="br-viewer-title-text">
                    <h3 className="br-modal-title">Delete this sanction?</h3>
                    <p className="br-modal-sub br-mono">{deleteSanction.refNo}</p>
                  </div>
                </div>
              </div>
              <div className="br-modal-body br-modal-body-single">
                <p className="br-confirm-text">This cannot be undone.</p>
              </div>
              {error && <div className="br-banner br-banner-danger">{error}</div>}
              <div className="br-modal-foot">
                <button type="button" className="br-btn" onClick={() => setDeleteSanction(null)} disabled={deleting}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="br-btn br-btn-danger"
                  onClick={handleDeleteSanction}
                  disabled={deleting}
                >
                  <Trash2 size={15} aria-hidden="true" />
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        {sanctionModal && (
          <SanctionFormModal
            mode={sanctionModal.mode}
            initial={sanctionModal.initial}
            file={sanctionModal.file || null}
            groupTarget={{ groupId: group.id, groupName: group.groupName, type: isParentGroup ? 'GROUP' : 'SUB_GROUP' }}
            allowAttach={sanctionModal.mode === 'create'}
            onClose={() => setSanctionModal(null)}
            onSaved={() => { reloadGroup(); }}
          />
        )}
      </div>
    );
  }

  if (loading) return <div className="br-page"><p className="br-muted">Loading…</p></div>;

  if (!borrower) {
    return (
      <div className="br-page">
        <button type="button" className="br-back" onClick={backToRegistry}>
          <ArrowLeft size={16} aria-hidden="true" />
          Back to registry
        </button>
        <div className="br-banner br-banner-danger">{error || 'Borrower not found'}</div>
      </div>
    );
  }

  const explicitSanction = sanctionIdParam
    ? sanctions.find((s) => String(s.id) === String(sanctionIdParam))
    : null;
  const active = explicitSanction || sanctions[0] || null;
  // The full per-period repayment schedule isn't part of what the backend
  // returns for a sanction — it's computed client-side from the saved
  // record the exact same way SanctionFormModal computes it live from the
  // in-progress form, since a saved sanction already carries the identical
  // field names (sanctionFields.js's key IS the DTO property).
  const pageScheduleView = active ? deriveRepaymentSchedule(active) : null;
  const pageTermScheduleViews = active ? buildTermScheduleViews(active) : [];

  return (
    <div className="br-page">
      {(importing || attaching) && <CrmPreloader text="Reading sanction letter…" />}
      {/* Back sits above the title on its own line, so it reads as leaving the
          page rather than as an action on the record. */}
      <button type="button" className="br-back" onClick={goBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        {backLabel}
      </button>

      <div className="br-head">
        <div className="br-head-text">
          <button type="button" className="br-crumb" onClick={backToRegistry}>
            Lender · Borrower Registry
          </button>
          {(borrower.parentGroupName || borrower.subGroupName) && (
            <div className="brx-crumb-path">
              {borrower.parentGroupName && (
                borrower.parentGroupId ? (
                  <button
                    type="button" className="brx-crumb-link"
                    onClick={() => navigate(`/lender/borrowers/group/${borrower.parentGroupId}`)}
                  >
                    {borrower.parentGroupName}
                  </button>
                ) : <span>{borrower.parentGroupName}</span>
              )}
              {borrower.subGroupName && (
                <>
                  <span className="brx-crumb-sep">›</span>
                  {/* A Sub Group has no page of its own — it's an expandable
                      section on its Parent Group's page (GroupDetail.js) —
                      so this always routes to the Parent Group with that
                      section opened, never to the Sub Group's own id. */}
                  {(borrower.subGroupId && borrower.parentGroupId) ? (
                    <button
                      type="button" className="brx-crumb-link"
                      onClick={() => navigate(
                        `/lender/borrowers/group/${borrower.parentGroupId}?openSubGroup=${borrower.subGroupId}`,
                      )}
                    >
                      {borrower.subGroupName}
                    </button>
                  ) : <span>{borrower.subGroupName}</span>}
                </>
              )}
              <span className="brx-crumb-sep">›</span>
              <span className="brx-crumb-current">{borrower.borrowerName}</span>
            </div>
          )}
          <h1 className="br-title">
            {borrower.borrowerName}
            {borrower.companyType && borrower.companyType !== 'Standalone' && (
              <span className="br-badge" style={{ marginLeft: 10, verticalAlign: 'middle' }}>
                {borrower.companyType}
              </span>
            )}
          </h1>
          <p className="br-sub">
            {active
              ? `${active.refNo}${active.sanctionDate ? ` · ${active.sanctionDate}` : ''}`
              : 'No sanction letter on file'}
          </p>
        </div>
      </div>

      {error && <div className="br-banner br-banner-danger">{error}</div>}

      <div className="br-tabstrip">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`br-tab ${activeTab === t.key ? 'br-tab-on' : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            <t.icon size={15} aria-hidden="true" />
            {t.label}
          </button>
        ))}
        {/* Same picker, same selection, shown once inline with the tabs
            rather than repeated inside both Overview and Repayment
            Schedule's own content — a single sanction (or none) needs no
            picker at all, and it never shows on Sanction Letters, which is
            itself the place to pick a row. */}
        {hasMultipleSanctions && (activeTab === 'overview' || activeTab === 'schedule') && (
          <div className="br-tabstrip-switch">
            <SanctionSwitcher
              label="Viewing sanction:"
              sanctions={sanctions}
              active={active}
              onSelect={selectSanction}
            />
          </div>
        )}
      </div>

      {activeTab === 'overview' && (
        <SanctionDetailView borrower={borrower} sanction={active} />
      )}

      {activeTab === 'letters' && (
        <section className="br-card">
          <header className="br-card-head">
            <h2 className="br-card-title">Sanctions</h2>
            <div className="br-docstrip-actions">
              <button
                type="button"
                className="br-btn br-btn-sm"
                onClick={openChangeOrg}
                disabled={borrower.canEditBorrower === false}
                title={borrower.canEditBorrower === false
                  ? "You can view this company because you're on a sanction under it, but only its creator or team can change its organization."
                  : undefined}
              >
                <Users size={14} aria-hidden="true" />
                Change organization
              </button>
              <button
                type="button"
                className="br-btn br-btn-sm"
                onClick={() => setSanctionModal({ mode: 'create', initial: null })}
              >
                <Plus size={14} aria-hidden="true" />
                Add new manually
              </button>
              <button
                type="button"
                className="br-btn br-btn-sm br-btn-primary"
                onClick={() => importRef.current?.click()}
                disabled={importing}
              >
                <Upload size={14} aria-hidden="true" />
                {importing ? 'Reading…' : 'Import new sanction letter'}
              </button>
            </div>
          </header>

          <input
            ref={importRef}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={handleImportFile}
            hidden
          />

          {sanctions.length === 0 ? (
            <div className="br-empty">
              <p>No sanction letter yet.</p>
              <div className="br-docstrip-actions">
                <button
                  type="button"
                  className="br-btn"
                  onClick={() => setSanctionModal({ mode: 'create', initial: null })}
                >
                  <Plus size={15} aria-hidden="true" />
                  Add new manually
                </button>
                <button
                  type="button"
                  className="br-btn br-btn-primary"
                  onClick={() => importRef.current?.click()}
                  disabled={importing}
                >
                  <Upload size={15} aria-hidden="true" />
                  {importing ? 'Reading…' : 'Import new sanction letter'}
                </button>
              </div>
            </div>
          ) : (
            <SanctionsTable
              sanctions={sanctions}
              active={active}
              onSelect={selectSanction}
              onStatusChanged={load}
              onViewDoc={openDocument}
              onAttach={startAttach}
              attaching={attaching}
              onEdit={(s) => setSanctionModal({ mode: 'edit', initial: s })}
              onDelete={setDeleteSanction}
            />
          )}
        </section>
      )}

      {activeTab === 'schedule' && (
        <RepaymentScheduleSection
          borrower={borrower} sanction={active} scheduleView={pageScheduleView}
          termScheduleViews={pageTermScheduleViews}
        />
      )}

      {/* Not tied to any one tab — each Sanction Letters row's View/Download/
          Attach action can trigger this regardless of which tab is
          on screen. */}
      <input
        ref={attachRef}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={handleAttachFile}
        hidden
      />

      {deleteSanction && (
        <div className="br-modal-backdrop" onMouseDown={() => setDeleteSanction(null)}>
          <div
            className="br-modal br-modal-confirm"
            onMouseDown={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-label="Confirm delete sanction"
          >
            <div className="br-modal-head">
              <div className="br-viewer-title">
                <AlertTriangle size={18} className="br-tone-warn" aria-hidden="true" />
                <div className="br-viewer-title-text">
                  <h3 className="br-modal-title">Delete this sanction?</h3>
                  <p className="br-modal-sub br-mono">{deleteSanction.refNo}</p>
                </div>
              </div>
            </div>
            <div className="br-modal-body br-modal-body-single">
              <p className="br-confirm-text">
                {deleteSanction.hasDocument
                  ? <>The stored letter <strong>{deleteSanction.sanctionDocName}</strong> will
                      be removed with it.</>
                  : 'No letter is attached to this sanction.'}
              </p>
              <p className="br-muted br-confirm-note">
                {borrower.borrowerName} stays on the registry. The record is archived rather
                than erased, so this reference number becomes free to import again.
              </p>
            </div>
            <div className="br-modal-foot">
              <button
                type="button"
                className="br-btn"
                onClick={() => setDeleteSanction(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="br-btn br-btn-danger"
                onClick={handleDeleteSanction}
                disabled={deleting}
              >
                <Trash2 size={15} aria-hidden="true" />
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {compare && (
        <SanctionCompareModal
          current={compare.sanction}
          parsed={compare.parsed}
          fileName={compare.file?.name}
          onCancel={() => setCompare(null)}
          onConfirm={handleCompareConfirm}
        />
      )}

      {viewerFor && (
        <DocumentViewerModal
          sanctionId={viewerFor.id}
          fileName={viewerFor.sanctionDocName}
          onClose={() => setViewerFor(null)}
        />
      )}

      {editIdentity && (
        <BorrowerFormModal
          borrower={borrower}
          onClose={() => setEditIdentity(false)}
          onSaved={() => { setEditIdentity(false); load(); }}
        />
      )}

      {changeOrg && (
        <div className="br-modal-backdrop" onMouseDown={() => setChangeOrg(false)}>
          <div className="br-modal" onMouseDown={(e) => e.stopPropagation()}
            role="dialog" aria-modal="true" aria-label="Change organization">
            <div className="br-modal-head">
              <div>
                <h3 className="br-modal-title">Change organization</h3>
                <p className="br-modal-sub">
                  Moving {borrower.borrowerName}
                  {active && <> (<span className="brx-ref-highlight">{active.refNo}</span>)</>}
                  {' '}between groups never touches its sanctions,
                  documents or repayment schedules.
                </p>
              </div>
              <button type="button" className="br-icon-btn" onClick={() => setChangeOrg(false)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="br-modal-body br-modal-body-single">
              <HierarchyPicker value={orgHierarchy} onChange={setOrgHierarchy} />
            </div>
            {orgError && <div className="br-banner br-banner-danger">{orgError}</div>}
            <div className="br-modal-foot">
              <button type="button" className="br-btn" onClick={() => setChangeOrg(false)} disabled={savingOrg}>
                Cancel
              </button>
              <button type="button" className="br-btn br-btn-primary" onClick={handleSaveOrg} disabled={savingOrg}>
                {savingOrg ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {sanctionModal && (
        <SanctionFormModal
          mode={sanctionModal.mode}
          initial={sanctionModal.initial}
          file={sanctionModal.file || null}
          borrowerId={borrower.id}
          borrowerName={borrower.borrowerName}
          allowAttach={sanctionModal.mode === 'create'}
          onClose={() => setSanctionModal(null)}
          // Create/import stay open after Save to show the Repayment
          // Schedule tab it just computed; edit closes itself (see
          // SanctionFormModal's own save handler). Either way onSaved
          // fires so this page's own data (the sanctions list, the derived
          // panel) refreshes in the background.
          onSaved={() => { load(); }}
        />
      )}
    </div>
  );
};

export default BorrowerDetail;
