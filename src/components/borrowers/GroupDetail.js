// src/components/borrowers/GroupDetail.js
//
// Level 2 of the registry drill-down: everything sitting directly under one
// Parent Group or Sub Group — its companies and (for a Parent Group) its own
// Sub Groups, one click deeper than the flat Level-1 list on BorrowerRegistry.js.
// A Sub Group is just another row in `company_groups`, so this same route and
// component serve either kind of group.
//
// Three independently paginated pieces make up this page, each backed by its
// own database-driven fetch rather than one whole-tree load:
//   - This group's own summary (breadcrumb + stat-card figures) — GET /borrower/groups/{id}
//   - Direct Companies, 5 per page — GET /borrower/groups/{id}/companies
//   - The Sub Groups list, 5 per page — GET /borrower/groups/{id}/subgroups
// Expanding a Sub Group panel lazily fetches its own companies (same
// /companies endpoint, called with that Sub Group's id) 5 at a time too, and
// keeps its own page state independent of every other panel.
//
// Every action here (View, Delete, Change organization) calls the exact same
// borrowerApi methods and reuses the exact same confirm-dialog/org-picker
// pattern already built for the Level-1 hierarchy table in BorrowerRegistry.js
// — nothing new in how a delete or a re-org actually happens, only in how the
// rows behind them are fetched.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Users, Building2, Eye, Trash2, AlertTriangle, X, Check,
  Download,
} from 'lucide-react';
import borrowerApi from '../../services/borrowerApi';
import HierarchyPicker, {
  EMPTY_HIERARCHY, hierarchyFromBorrower, resolveHierarchyGroupId,
} from './HierarchyPicker';
import SanctionFormModal from './SanctionFormModal';
import CompanyMatchModal from './CompanyMatchModal';
import Pagination from './Pagination';
import SanctionStatusBadge from './SanctionStatusBadge';
import { CIN_REGEX, toCin } from './borrowerFields';
import { parseMoneyCrore, formatCrore } from './sanctionDerive';
import useToast from '../../hooks/useToast';
import ToastContainer from '../Notification_Toast/ToastContainer';
import '../../pages-css/BorrowerRegistry.css';
import '../../pages-css/BorrowerRegistryPremium.css';

/**
 * Sums a list of already-formatted "₹X.XX Cr" sanction amounts back into one
 * total — reuses the exact same money parse/format pair SanctionFormModal's
 * own figures round-trip through (parseMoneyCrore → formatCrore), so this
 * never invents its own money math; it only combines figures the backend
 * already computed and formatted.
 */
const sumSanctionedAmount = (sanctions) => {
  const total = sanctions.reduce((sum, s) => sum + (parseMoneyCrore(s.sanctionedAmount) || 0), 0);
  return formatCrore(total) || '₹0.00 Cr';
};

const DIRECT_PAGE_SIZE = 5;
const SUBGROUPS_PAGE_SIZE = 5;
const SUBGROUP_COMPANIES_PAGE_SIZE = 50; // one-shot fetch cap, not a pagination control

const TYPE_BADGE_CLASS = {
  'Parent Group': 'brx-badge-purple',
  'Sub Group': 'brx-badge-blue',
  Standalone: 'brx-badge-green',
  Subsidiary: 'brx-badge-blue',
  SPV: 'brx-badge-orange',
  'Subsidiary + SPV': 'brx-badge-orange',
};

export const TypeBadge = ({ label }) => (
  <span className={`brx-type-badge ${TYPE_BADGE_CLASS[label] || 'brx-badge-slate'}`}>{label}</span>
);

/**
 * One entity row — a company (Standalone/Subsidiary/SPV, the original,
 * unchanged behaviour) OR, when `c.entityKind` is set, a Parent Group/Sub
 * Group appearing as a row in this SAME table instead of a table of its
 * own: same columns, same Type-badge mechanism (already covers "Parent
 * Group"/"Sub Group" labels — see TYPE_BADGE_CLASS), just a different
 * navigation target and (optionally, per row) no delete action, since
 * deleting a Group/Sub Group is a bigger, cascading operation that stays on
 * its own explicit "Delete Parent Group"/Sub Group action elsewhere.
 */
const CompanyRow = ({ c, navigate, onDelete, onStatusChanged, hideDelete }) => {
  const isGroupRow = c.entityKind === 'GROUP' || c.entityKind === 'SUB_GROUP';
  const target = isGroupRow ? `/lender/borrowers/group/${c.id}/detail` : `/lender/borrowers/${c.id}`;
  const rowHideDelete = hideDelete || c.hideDelete;
  return (
  <tr className="brx-tree-tr">
    <td>
      <span className="brx-tree-name-cell">
        {isGroupRow ? <Users size={15} aria-hidden="true" /> : <Building2 size={15} aria-hidden="true" />}
        <button
          type="button" className="brx-ref-link" title={c.borrowerName}
          onClick={() => navigate(target)}
        >
          {c.borrowerName}
        </button>
      </span>
    </td>
    <td><TypeBadge label={c.companyType} /></td>
    <td className="brx-mono">{c.cin || <span className="brx-dash">—</span>}</td>
    <td className="brx-num">{c.sanctionsCount}</td>
    <td className="brx-num">{c.totalSanctionedAmount || '₹0.00 Cr'}</td>
    <td>
      <SanctionStatusBadge
        sanctionId={c.latestSanctionId}
        refNo={c.latestSanctionRefNo}
        cin={c.cin}
        status={c.status}
        disabled={!c.latestSanctionId}
        onChanged={onStatusChanged}
      />
    </td>
    <td className="brx-right">
      <div className="brx-row-actions">
        <button
          type="button" className="brx-icon-btn"
          title={`View ${c.borrowerName}`} aria-label={`View ${c.borrowerName}`}
          onClick={() => navigate(target)}
        >
          <Eye size={15} aria-hidden="true" />
        </button>
        {!rowHideDelete && (
          <button
            type="button" className="brx-icon-btn brx-icon-danger"
            title={`Delete ${c.borrowerName}`} aria-label={`Delete ${c.borrowerName}`}
            onClick={onDelete}
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        )}
      </div>
    </td>
  </tr>
  );
};

/**
 * The shared 7-column table shell — Direct Companies, and each Sub Group's
 * own inline table — with its pagination footer inside the same card
 * (rather than floating below it), so every companies table on this page
 * looks the same regardless of which one it is.
 */
export const CompaniesTable = ({
  companies, loading, emptyMessage, navigate, onDeleteCompany,
  page, pageCount, pageSize, totalRows, onPageChange, onStatusChanged,
  // True on the read-only Group/Sub Group entity detail view (BorrowerDetail.js's
  // own `groupId` branch) — deleting a company is a hierarchy-MANAGEMENT action,
  // which stays exclusive to this page, same as a company's own detail view
  // never offers to delete itself either.
  hideDelete = false,
}) => (
  <div className="brx-tree-card">
    <div className="brx-tree-scroll brx-tree-scroll-5">
      <table className="brx-tree-table">
        <thead>
          <tr>
            <th>Entity Name</th>
            <th>Type</th>
            <th>CIN</th>
            <th className="brx-num">Sanction Letters</th>
            <th className="brx-num">Total Sanctioned Amount</th>
            <th>Status</th>
            <th className="brx-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={7} className="brx-muted brx-pad">Loading…</td></tr>
          ) : companies.length === 0 ? (
            <tr><td colSpan={7} className="brx-muted brx-pad">{emptyMessage}</td></tr>
          ) : (
            companies.map((c) => (
              <CompanyRow
                key={c.id} c={c} navigate={navigate}
                onDelete={() => onDeleteCompany(c)}
                onStatusChanged={onStatusChanged}
                hideDelete={hideDelete}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
    {totalRows > 0 && (
      <Pagination
        page={page}
        pageCount={pageCount}
        pageSize={pageSize}
        totalRows={totalRows}
        onPageChange={onPageChange}
        showSizeSelector={false}
      />
    )}
  </div>
);

/**
 * Sanction letters attached directly to one Group/Sub Group (borrower_id
 * NULL, group_id = that group) — never a child company's own. Reused in two
 * places: inline inside an expanded Sub Group panel on this page (so a Sub
 * Group with zero companies but a real direct sanction doesn't read as
 * having no data at all), and on BorrowerDetail.js's own `groupId` branch —
 * the shared entity-detail view's "Sanction Letters" tab for whichever
 * Group/Sub Group that page is showing.
 */
export const GroupSanctionsTable = ({ sanctions, loading, emptyMessage, onStatusChanged, onSelect }) => (
  <div className="brx-tree-card">
    <div className="brx-tree-scroll brx-tree-scroll-5">
      <table className="brx-tree-table">
        <thead>
          <tr>
            <th>Reference No.</th>
            <th>Lender</th>
            <th className="brx-num">Sanctioned Amount</th>
            <th>Status</th>
            <th className="brx-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={5} className="brx-muted brx-pad">Loading…</td></tr>
          ) : sanctions.length === 0 ? (
            <tr><td colSpan={5} className="brx-muted brx-pad">{emptyMessage}</td></tr>
          ) : (
            sanctions.map((s) => (
              <tr className="brx-tree-tr" key={s.id}>
                <td className="brx-mono">{s.refNo}</td>
                <td>{s.lenderName || <span className="brx-dash">—</span>}</td>
                <td className="brx-num">{s.sanctionedAmount || '₹0.00 Cr'}</td>
                <td>
                  <SanctionStatusBadge
                    sanctionId={s.id}
                    refNo={s.refNo}
                    cin={s.cin}
                    status={s.activeStatus}
                    onChanged={onStatusChanged}
                  />
                </td>
                <td className="brx-right">
                  <div className="brx-row-actions">
                    {/* Opens the sanction detail view (BorrowerDetail.js) —
                        never the uploaded document. See the Group-Level
                        Sanction Letters table's own comment above; same
                        reasoning. */}
                    <button
                      type="button" className="brx-icon-btn"
                      title="View" aria-label="View"
                      onClick={() => onSelect(s)}
                    >
                      <Eye size={15} aria-hidden="true" />
                    </button>
                    {s.hasDocument && (
                      <button
                        type="button" className="brx-icon-btn"
                        title="Download document" aria-label="Download document"
                        onClick={() => borrowerApi.downloadDocFile(s.id, s.sanctionDocName)}
                      >
                        <Download size={15} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  </div>
);

export const Stat = ({ icon: Icon, label, value, tone = 'blue' }) => (
  <div className={`brx-stat brx-stat-${tone}`}>
    <span className="brx-stat-icon"><Icon size={19} aria-hidden="true" /></span>
    <span className="brx-stat-body">
      <span className="brx-stat-value">{value}</span>
      <span className="brx-stat-label">{label}</span>
    </span>
  </div>
);

const GroupDetail = () => {
  const { groupId } = useParams();
  const navigate = useNavigate();
  // ?openSubGroup=<id> — how a company inside a Sub Group sends the user back
  // here with that Sub Group open, from its own Entity Detail breadcrumb/Back
  // (see resolveBackTarget in BorrowerDetail.js) or from a Sub Group's own
  // breadcrumb segment there. Fetched and pinned directly by id, expanded and
  // scrolled into view, independent of whichever page of the (now paginated)
  // Sub Groups list it would otherwise fall on.
  const [searchParams] = useSearchParams();
  const openSubGroupId = searchParams.get('openSubGroup');

  const [group, setGroup] = useState(null); // this group's own summary
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { toasts, removeToast, showWarning } = useToast();

  const [directCompanies, setDirectCompanies] = useState([]);
  const [directPage, setDirectPage] = useState(1);
  const [directTotalElements, setDirectTotalElements] = useState(0);
  const [directTotalPages, setDirectTotalPages] = useState(1);
  const [directLoading, setDirectLoading] = useState(true);

  const [subGroups, setSubGroups] = useState([]);
  const [subGroupsPage, setSubGroupsPage] = useState(1);
  const [subGroupsTotalElements, setSubGroupsTotalElements] = useState(0);
  const [subGroupsTotalPages, setSubGroupsTotalPages] = useState(1);
  const [subGroupsLoading, setSubGroupsLoading] = useState(true);

  // Sanctions associated directly with THIS Group/Sub Group itself (never a
  // child company's own) — these are real, already-persisted rows (created
  // via the existing group-level sanction relationship) that must stay
  // visible here: they already count toward this group's own sanction
  // total/amount/status (see BorrowerService.rollupForGroupHierarchy), so
  // hiding them from view is what used to make Level 1's total look
  // inconsistent with what Level 2 appeared to show.
  const [groupSanctions, setGroupSanctions] = useState([]);
  const [groupSanctionsLoading, setGroupSanctionsLoading] = useState(true);

  // "Add Sanction for this Group/Sub Group" — starting point is this group,
  // but it still runs through the exact same CompanyMatchModal/Name+CIN
  // matching as "Import Sanction Letter" below (see `matchStep.allowGroupDirect`
  // and CompanyMatchModal's `groupTarget` prop): an existing Name/CIN match
  // must still win even when the reviewer started here, so this button only
  // adds a "this sanction belongs directly to this Group/Sub Group" OPTION
  // in that same matching window — it never skips matching outright.
  const groupSanctionFileRef = useRef(null);

  // Each Sub Group's own companies + own direct sanctions (borrower_id
  // NULL, group_id = that Sub Group), keyed by Sub Group id — fetched for
  // every Sub Group on the current page (not just an expanded one — there's
  // no expand/collapse any more: a Sub Group and its companies are just
  // consecutive rows in the SAME "Sub Groups" table, see the render below).
  // No per-Sub-Group pagination on the companies side (a generous single
  // page instead) since nesting a second pagination control inside an
  // already-paginated Sub Groups list would be its own new UI, not a reuse
  // of the existing one.
  const [subGroupChildren, setSubGroupChildren] = useState({});
  const [pinnedSubGroup, setPinnedSubGroup] = useState(null);

  // Editing this group's own basic details (name only — a Parent/Sub Group
  // has no other editable field: no CIN, no address, it's an organisational
  // grouping, not itself a legal entity). Reuses the existing PUT
  // /borrower/groups/{id} (updateGroup) the "move to a different parent"
  // flow below already calls, so renaming here can never touch any
  // company/borrower/sanction row — group_id is a loose FK, never a
  // denormalised copy of the group's name.
  const [editingGroup, setEditingGroup] = useState(false);
  const [editGroupName, setEditGroupName] = useState('');
  // Optional master identity for the Group itself — independent of any
  // company's own CIN/registered address (never copied either direction).
  const [editGroupCin, setEditGroupCin] = useState('');
  const [editGroupAddress, setEditGroupAddress] = useState('');
  const [savingGroupEdit, setSavingGroupEdit] = useState(false);
  const [editGroupError, setEditGroupError] = useState('');

  // "Add Sub Group" — only offered on a Parent Group (a Sub Group can never
  // have children of its own, same rule the backend enforces). Reuses the
  // existing createGroup() call the standalone "new group" flow elsewhere
  // already uses, just pre-scoped to this Parent Group.
  const [addingSubGroup, setAddingSubGroup] = useState(false);
  const [newSubGroupName, setNewSubGroupName] = useState('');
  const [newSubGroupCin, setNewSubGroupCin] = useState('');
  const [newSubGroupAddress, setNewSubGroupAddress] = useState('');
  const [savingSubGroup, setSavingSubGroup] = useState(false);
  const [subGroupError, setSubGroupError] = useState('');

  // "Import Sanction Letter" from within this group's own page — the exact
  // same flow BorrowerRegistry.js uses at Level 1, just with this group
  // pre-selected as the Parent/Sub Group context, so the reviewer doesn't
  // have to re-pick it. Whether the letter ends up on the group itself
  // (only offered when started from "Add Sanction for this Group/Sub Group"
  // — see `allowGroupDirect`), on a matched existing company, or a new
  // company is decided inside CompanyMatchModal, never inferred here. Can
  // never attach to an unrelated EXISTING company: CompanyMatchModal's own
  // identity matching (CIN/name) is untouched, and the preset hierarchy is
  // only ever applied on the "new company" path (see CompanyMatchModal's
  // `presetHierarchy` prop).
  const fileRef = useRef(null);
  const [, setParsing] = useState(false); // read no longer displayed — the button that showed it was removed
  const [matchStep, setMatchStep] = useState(null); // { parsed, file, allowGroupDirect }
  const [review, setReview] = useState(null);       // { initial, file, borrowerId } XOR { initial, file, groupTarget }

  const [deleteTarget, setDeleteTarget] = useState(null);       // company row awaiting confirmation
  const [deleting, setDeleting] = useState(false);
  const [deleteGroupTarget, setDeleteGroupTarget] = useState(null); // Sub Group row awaiting confirmation
  const [deletingGroup, setDeletingGroup] = useState(false);
  const [movingGroup, setMovingGroup] = useState(false);
  const [movingGroupParentId, setMovingGroupParentId] = useState('');
  const [parentGroupOptions, setParentGroupOptions] = useState([]);

  const [orgTarget, setOrgTarget] = useState(null); // full BorrowerWrapper
  const [orgValue, setOrgValue] = useState(EMPTY_HIERARCHY);
  const [orgLoading, setOrgLoading] = useState(false);
  const [savingOrg, setSavingOrg] = useState(false);
  const [orgError, setOrgError] = useState('');

  const loadGroup = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setGroup(await borrowerApi.getGroupDetail(groupId));
    } catch (e) {
      setError(e.message || 'Could not load the group');
      setGroup(null);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => { loadGroup(); }, [loadGroup]);

  const loadGroupSanctions = useCallback(async () => {
    setGroupSanctionsLoading(true);
    try {
      setGroupSanctions(await borrowerApi.listGroupSanctions(groupId));
    } catch (e) {
      setError(e.message || "Could not load this group's own sanction letters");
    } finally {
      setGroupSanctionsLoading(false);
    }
  }, [groupId]);

  useEffect(() => { loadGroupSanctions(); }, [loadGroupSanctions]);

  const loadDirectCompanies = useCallback(async (page) => {
    setDirectLoading(true);
    try {
      const res = await borrowerApi.getGroupCompanies(groupId, page - 1, DIRECT_PAGE_SIZE);
      setDirectCompanies(res.content || []);
      setDirectTotalElements(res.totalElements || 0);
      setDirectTotalPages(res.totalPages || 1);
    } catch (e) {
      setError(e.message || 'Could not load companies');
    } finally {
      setDirectLoading(false);
    }
  }, [groupId]);

  useEffect(() => { loadDirectCompanies(directPage); }, [loadDirectCompanies, directPage]);

  // A delete can leave the current page past the new last one — step back
  // rather than showing an empty page with working Previous/page-number
  // controls that look broken.
  useEffect(() => {
    if (directPage > directTotalPages) setDirectPage(directTotalPages);
  }, [directPage, directTotalPages]);

  const loadSubGroupsList = useCallback(async (page) => {
    setSubGroupsLoading(true);
    try {
      const res = await borrowerApi.getSubGroups(groupId, page - 1, SUBGROUPS_PAGE_SIZE);
      setSubGroups(res.content || []);
      setSubGroupsTotalElements(res.totalElements || 0);
      setSubGroupsTotalPages(res.totalPages || 1);
    } catch (e) {
      setError(e.message || 'Could not load Sub Groups');
    } finally {
      setSubGroupsLoading(false);
    }
  }, [groupId]);

  useEffect(() => { loadSubGroupsList(subGroupsPage); }, [loadSubGroupsList, subGroupsPage]);

  useEffect(() => {
    if (subGroupsPage > subGroupsTotalPages) setSubGroupsPage(subGroupsTotalPages);
  }, [subGroupsPage, subGroupsTotalPages]);

  // One combined fetch per Sub Group — its own companies (a single generous
  // page, no nested pagination control) and its own direct sanctions, both
  // needed to build that Sub Group's own row plus its companies' rows in
  // the unified "Sub Groups" table below.
  const loadSubGroupChildren = useCallback(async (subId) => {
    setSubGroupChildren((m) => ({
      ...m,
      [subId]: { companies: m[subId]?.companies || [], sanctions: m[subId]?.sanctions || [], loading: true },
    }));
    try {
      const [companiesRes, sanctions] = await Promise.all([
        borrowerApi.getGroupCompanies(subId, 0, SUBGROUP_COMPANIES_PAGE_SIZE),
        borrowerApi.listGroupSanctions(subId),
      ]);
      setSubGroupChildren((m) => ({
        ...m,
        [subId]: { companies: companiesRes.content || [], sanctions, loading: false },
      }));
    } catch (e) {
      // "Group not found" here just means this Sub Group no longer exists —
      // almost always because it (or its parent) was just deleted, most
      // often by this very reload() (see handleDeleteGroup: the
      // setSubGroupChildren removing the deleted id hasn't flushed into this
      // reload's own closure yet, so it can still try to refetch the id it
      // just deleted). That's an expected side-effect of a successful
      // delete, not a new problem with the page — surfacing it as a
      // page-level error banner only confuses what was a clean delete.
      // Any other failure (network, etc.) still surfaces normally.
      if (e.message !== 'Group not found') {
        setError(e.message || "Could not load this Sub Group's own companies/sanctions");
      }
      setSubGroupChildren((m) => ({
        ...m,
        [subId]: { companies: m[subId]?.companies || [], sanctions: m[subId]?.sanctions || [], loading: false },
      }));
    }
  }, []);

  // Fetches every Sub Group's own children the moment it's known — there's
  // no expand/collapse any more (see the render below), so every Sub Group
  // on the current page needs its rows ready up front.
  useEffect(() => {
    subGroups.forEach((sub) => {
      const subId = String(sub.id);
      if (!subGroupChildren[subId]) loadSubGroupChildren(subId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subGroups]);

  // ?openSubGroup=<id> — pins that specific Sub Group into view regardless
  // of which page of the (paginated) Sub Groups list it would otherwise
  // fall on, exactly as before; only the old expand/scroll-into-view
  // behaviour is gone, since there's no separate panel to open any more —
  // the pinned Sub Group's row (and its companies) already show wherever
  // this effect places it in the table.
  useEffect(() => {
    if (!openSubGroupId) { setPinnedSubGroup(null); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        const detail = await borrowerApi.getGroupDetail(openSubGroupId);
        if (cancelled) return;
        setPinnedSubGroup(detail);
        if (!subGroupChildren[openSubGroupId]) loadSubGroupChildren(openSubGroupId);
      } catch {
        if (!cancelled) setPinnedSubGroup(null);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSubGroupId]);

  const backToRegistry = () => navigate('/lender/borrowers');

  const handleSaveGroupEdit = async () => {
    setEditGroupError('');
    if (!editGroupName.trim()) { setEditGroupError('Group name is required'); return; }
    if (editGroupCin && !CIN_REGEX.test(editGroupCin)) {
      setEditGroupError('Enter a valid 21-character CIN, e.g. U40106MH2026PTC223978');
      return;
    }
    setSavingGroupEdit(true);
    try {
      // parentGroupId is passed through unchanged — this form only edits the
      // name/identity fields, it never moves the group (that's the separate
      // "move" flow in the delete-confirm modal below). CIN/registered
      // address are this Group's own optional master identity — wholly
      // independent of any company's own, always resubmitted in full so a
      // plain rename never clears a previously-set value.
      await borrowerApi.updateGroup(group.id, {
        groupName: editGroupName.trim(), parentGroupId: group.parentGroupId || null,
        cin: editGroupCin.trim(), registeredAddress: editGroupAddress.trim(),
      });
      setEditingGroup(false);
      await loadGroup();
    } catch (e) {
      setEditGroupError(e.message || 'Could not save the group');
    } finally {
      setSavingGroupEdit(false);
    }
  };

  const handleAddSubGroup = async () => {
    setSubGroupError('');
    if (!newSubGroupName.trim()) { setSubGroupError('Sub Group name is required'); return; }
    if (newSubGroupCin && !CIN_REGEX.test(newSubGroupCin)) {
      setSubGroupError('Enter a valid 21-character CIN, e.g. U40106MH2026PTC223978');
      return;
    }
    setSavingSubGroup(true);
    try {
      await borrowerApi.createGroup({
        groupName: newSubGroupName.trim(), parentGroupId: group.id,
        cin: newSubGroupCin.trim(), registeredAddress: newSubGroupAddress.trim(),
      });
      setAddingSubGroup(false);
      setNewSubGroupName(''); setNewSubGroupCin(''); setNewSubGroupAddress('');
      await reload();
    } catch (e) {
      setSubGroupError(e.message || 'Could not create the Sub Group');
    } finally {
      setSavingSubGroup(false);
    }
  };

  /** Re-fetches everything currently on screen — the group summary, both tables' current pages, and every open panel's own current page. */
  const reload = useCallback(async () => {
    await loadGroup();
    await loadGroupSanctions();
    await loadDirectCompanies(directPage);
    await loadSubGroupsList(subGroupsPage);
    Object.keys(subGroupChildren).forEach((subId) => loadSubGroupChildren(subId));
  }, [loadGroup, loadGroupSanctions, loadDirectCompanies, directPage, loadSubGroupsList, subGroupsPage,
    subGroupChildren, loadSubGroupChildren]);

  const openChangeOrgFor = async (company) => {
    setDeleteTarget(null);
    setOrgError('');
    setOrgLoading(true);
    setOrgTarget(company);
    try {
      const full = await borrowerApi.getById(company.id);
      setOrgTarget(full);
      setOrgValue(hierarchyFromBorrower(full));
    } catch (e) {
      setOrgTarget(null);
      setError(e.message || 'Could not load this company');
    } finally {
      setOrgLoading(false);
    }
  };

  const handleSaveOrg = async () => {
    if (!orgTarget) return;
    setOrgError('');
    setSavingOrg(true);
    try {
      const newGroupId = await resolveHierarchyGroupId(orgValue);
      await borrowerApi.updateHierarchy(orgTarget.id, {
        groupId: newGroupId, isSubsidiary: orgValue.isSubsidiary, isSpv: orgValue.isSpv,
      });
      setOrgTarget(null);
      await reload();
    } catch (e) {
      setOrgError(e.message || 'Could not update the organization');
    } finally {
      setSavingOrg(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError('');
    try {
      await borrowerApi.remove(deleteTarget.id);
      setDeleteTarget(null);
      await reload();
    } catch (err) {
      setError(err.message || 'Could not delete this borrower');
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const openMoveGroup = async () => {
    setMovingGroupParentId('');
    setMovingGroup(true);
    try {
      setParentGroupOptions(await borrowerApi.getGroups());
    } catch {
      setParentGroupOptions([]);
    }
  };

  const handleDeleteGroup = async () => {
    if (!deleteGroupTarget) return;
    // Deleting a Sub Group listed as a child here just means re-fetching
    // this same page's data afterward. Deleting THIS page's own group (via
    // the header's Delete button) means the page itself no longer exists —
    // reload() would just 404 against the group id we were just looking
    // at, so navigate away instead: to the registry for a Parent Group, or
    // back to its own Parent Group's page for a Sub Group viewed directly.
    const deletingSelf = deleteGroupTarget.id === group.id;
    setDeletingGroup(true);
    setError('');
    try {
      await borrowerApi.deleteGroup(deleteGroupTarget.id);
      setDeleteGroupTarget(null);
      setMovingGroup(false);
      if (deletingSelf) {
        if (deleteGroupTarget.parentGroupId) {
          navigate(`/lender/borrowers/group/${deleteGroupTarget.parentGroupId}`);
        } else {
          backToRegistry();
        }
        return;
      }
      // The Sub Group just deleted no longer exists — drop any companies/
      // sanctions already fetched for it rather than leaving stale data.
      setSubGroupChildren((m) => {
        const next = { ...m };
        delete next[String(deleteGroupTarget.id)];
        return next;
      });
      await reload();
    } catch (err) {
      setError(err.message || 'Could not delete this group');
      setDeleteGroupTarget(null);
      setMovingGroup(false);
    } finally {
      setDeletingGroup(false);
    }
  };

  const handleMoveGroup = async () => {
    if (!deleteGroupTarget || !movingGroupParentId) return;
    setDeletingGroup(true);
    setError('');
    try {
      await borrowerApi.updateGroup(deleteGroupTarget.id, {
        groupName: deleteGroupTarget.groupName,
        parentGroupId: Number(movingGroupParentId),
      });
      setDeleteGroupTarget(null);
      setMovingGroup(false);
      await reload();
    } catch (err) {
      setError(err.message || 'Could not move this group');
    } finally {
      setDeletingGroup(false);
    }
  };

  if (loading) {
    return <div className="br-page"><p className="br-muted">Loading…</p></div>;
  }

  if (!group) {
    return (
      <div className="br-page">
        <button type="button" className="br-back" onClick={backToRegistry}>
          <ArrowLeft size={16} aria-hidden="true" />
          Back to Registry
        </button>
        <div className="br-banner br-banner-danger">{error || 'Group not found'}</div>
      </div>
    );
  }

  const isParent = !group.parentGroupId;
  const hasSubGroups = !!group.hasSubGroups;

  // What "Add Company" / "Import Sanction Letter" pre-select as the new
  // company's group — this page's own group, whichever kind it is: viewing
  // a Parent Group presets just the parent; viewing a Sub Group presets
  // both, so a company added from here lands directly under that Sub Group,
  // not merely somewhere under its parent.
  const presetHierarchy = isParent
    ? { parentGroupId: group.id, parentGroupName: group.groupName }
    : {
      parentGroupId: group.parentGroupId, parentGroupName: group.parentGroupName,
      subGroupId: group.id, subGroupName: group.groupName,
    };

  /**
   * Shared by both "Import Sanction Letter" and "Add Sanction for this
   * Group/Sub Group" — parses the document with the one existing extractor,
   * then always opens CompanyMatchModal. `allowGroupDirect` only controls
   * whether that modal offers "this sanction belongs directly to this
   * Group/Sub Group" as one more option alongside every real Name/CIN
   * candidate — it never skips matching itself.
   */
  const startImport = async (file, allowGroupDirect) => {
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
      setMatchStep({ parsed, file, allowGroupDirect });
    } catch (err) {
      setError(err.message || 'Could not read the document');
    } finally {
      setParsing(false);
    }
  };

  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) startImport(file, false);
  };

  const handleImportGroupSanctionFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) startImport(file, true);
  };
  // deleteGroupTarget is either a Sub Group row from the list below, or (via
  // the header's own Delete button) this page's own `group` — both share
  // the same parentGroupId field, so this check works for either shape.
  const deleteGroupTargetIsParent = !!deleteGroupTarget && !deleteGroupTarget.parentGroupId;

  // The pinned ?openSubGroup target (if any) is shown first, always expanded
  // — the paginated list below it drops the same id if it happens to also
  // land on the current Sub Groups page, so it's never shown twice.
  const listSubGroups = pinnedSubGroup
    ? subGroups.filter((s) => String(s.id) !== String(pinnedSubGroup.id))
    : subGroups;
  const subGroupsToRender = pinnedSubGroup ? [pinnedSubGroup, ...listSubGroups] : listSubGroups;

  return (
    <div className="br-page brx-registry">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <button type="button" className="br-back" onClick={backToRegistry}>
        <ArrowLeft size={16} aria-hidden="true" />
        Back to Registry
      </button>

      <div className="brx-head">
        <div className="brx-head-text">
          <div className="brx-crumb-path">
            <button type="button" className="brx-crumb-link" onClick={backToRegistry}>Borrower Registry</button>
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
          <h1 className="brx-title">
            {group.groupName}
            <span style={{ marginLeft: 10, verticalAlign: 'middle', display: 'inline-block' }}>
              <TypeBadge label={isParent ? 'Parent Group' : 'Sub Group'} />
            </span>
            {/* Derived from the sanctions belonging anywhere under this
                group's own hierarchy — never stored on the group itself and
                never manually editable. See BorrowerService.deriveStatusLabel. */}
            <span style={{ marginLeft: 6, verticalAlign: 'middle', display: 'inline-block' }}>
              <span className={`brx-status-pill ${group.status === 'Active' ? 'brx-status-active' : 'brx-status-muted'}`}>
                {group.status}
              </span>
            </span>
          </h1>
          {/* This group's own optional master identity — independent of any
              company's own CIN/registered address (never copied either way). */}
          {(group.cin || group.registeredAddress) && (
            <p className="brx-muted" style={{ marginTop: 4 }}>
              {group.cin && <span className="br-mono">CIN: {group.cin}</span>}
              {group.cin && group.registeredAddress && ' · '}
              {group.registeredAddress && <span>{group.registeredAddress}</span>}
            </p>
          )}
        </div>
        {/* The Import/Add-Sanction/Add-Sub-Group/Edit/Delete action buttons
            that used to sit here were removed from this Level-2 page's own
            header per an explicit request — none of them exist anywhere
            else for this Group/Sub Group, so their file inputs stay mounted
            (still `hidden`, exactly as before) purely to keep the existing
            import handlers wired and available, not to render anything. */}
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={handleImportFile}
          hidden
        />
        <input
          ref={groupSanctionFileRef}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={handleImportGroupSanctionFile}
          hidden
        />
      </div>

      {error && <div className="br-banner br-banner-danger">{error}</div>}

      <div className="brx-stats">
        {hasSubGroups && <Stat icon={Building2} tone="teal" label="Direct Companies" value={group.directCompaniesCount ?? 0} />}
        <Stat
          icon={Building2} tone="teal"
          label={hasSubGroups ? 'Total Companies' : 'Companies'}
          value={group.totalCompaniesCount ?? 0}
        />
        {hasSubGroups && <Stat icon={Users} tone="purple" label="Sub Groups" value={group.subGroupsCount ?? 0} />}
        <Stat icon={Building2} tone="orange" label="Total SPVs" value={group.totalSpvCount ?? 0} />
        <Stat icon={Users} tone="green" label="Total Sanctioned Amount" value={group.totalSanctionedAmount || '₹0.00 Cr'} />
      </div>

      {/* TABLE 1 — this Group/Sub Group's own row (its direct sanctions'
          count/amount/status — never a child company's) followed by its
          direct companies, all in the ONE existing Direct-Companies-style
          table. Only shown on the companies list's own first page, since
          the companies themselves stay paginated exactly as before (see
          CompaniesTable's own pageCount/totalRows, still driven only by
          the company count the backend returns — this row is never counted
          toward that pagination). */}
      <h2 className="brx-section-heading">{isParent ? 'Parent Group' : 'Sub Group'} / Direct Companies</h2>
      <CompaniesTable
        companies={directPage === 1 ? [
          {
            id: group.id,
            entityKind: isParent ? 'GROUP' : 'SUB_GROUP',
            hideDelete: false, // reuses the existing "Delete Parent/Sub Group" confirm below
            borrowerName: group.groupName,
            groupName: group.groupName, // for the existing delete-confirm modal
            parentGroupId: group.parentGroupId,
            companiesCount: group.companiesCount ?? 0,
            subGroupsCount: group.subGroupsCount ?? 0,
            companyType: isParent ? 'Parent Group' : 'Sub Group',
            cin: group.cin,
            sanctionsCount: groupSanctions.length,
            totalSanctionedAmount: sumSanctionedAmount(groupSanctions),
            latestSanctionId: groupSanctions[0]?.id ?? null,
            latestSanctionRefNo: groupSanctions[0]?.refNo ?? null,
            status: group.status,
          },
          ...directCompanies,
        ] : directCompanies}
        loading={directLoading || groupSanctionsLoading}
        emptyMessage="No companies directly under this group."
        navigate={navigate}
        onDeleteCompany={(c) => (c.entityKind ? setDeleteGroupTarget(c) : setDeleteTarget(c))}
        page={directPage}
        pageCount={directTotalPages}
        pageSize={DIRECT_PAGE_SIZE}
        totalRows={directTotalElements}
        onPageChange={setDirectPage}
        onStatusChanged={reload}
      />

      {/* TABLE 2 — every Sub Group's own row, each immediately followed by
          its own companies, all in that SAME table — no separate "Direct
          Sub Group Sanctions" table and no per-Sub-Group companies table.
          The Sub Groups list itself stays paginated as before; each visible
          Sub Group's own companies are not (see loadSubGroupChildren's own
          comment) — a Sub Group with zero companies still shows its own
          row, just with nothing following it, so it never reads as having
          no data at all when it actually has a direct sanction. */}
      {hasSubGroups && (
        <>
          <h2 className="brx-section-heading">Sub Groups</h2>
          <CompaniesTable
            companies={subGroupsToRender.flatMap((sub) => {
              const subId = String(sub.id);
              const child = subGroupChildren[subId] || { companies: [], sanctions: [] };
              return [
                {
                  id: sub.id,
                  entityKind: 'SUB_GROUP',
                  hideDelete: false, // reuses the existing "Delete Sub Group" confirm below
                  borrowerName: sub.groupName,
                  companyType: 'Sub Group',
                  cin: sub.cin,
                  sanctionsCount: child.sanctions.length,
                  totalSanctionedAmount: sumSanctionedAmount(child.sanctions),
                  latestSanctionId: child.sanctions[0]?.id ?? null,
                  latestSanctionRefNo: child.sanctions[0]?.refNo ?? null,
                  status: sub.status,
                  // The existing delete-confirmation modal below reads a
                  // Sub Group object's own groupName/companiesCount/
                  // subGroupsCount/parentGroupId (see deleteGroupTarget's
                  // own usage) — sub's own backend-computed totals are used
                  // here rather than child.companies.length, which can be
                  // capped by loadSubGroupChildren's own fetch size.
                  groupName: sub.groupName,
                  parentGroupId: sub.parentGroupId ?? group.id,
                  companiesCount: sub.companiesCount ?? child.companies.length,
                  subGroupsCount: sub.subGroupsCount ?? 0,
                },
                ...child.companies,
              ];
            })}
            loading={subGroupsLoading || subGroupsToRender.some((sub) => !subGroupChildren[String(sub.id)])}
            emptyMessage="No Sub Groups under this Parent Group."
            navigate={navigate}
            onDeleteCompany={(c) => (c.entityKind ? setDeleteGroupTarget(c) : setDeleteTarget(c))}
            page={subGroupsPage}
            pageCount={subGroupsTotalPages}
            pageSize={SUBGROUPS_PAGE_SIZE}
            totalRows={subGroupsTotalElements}
            onPageChange={setSubGroupsPage}
            onStatusChanged={reload}
          />
        </>
      )}

      {deleteTarget && (
        <div className="br-modal-backdrop" onMouseDown={() => setDeleteTarget(null)}>
          <div
            className="br-modal br-modal-confirm"
            onMouseDown={(e) => e.stopPropagation()}
            role="alertdialog" aria-modal="true" aria-label="Confirm delete"
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
                {deleteTarget.sanctionsCount > 0
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
              <button type="button" className="br-btn" onClick={() => openChangeOrgFor(deleteTarget)} disabled={deleting}>
                Change organization
              </button>
              <button type="button" className="br-btn" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                Cancel
              </button>
              <button type="button" className="br-btn br-btn-danger" onClick={handleDelete} disabled={deleting}>
                <Trash2 size={15} aria-hidden="true" />
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {matchStep && (
        <CompanyMatchModal
          parsed={matchStep.parsed}
          presetHierarchy={presetHierarchy}
          groupTarget={matchStep.allowGroupDirect
            ? { groupId: group.id, groupName: group.groupName, type: isParent ? 'GROUP' : 'SUB_GROUP' }
            : null}
          onClose={() => setMatchStep(null)}
          // Neither callback resolves/creates anything itself any more —
          // `pending` just carries the reviewer's choice through to
          // SanctionFormModal, the only place any of it gets written,
          // bundled atomically with the sanction on Save. See
          // CompanyMatchModal's own handleConfirm comment.
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
            reload();
            // A group-target save may not be the group this page is
            // currently showing — go there instead of just reloading
            // whatever's on screen, so the reviewer actually sees what they
            // just created. saved.groupId alone isn't a safe discriminator
            // (a company sanction's own wrapper can carry a truthy groupId
            // too, for a company that simply belongs to a group).
            if (review.pending?.kind === 'GROUP' && saved?.groupId) {
              navigate(`/lender/borrowers/group/${saved.groupId}`);
            } else if (saved?.id) {
              navigate(`/lender/borrowers/${saved.id}`);
            }
          }}
        />
      )}


      {addingSubGroup && (
        <div className="br-modal-backdrop" onMouseDown={() => setAddingSubGroup(false)}>
          <div className="br-modal" onMouseDown={(e) => e.stopPropagation()}
            role="dialog" aria-modal="true" aria-label="Add Sub Group">
            <div className="br-modal-head">
              <h3 className="br-modal-title">Add Sub Group</h3>
              <button type="button" className="br-icon-btn" onClick={() => setAddingSubGroup(false)} aria-label="Close">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="br-modal-body br-modal-body-single">
              <label className="br-field">
                <span className="br-field-label">Sub Group name<span className="br-req"> *</span></span>
                <input
                  className="br-input" autoFocus
                  value={newSubGroupName}
                  onChange={(e) => setNewSubGroupName(e.target.value)}
                  disabled={savingSubGroup}
                />
              </label>
              <label className="br-field">
                <span className="br-field-label">CIN (optional)</span>
                <input
                  className="br-input br-input-mono"
                  value={newSubGroupCin}
                  onChange={(e) => setNewSubGroupCin(toCin(e.target.value))}
                  placeholder="Not on file"
                  maxLength={21}
                  disabled={savingSubGroup}
                />
              </label>
              <label className="br-field">
                <span className="br-field-label">Registered Address (optional)</span>
                <textarea
                  className="br-input br-textarea" rows={2}
                  value={newSubGroupAddress}
                  onChange={(e) => setNewSubGroupAddress(e.target.value)}
                  disabled={savingSubGroup}
                />
              </label>
            </div>
            {subGroupError && <div className="br-banner br-banner-danger">{subGroupError}</div>}
            <div className="br-modal-foot">
              <button type="button" className="br-btn" onClick={() => setAddingSubGroup(false)} disabled={savingSubGroup}>
                Cancel
              </button>
              <button type="button" className="br-btn br-btn-primary" onClick={handleAddSubGroup} disabled={savingSubGroup}>
                <Check size={15} aria-hidden="true" />
                {savingSubGroup ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingGroup && (
        <div className="br-modal-backdrop" onMouseDown={() => setEditingGroup(false)}>
          <div className="br-modal" onMouseDown={(e) => e.stopPropagation()}
            role="dialog" aria-modal="true" aria-label={`Edit ${isParent ? 'Parent Group' : 'Sub Group'}`}>
            <div className="br-modal-head">
              <h3 className="br-modal-title">Edit {isParent ? 'Parent Group' : 'Sub Group'}</h3>
              <button type="button" className="br-icon-btn" onClick={() => setEditingGroup(false)} aria-label="Close">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="br-modal-body br-modal-body-single">
              <label className="br-field">
                <span className="br-field-label">Group name<span className="br-req"> *</span></span>
                <input
                  className="br-input" autoFocus
                  value={editGroupName}
                  onChange={(e) => setEditGroupName(e.target.value)}
                  disabled={savingGroupEdit}
                />
              </label>
              <label className="br-field">
                <span className="br-field-label">CIN (optional)</span>
                <input
                  className="br-input br-input-mono"
                  value={editGroupCin}
                  onChange={(e) => setEditGroupCin(toCin(e.target.value))}
                  placeholder="Not on file"
                  maxLength={21}
                  disabled={savingGroupEdit}
                />
              </label>
              <label className="br-field">
                <span className="br-field-label">Registered Address (optional)</span>
                <textarea
                  className="br-input br-textarea" rows={2}
                  value={editGroupAddress}
                  onChange={(e) => setEditGroupAddress(e.target.value)}
                  disabled={savingGroupEdit}
                />
              </label>
            </div>
            {editGroupError && <div className="br-banner br-banner-danger">{editGroupError}</div>}
            <div className="br-modal-foot">
              <button type="button" className="br-btn" onClick={() => setEditingGroup(false)} disabled={savingGroupEdit}>
                Cancel
              </button>
              <button type="button" className="br-btn br-btn-primary" onClick={handleSaveGroupEdit} disabled={savingGroupEdit}>
                <Check size={15} aria-hidden="true" />
                {savingGroupEdit ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteGroupTarget && (
        <div className="br-modal-backdrop" onMouseDown={() => { setDeleteGroupTarget(null); setMovingGroup(false); }}>
          <div
            className="br-modal br-modal-confirm"
            onMouseDown={(e) => e.stopPropagation()}
            role="alertdialog" aria-modal="true" aria-label="Confirm delete"
          >
            <div className="br-modal-head">
              <div className="br-viewer-title">
                <AlertTriangle size={18} className="br-tone-warn" aria-hidden="true" />
                <div className="br-viewer-title-text">
                  <h3 className="br-modal-title">
                    Delete this {deleteGroupTargetIsParent ? 'Parent Group' : 'Sub Group'}?
                  </h3>
                  <p className="br-modal-sub">{deleteGroupTarget.groupName}</p>
                </div>
              </div>
            </div>
            <div className="br-modal-body br-modal-body-single">
              <p className="br-confirm-text">
                {(() => {
                  const sanctions = deleteGroupTarget.sanctionsCount ?? 0;
                  const companies = deleteGroupTarget.companiesCount ?? 0;
                  const subGroups = deleteGroupTarget.subGroupsCount ?? 0;
                  const parts = [];
                  if (sanctions > 0) {
                    parts.push(`${sanctions} sanction letter${sanctions === 1 ? '' : 's'} attached directly to it`);
                  }
                  if (companies > 0) {
                    parts.push(`the ${companies} compan${companies === 1 ? 'y' : 'ies'} under it (with their own sanction letters and stored documents)`);
                  }
                  if (subGroups > 0) {
                    parts.push(`${subGroups} Sub Group${subGroups === 1 ? '' : 's'} (with everything under ${subGroups === 1 ? 'it' : 'them'})`);
                  }
                  if (parts.length === 0) {
                    return `This ${deleteGroupTargetIsParent ? 'Parent Group' : 'Sub Group'} has nothing under it.`;
                  }
                  const joined = parts.length === 1 ? parts[0]
                    : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
                  return `${joined[0].toUpperCase()}${joined.slice(1)} will be permanently deleted with it.`;
                })()}
              </p>
              <p className="br-muted br-confirm-note">
                {deleteGroupTargetIsParent
                  ? 'This is permanent and cannot be undone.'
                  : ('This is permanent and cannot be undone. If you only meant to move this '
                    + 'Sub Group under a different Parent Group, use the option below instead.')}
              </p>
              {movingGroup && (
                <label className="br-field" style={{ marginTop: 10 }}>
                  <span className="br-field-label">Move to Parent Group</span>
                  <select
                    className="br-input"
                    value={movingGroupParentId}
                    onChange={(e) => setMovingGroupParentId(e.target.value)}
                  >
                    <option value="">— Select a Parent Group —</option>
                    {parentGroupOptions.map((p) => (
                      <option key={p.id} value={p.id}>{p.groupName}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="br-modal-foot">
              {/* A Parent Group has no "different Parent Group" to move under —
                  moving it would mean demoting it into a Sub Group, a bigger,
                  separate decision than "delete," so this option only applies
                  to a Sub Group target. */}
              {!movingGroup && !deleteGroupTargetIsParent && (
                <button type="button" className="br-btn" onClick={openMoveGroup} disabled={deletingGroup}>
                  Change organization
                </button>
              )}
              <button
                type="button" className="br-btn"
                onClick={() => { setDeleteGroupTarget(null); setMovingGroup(false); }}
                disabled={deletingGroup}
              >
                Cancel
              </button>
              {movingGroup ? (
                <button
                  type="button" className="br-btn br-btn-primary"
                  onClick={handleMoveGroup} disabled={deletingGroup || !movingGroupParentId}
                >
                  {deletingGroup ? 'Moving…' : 'Move'}
                </button>
              ) : (
                <button type="button" className="br-btn br-btn-danger" onClick={handleDeleteGroup} disabled={deletingGroup}>
                  <Trash2 size={15} aria-hidden="true" />
                  {deletingGroup ? 'Deleting…' : 'Delete'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {(orgLoading || orgTarget) && (
        <div className="br-modal-backdrop" onMouseDown={() => { if (!savingOrg) setOrgTarget(null); }}>
          <div
            className="br-modal" onMouseDown={(e) => e.stopPropagation()}
            role="dialog" aria-modal="true" aria-label="Change organization"
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
              {orgLoading ? <p className="br-muted">Loading…</p> : <HierarchyPicker value={orgValue} onChange={setOrgValue} />}
            </div>
            {orgError && <div className="br-banner br-banner-danger">{orgError}</div>}
            <div className="br-modal-foot">
              <button type="button" className="br-btn" onClick={() => setOrgTarget(null)} disabled={savingOrg}>
                Cancel
              </button>
              <button type="button" className="br-btn br-btn-primary" onClick={handleSaveOrg} disabled={savingOrg || orgLoading}>
                {savingOrg ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GroupDetail;
