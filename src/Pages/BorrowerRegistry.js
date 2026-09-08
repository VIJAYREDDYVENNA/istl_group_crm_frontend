// src/Pages/BorrowerRegistry.js
//
// Landing page for the Lender module. Shows the Group > Sub Group > Company
// hierarchy (via HierarchyTree) and carries the two ways a record starts:
// importing a sanction letter, or typing one in.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Upload, Search, Trash2, AlertTriangle,
  Users, FileCheck,
  IndianRupee, Building2, X,
} from 'lucide-react';
import borrowerApi from '../services/borrowerApi';
import CrmPreloader from '../components/preLoader';
import BorrowerFormModal from '../components/borrowers/BorrowerFormModal';
import SanctionFormModal from '../components/borrowers/SanctionFormModal';
import CompanyMatchModal from '../components/borrowers/CompanyMatchModal';
import HierarchyTree from '../components/borrowers/HierarchyTree';
import HierarchyPicker, {
  EMPTY_HIERARCHY, hierarchyFromBorrower, resolveHierarchyGroupId,
} from '../components/borrowers/HierarchyPicker';
import useToast from '../hooks/useToast';
import ToastContainer from '../components/Notification_Toast/ToastContainer';
import '../pages-css/BorrowerRegistry.css';
import '../pages-css/BorrowerRegistryPremium.css';

const BorrowerRegistry = () => {
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const { toasts, removeToast, showSuccess, showWarning, showError } = useToast();

  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [parsing, setParsing] = useState(false);

  // The banner is a persistent, page-level notice (unlike the toast shown
  // alongside it for the same failure) — auto-clearing it after a few
  // seconds keeps it from sitting on screen indefinitely once the user has
  // seen it.
  useEffect(() => {
    if (!error) return undefined;
    const t = setTimeout(() => setError(''), 5000);
    return () => clearTimeout(t);
  }, [error]);

  const [addBorrower, setAddBorrower] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);   // row awaiting confirmation
  const [deleting, setDeleting] = useState(false);
  const [deleteGroupTarget, setDeleteGroupTarget] = useState(null); // Parent Group row awaiting confirmation
  const [deletingGroup, setDeletingGroup] = useState(false);
  const [newBorrower, setNewBorrower] = useState(null); // awaiting its first sanction
  const [matchStep, setMatchStep] = useState(null); // { parsed, file } — company confirmation before review
  const [review, setReview] = useState(null); // { initial, file, borrowerId }
  const [hierarchyData, setHierarchyData] = useState({
    groups: [], standalone: [], totalElements: 0, totalPages: 1, stats: null,
  });
  const [hierarchyLoading, setHierarchyLoading] = useState(true);
  // 1-based in the UI/URL sense (matches Pagination's own page numbering);
  // converted to the 0-based index the API expects when fetching.
  const [hierarchyPage, setHierarchyPage] = useState(1);
  const [hierarchyPageSize, setHierarchyPageSize] = useState(10);
  // Reorganize-instead-of-delete: fetched fresh (the hierarchy tree's own
  // company rows don't carry group/type fields) once the user asks for it
  // from the delete-confirm dialog, never eagerly.
  const [orgTarget, setOrgTarget] = useState(null); // full BorrowerWrapper
  const [orgValue, setOrgValue] = useState(EMPTY_HIERARCHY);
  const [orgLoading, setOrgLoading] = useState(false);
  const [savingOrg, setSavingOrg] = useState(false);
  const [orgError, setOrgError] = useState('');

  const loadHierarchy = useCallback(async () => {
    setHierarchyLoading(true);
    try {
      // Server-paginated and server-filtered — page/size/search all go to
      // the database, so a page never holds more than it needs to and a
      // search matches the whole registry, not just whatever page happened
      // to be loaded already.
      setHierarchyData(await borrowerApi.getHierarchy(hierarchyPage - 1, hierarchyPageSize, search));
    } catch (e) {
      setError(e.message || 'Could not load the hierarchy');
    } finally {
      setHierarchyLoading(false);
    }
  }, [hierarchyPage, hierarchyPageSize, search]);

  useEffect(() => {
    const t = setTimeout(loadHierarchy, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [loadHierarchy, search]);

  // Registry-wide, computed server-side independently of which page is
  // loaded (see BorrowerService.getHierarchyStats) — so these never read
  // like a count of just the current page.
  const hierarchyStats = {
    groups: hierarchyData.stats?.totalGroups ?? 0,
    companies: hierarchyData.stats?.totalCompanies ?? 0,
    sanctions: hierarchyData.stats?.totalSanctionLetters ?? 0,
    sanctioned: hierarchyData.stats?.totalSanctionedAmount || '₹0.00 Cr',
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be picked again after a cancel
    if (!file) return;

    setParsing(true);
    setError('');
    try {
      const parsed = await borrowerApi.parseSanction(file);
      // A ref no. already on file is checked at parse time (see
      // BorrowerService's _duplicateRefNo flag) — surface that here,
      // immediately, rather than letting the reviewer go through CIN/Name
      // matching and the review form first only to be blocked at Save.
      if (parsed?._duplicateRefNo) {
        showWarning('A sanction with this reference number has already been imported.', 'Already imported', 4000);
        return;
      }
      // Confirm which company the letter belongs to (or create a new one)
      // before the review screen opens, so the sanction never gets attached
      // to the wrong record on a name that merely looks similar.
      setMatchStep({ parsed, file });
    } catch (err) {
      const msg = err.message || 'Could not read the document';
      setError(msg);
      showWarning(msg, 'Could not read letter');
    } finally {
      setParsing(false);
    }
  };

  /**
   * Permanently deletes the borrower and, on the server, every sanction and
   * document that hangs off it (aliases cascade at the DB level) — nothing is
   * left behind, so a ref no. from a deleted record doesn't block a later
   * re-import.
   */
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError('');
    const name = deleteTarget.borrowerName;
    try {
      await borrowerApi.remove(deleteTarget.id);
      setDeleteTarget(null);
      loadHierarchy();
      showSuccess(`${name} and its sanction letters were permanently deleted.`, 'Deleted');
    } catch (err) {
      const msg = err.message || 'Could not delete this borrower';
      setError(msg);
      setDeleteTarget(null);
      showError(msg, 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  /**
   * Same permanent, cascading delete as a Sub Group's own delete action on
   * Group Detail — this is a Parent Group, so everything under it (its
   * companies, its Sub Groups, and every one of THEIR companies/sanctions/
   * documents) goes with it. The hierarchy row here doesn't carry those
   * nested counts (Level 1's API response is a lighter summary than
   * GroupDetail's), so the confirm dialog below warns in general terms
   * rather than an exact breakdown.
   */
  const handleDeleteGroup = async () => {
    if (!deleteGroupTarget) return;
    setDeletingGroup(true);
    setError('');
    const name = deleteGroupTarget.groupName;
    try {
      await borrowerApi.deleteGroup(deleteGroupTarget.id);
      setDeleteGroupTarget(null);
      loadHierarchy();
      showSuccess(`${name} and everything under it were permanently deleted.`, 'Deleted');
    } catch (err) {
      const msg = err.message || 'Could not delete this group';
      setError(msg);
      setDeleteGroupTarget(null);
      showError(msg, 'Delete failed');
    } finally {
      setDeletingGroup(false);
    }
  };

  /**
   * The hierarchy tree's own company rows don't carry group/type fields
   * (only a rolled-up companyType label), so a fresh full record is fetched
   * before the picker opens rather than trying to keep that in sync
   * everywhere the tree is rendered.
   */
  const openChangeOrg = async (target) => {
    setDeleteTarget(null);
    setOrgError('');
    setOrgLoading(true);
    setOrgTarget(target);
    try {
      const full = await borrowerApi.getById(target.id);
      setOrgTarget(full);
      setOrgValue(hierarchyFromBorrower(full));
    } catch (e) {
      setOrgTarget(null);
      showError(e.message || 'Could not load this company', 'Could not open');
    } finally {
      setOrgLoading(false);
    }
  };

  const handleSaveOrg = async () => {
    if (!orgTarget) return;
    setOrgError('');
    setSavingOrg(true);
    try {
      const groupId = await resolveHierarchyGroupId(orgValue);
      await borrowerApi.updateHierarchy(orgTarget.id, {
        groupId, isSubsidiary: orgValue.isSubsidiary, isSpv: orgValue.isSpv,
      });
      setOrgTarget(null);
      loadHierarchy();
      showSuccess(`${orgTarget.borrowerName}'s organization was updated.`, 'Updated');
    } catch (e) {
      setOrgError(e.message || 'Could not update the organization');
    } finally {
      setSavingOrg(false);
    }
  };

  return (
    <div className="br-page brx-registry">
      {parsing && <CrmPreloader text="Reading sanction letter…" />}
      <div className="brx-head">
        <div className="brx-head-text">
          <p className="brx-eyebrow">Lender</p>
          <h1 className="brx-title">Borrower Registry</h1>
          <p className="brx-subtitle">Manage and compare borrower information</p>
        </div>
        <div className="brx-head-actions">
          <button type="button" className="brx-btn" onClick={() => setAddBorrower(true)}>
            <Plus size={15} aria-hidden="true" />
            Add manually
          </button>
          <button
            type="button"
            className="brx-btn brx-btn-primary"
            onClick={() => fileRef.current?.click()}
            disabled={parsing}
          >
            <Upload size={15} aria-hidden="true" />
            {parsing ? 'Reading…' : 'Import sanction letter'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={handleFile}
            hidden
          />
        </div>
      </div>

      {error && <div className="br-banner br-banner-danger">{error}</div>}

      <div className="brx-filters">
        <div className="brx-search">
          <Search size={15} className="brx-search-icon" aria-hidden="true" />
          <input
            type="text"
            className="brx-input brx-input-icon"
            placeholder="Search by borrower, SL ref., ref no., group, or CIN"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              // A filtered result set can't be assumed to still have
              // whatever page was showing before.
              setHierarchyPage(1);
            }}
          />
        </div>
      </div>

      <div className="brx-stats">
        <Stat icon={Users} tone="blue" label="Total Groups" value={hierarchyStats.groups} sub="Active groups" />
        <Stat icon={Building2} tone="teal" label="Total Companies" value={hierarchyStats.companies} sub="Including standalone" />
        <Stat icon={FileCheck} tone="amber" label="Total Sanction Letters" value={hierarchyStats.sanctions} sub="Across all companies" />
        <Stat icon={IndianRupee} tone="green" label="Total Sanctioned Amount" value={hierarchyStats.sanctioned} sub="Across all groups" />
      </div>

      <HierarchyTree
        data={hierarchyData}
        loading={hierarchyLoading}
        search={search}
        onSelectCompany={(id) => navigate(`/lender/borrowers/${id}`)}
        onSelectGroup={(id) => navigate(`/lender/borrowers/group/${id}`)}
        onViewGroup={(id) => navigate(`/lender/borrowers/group/${id}/detail`)}
        onDeleteCompany={(c) => setDeleteTarget(c)}
        onDeleteGroup={(g) => setDeleteGroupTarget(g)}
        page={hierarchyPage}
        pageCount={hierarchyData.totalPages || 1}
        pageSize={hierarchyPageSize}
        totalRows={hierarchyData.totalElements || 0}
        onPageChange={setHierarchyPage}
        onPageSizeChange={(n) => { setHierarchyPageSize(n); setHierarchyPage(1); }}
        onStatusChanged={loadHierarchy}
      />

      {deleteTarget && (
        <div className="br-modal-backdrop" onMouseDown={() => setDeleteTarget(null)}>
          <div
            className="br-modal br-modal-confirm"
            onMouseDown={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-label="Confirm delete"
          >
            <div className="br-modal-head">
              <div className="br-viewer-title">
                <AlertTriangle size={18} className="br-tone-warn" aria-hidden="true" />
                <div className="br-viewer-title-text">
                  <h3 className="br-modal-title">Delete this borrower?</h3>
                  <p className="br-modal-sub">{deleteTarget.borrowerName}</p>
                </div>
              </div>
            </div>
            <div className="br-modal-body br-modal-body-single">
              <p className="br-confirm-text">
                {deleteTarget.latestRefNo
                  ? <>Its sanction letters, including <strong>{deleteTarget.latestRefNo}</strong>,
                      and the stored documents will be removed with it.</>
                  : deleteTarget.sanctionsCount > 0
                  ? <>Its {deleteTarget.sanctionsCount} sanction letter{deleteTarget.sanctionsCount === 1 ? '' : 's'}
                      and the stored documents will be removed with it.</>
                  : 'This borrower has no sanction letters recorded.'}
              </p>
              <p className="br-muted br-confirm-note">
                This is permanent — the company, its sanctions and their documents
                are deleted outright, not archived. If you only meant to move it
                elsewhere, use Change organization instead.
              </p>
            </div>
            <div className="br-modal-foot">
              <button
                type="button"
                className="br-btn"
                onClick={() => openChangeOrg(deleteTarget)}
                disabled={deleting}
              >
                Change organization
              </button>
              <button
                type="button"
                className="br-btn"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="br-btn br-btn-danger"
                onClick={handleDelete}
                disabled={deleting}
              >
                <Trash2 size={15} aria-hidden="true" />
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteGroupTarget && (
        <div className="br-modal-backdrop" onMouseDown={() => setDeleteGroupTarget(null)}>
          <div
            className="br-modal br-modal-confirm"
            onMouseDown={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-label="Confirm delete"
          >
            <div className="br-modal-head">
              <div className="br-viewer-title">
                <AlertTriangle size={18} className="br-tone-warn" aria-hidden="true" />
                <div className="br-viewer-title-text">
                  <h3 className="br-modal-title">Delete this Parent Group?</h3>
                  <p className="br-modal-sub">{deleteGroupTarget.groupName}</p>
                </div>
              </div>
            </div>
            <div className="br-modal-body br-modal-body-single">
              <p className="br-confirm-text">
                Every company under it — directly or under any of its Sub Groups —
                along with all of their sanction letters and stored documents, will
                be permanently deleted with it.
              </p>
              <p className="br-muted br-confirm-note">
                This is permanent and cannot be undone.
              </p>
            </div>
            <div className="br-modal-foot">
              <button
                type="button"
                className="br-btn"
                onClick={() => setDeleteGroupTarget(null)}
                disabled={deletingGroup}
              >
                Cancel
              </button>
              <button
                type="button"
                className="br-btn br-btn-danger"
                onClick={handleDeleteGroup}
                disabled={deletingGroup}
              >
                <Trash2 size={15} aria-hidden="true" />
                {deletingGroup ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {(orgLoading || orgTarget) && (
        <div className="br-modal-backdrop" onMouseDown={() => { if (!savingOrg) { setOrgTarget(null); } }}>
          <div
            className="br-modal"
            onMouseDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Change organization"
          >
            <div className="br-modal-head">
              <div className="br-viewer-title">
                <div className="br-viewer-title-text">
                  <h3 className="br-modal-title">Change organization</h3>
                  {orgTarget && (
                    <p className="br-modal-sub">
                      {orgTarget.borrowerName}
                      {orgTarget.sanctions?.[0] && (
                        <> (<span className="brx-ref-highlight">{orgTarget.sanctions[0].refNo}</span>)</>
                      )}
                    </p>
                  )}
                </div>
              </div>
              <button type="button" className="br-icon-btn" onClick={() => setOrgTarget(null)} aria-label="Close">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="br-modal-body br-modal-body-single">
              {orgLoading ? (
                <p className="br-muted">Loading…</p>
              ) : (
                <HierarchyPicker value={orgValue} onChange={setOrgValue} />
              )}
            </div>
            {orgError && <div className="br-banner br-banner-danger">{orgError}</div>}
            <div className="br-modal-foot">
              <button type="button" className="br-btn" onClick={() => setOrgTarget(null)} disabled={savingOrg}>
                Cancel
              </button>
              <button
                type="button"
                className="br-btn br-btn-primary"
                onClick={handleSaveOrg}
                disabled={savingOrg || orgLoading}
              >
                {savingOrg ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {addBorrower && (
        <BorrowerFormModal
          onClose={() => setAddBorrower(false)}
          onSaved={(saved) => {
            setAddBorrower(false);
            loadHierarchy();
            // Identity is only half the record. Go straight on to the sanction
            // form for the borrower just created, rather than making the user
            // find it and click Add sanction — but leave it skippable, since a
            // borrower can legitimately exist before any facility does.
            if (saved?.id) setNewBorrower(saved);
          }}
        />
      )}

      {newBorrower && (
        <SanctionFormModal
          mode="create"
          borrowerId={newBorrower.id}
          borrowerName={newBorrower.borrowerName}
          allowAttach
          onClose={() => {
            // Skipping is fine — the borrower is already saved. Also fires
            // right after onSaved on a successful save (the modal closes
            // unconditionally now) — replace rather than push so that case
            // doesn't leave a redundant duplicate entry in browser history.
            const id = newBorrower.id;
            setNewBorrower(null);
            navigate(`/lender/borrowers/${id}`, { replace: true });
          }}
          onSaved={(saved) => {
            const id = saved?.id || newBorrower.id;
            setNewBorrower(null);
            loadHierarchy();
            navigate(`/lender/borrowers/${id}`);
          }}
        />
      )}

      {matchStep && (
        <CompanyMatchModal
          parsed={matchStep.parsed}
          onClose={() => setMatchStep(null)}
          // Neither callback resolves/creates anything itself any more (see
          // CompanyMatchModal's own handleConfirm comment) — `pending`
          // just carries the reviewer's choice through to SanctionFormModal,
          // which is the only place any of it gets written, bundled
          // atomically with the sanction on Save.
          onResolved={(pending) => {
            setReview({ initial: matchStep.parsed, file: matchStep.file, pending });
            setMatchStep(null);
          }}
          onResolvedGroup={(pending) => {
            setReview({ initial: matchStep.parsed, file: matchStep.file, pending });
            setMatchStep(null);
          }}
        />
      )}

      {review && (
        <SanctionFormModal
          mode="import"
          pending={review.pending}
          initial={review.initial}
          file={review.file}
          onClose={() => setReview(null)}
          onSaved={(saved) => {
            setReview(null);
            loadHierarchy();
            showSuccess('Sanction letter saved to the registry.', 'Saved');
            // A group-target save (pending.kind === 'GROUP') has no company
            // row to land on — go to the group itself. saved.groupId alone
            // isn't a safe discriminator here: a company sanction's own
            // wrapper can carry a truthy groupId too, for a company that
            // simply belongs to a group.
            if (review.pending?.kind === 'GROUP' && saved?.groupId) {
              navigate(`/lender/borrowers/group/${saved.groupId}`);
            } else if (saved?.id) {
              // Land on the record just created — that is where the derived
              // panel shows what the import worked out.
              navigate(`/lender/borrowers/${saved.id}`);
            }
          }}
        />
      )}

      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
};

// .brx-stat-body is flex-direction: column-reverse (see CSS), so DOM order
// here is bottom-to-top visually: sub sits first so it lands at the very
// bottom, under the value, with the label staying on top as it always was.
const Stat = ({ icon: Icon, tone, label, value, sub }) => (
  <div className={`brx-stat brx-stat-${tone}`}>
    <span className="brx-stat-icon"><Icon size={19} aria-hidden="true" /></span>
    <span className="brx-stat-body">
      {sub && <span className="brx-stat-sub">{sub}</span>}
      <span className="brx-stat-value">{value}</span>
      <span className="brx-stat-label">{label}</span>
    </span>
  </div>
);

export default BorrowerRegistry;