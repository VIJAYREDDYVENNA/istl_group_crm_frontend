// src/Pages/BorrowerMasterData.js
//
// Standalone Parent Group / Sub Group master-data management for the Lender
// module. Reads and writes the exact same `company_groups` table, through
// the exact same borrowerApi group endpoints, that HierarchyPicker.js (the
// Confirm Company modal's Parent Group / Sub Group pickers) and
// GroupDetail.js already use — so anything created/edited/deleted here
// shows up in both those places automatically, and vice versa, with no
// extra syncing: it's one shared data source, not a copy.
//
// The three fields per group (name, optional CIN, optional registered
// address) and their validation/save shape are lifted verbatim from
// GroupDetail.js's own "Edit group" / "Add Sub Group" forms
// (handleSaveGroupEdit / handleAddSubGroup) so this page behaves exactly
// like the rest of the module, not a new pattern.
//
// Visual pieces below reuse existing components rather than new ones: the
// 3 summary cards are the same .brx-stat card OverviewSummaryCards.js/
// Pages/BorrowerRegistry.js already use, the level filter is the existing
// FilterSelect (same "search + dropdown" shape as Pages/Tenders.js), and
// the footer is the existing Pagination.js (already used by GroupDetail.js's
// tables). Only the row avatar/count-pill/circular action buttons are new —
// nothing reusable existed for those three.

import React, { useCallback, useEffect, useState } from 'react';
import {
  Plus, Search, Pencil, Trash2, AlertTriangle, X, Check, ChevronRight, ChevronDown,
  Users, GitBranch, FileText,
} from 'lucide-react';
import borrowerApi from '../services/borrowerApi';
import CrmPreloader from '../components/preLoader';
import FilterSelect from '../components/Dropdowns/FilterSelect';
import Pagination from '../components/borrowers/Pagination';
import { CIN_REGEX, toCin } from '../components/borrowers/borrowerFields';
import useToast from '../hooks/useToast';
import ToastContainer from '../components/Notification_Toast/ToastContainer';
import '../pages-css/BorrowerRegistry.css';
import '../pages-css/BorrowerRegistryPremium.css';

const EMPTY_FORM = { name: '', cin: '', address: '' };
const PAGE_SIZE = 10;
const LEVEL_OPTIONS = [
  { value: 'ALL', label: 'All Groups' },
  { value: 'PARENT_ONLY', label: 'Parent Groups Only' },
  { value: 'SUB_ONLY', label: 'Sub Groups Only' },
];

// Sanction letters attached directly to a group/sub-group are already
// ordered most-recent-first by the backend (findByGroupIdAndDeletedAtIsNull
// OrderBySanctionDateDesc) — shows that one's ref no, plus a count of any
// others rather than listing every one out.
const sanctionLabel = (sanctions) => {
  if (!sanctions) return '…';
  if (sanctions.length === 0) return '—';
  const latest = sanctions[0].refNo || 'Untitled';
  return sanctions.length === 1 ? latest : `${latest} (+${sanctions.length - 1} more)`;
};

const initialOf = (name) => (name || '?').trim().charAt(0).toUpperCase() || '?';

const Avatar = ({ name, sub = false }) => (
  <span className={`bmd-avatar${sub ? ' bmd-avatar-sub' : ''}`} aria-hidden="true">{initialOf(name)}</span>
);

const BorrowerMasterData = () => {
  const { toasts, removeToast, showSuccess, showError } = useToast();

  const [parents, setParents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState('ALL');
  const [page, setPage] = useState(1);

  const [expanded, setExpanded] = useState({}); // { [parentId]: true }
  const [subGroups, setSubGroups] = useState({}); // { [parentId]: { items, loading } }
  // Sanction letters attached directly to a group/sub-group (never a child
  // company's own) — keyed by group id, same /groups/{id}/sanctions data
  // GroupDetail.js's own rows already show. Fetched alongside the group
  // list itself so the "Sanction Letter(s)" column and the summary cards
  // are populated up front.
  const [sanctionsByGroupId, setSanctionsByGroupId] = useState({});

  const fetchSanctionsFor = async (ids) => {
    const pairs = await Promise.all(ids.map(async (id) => {
      try {
        return [id, await borrowerApi.listGroupSanctions(id)];
      } catch {
        return [id, []];
      }
    }));
    setSanctionsByGroupId((m) => ({ ...m, ...Object.fromEntries(pairs) }));
  };

  const loadSubGroups = useCallback(async (parentId) => {
    setSubGroups((m) => ({ ...m, [parentId]: { items: m[parentId]?.items || [], loading: true } }));
    try {
      const items = await borrowerApi.getGroups(parentId);
      setSubGroups((m) => ({ ...m, [parentId]: { items, loading: false } }));
      fetchSanctionsFor(items.map((s) => s.id));
    } catch (e) {
      showError(e.message || 'Could not load Sub Groups');
      setSubGroups((m) => ({ ...m, [parentId]: { items: m[parentId]?.items || [], loading: false } }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sub Groups (and their sanctions) are still fetched via the exact same
  // loadSubGroups call the row-expand toggle uses — just for every parent
  // up front now, instead of only on-demand, so the "Total Sub Groups"/
  // "Total Sanction Letters" summary cards and every parent's "N sub
  // group(s)" pill are accurate without the reader having to expand every
  // row first. Row-expand itself now just reveals already-loaded data.
  const loadParents = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await borrowerApi.getGroups();
      setParents(list);
      fetchSanctionsFor(list.map((p) => p.id));
      list.forEach((p) => loadSubGroups(p.id));
    } catch (e) {
      setError(e.message || 'Could not load Parent Groups');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadParents(); }, [loadParents]);

  const toggleExpand = (parentId) => {
    setExpanded((m) => ({ ...m, [parentId]: !m[parentId] }));
  };

  useEffect(() => { setPage(1); }, [search, levelFilter]);

  // ── Search / filter / pagination ────────────────────────────────────────

  const searchLower = search.trim().toLowerCase();
  const filteredParents = parents.filter((p) => !searchLower || p.groupName.toLowerCase().includes(searchLower));
  const allSubGroupsFlat = parents.flatMap((p) => (subGroups[p.id]?.items || [])
    .map((s) => ({ ...s, parentName: p.groupName })));
  const filteredSubFlat = allSubGroupsFlat.filter((s) => !searchLower || s.groupName.toLowerCase().includes(searchLower));

  const rowsForLevel = levelFilter === 'SUB_ONLY' ? filteredSubFlat : filteredParents;
  const totalRows = rowsForLevel.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = rowsForLevel.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // ── Summary counts — live, computed from the same state the table renders ──
  const totalSubGroups = parents.reduce((sum, p) => sum + (subGroups[p.id]?.items?.length ?? 0), 0);
  const totalSanctionLetters = parents.reduce((sum, p) => {
    const own = sanctionsByGroupId[p.id]?.length ?? 0;
    const subIds = (subGroups[p.id]?.items || []).map((s) => s.id);
    const underSubs = subIds.reduce((s2, id) => s2 + (sanctionsByGroupId[id]?.length ?? 0), 0);
    return sum + own + underSubs;
  }, 0);

  // ── Add / Edit ──────────────────────────────────────────────────────────

  const [formOpen, setFormOpen] = useState(false);
  const [formTarget, setFormTarget] = useState(null); // { editing, parentId, kind }
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const openAddParent = () => {
    setFormTarget({ editing: null, parentId: null, kind: 'Parent Group' });
    setForm(EMPTY_FORM);
    setFormError('');
    setFormOpen(true);
  };

  const openAddSub = (parentId) => {
    setFormTarget({ editing: null, parentId, kind: 'Sub Group' });
    setForm(EMPTY_FORM);
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (group, kind) => {
    setFormTarget({ editing: group, parentId: group.parentGroupId || null, kind });
    setForm({ name: group.groupName || '', cin: group.cin || '', address: group.registeredAddress || '' });
    setFormError('');
    setFormOpen(true);
  };

  const handleSaveForm = async () => {
    setFormError('');
    if (!form.name.trim()) { setFormError(`${formTarget.kind} name is required`); return; }
    if (form.cin && !CIN_REGEX.test(form.cin)) {
      setFormError('Enter a valid 21-character CIN, e.g. U40106MH2026PTC223978');
      return;
    }
    setSaving(true);
    try {
      const body = {
        groupName: form.name.trim(),
        parentGroupId: formTarget.parentId || null,
        cin: form.cin.trim(),
        registeredAddress: form.address.trim(),
      };
      if (formTarget.editing) {
        await borrowerApi.updateGroup(formTarget.editing.id, body);
        showSuccess(`${formTarget.kind} updated`);
      } else {
        await borrowerApi.createGroup(body);
        showSuccess(`${formTarget.kind} created`);
      }
      setFormOpen(false);
      if (formTarget.parentId) {
        await loadSubGroups(formTarget.parentId);
      } else {
        await loadParents();
      }
    } catch (e) {
      setFormError(e.message || `Could not save this ${formTarget.kind}`);
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ──────────────────────────────────────────────────────────────

  const [deleteTarget, setDeleteTarget] = useState(null); // { id, groupName, parentGroupId, companiesCount, subGroupsCount }
  const [deleting, setDeleting] = useState(false);

  const openDelete = async (group) => {
    try {
      // Fetch fresh counts for an accurate cascade warning — the plain list
      // rows don't carry them. A sanction letter can be attached directly to
      // a Group/Sub Group itself (no company in between — exactly what
      // happens via Borrower Registry's "Add Sanction for this Group"), so
      // that has to be checked separately from directCompaniesCount/
      // subGroupsCount via the same /groups/{id}/sanctions endpoint
      // GroupDetail.js uses, or a group with only a direct sanction and no
      // companies would misleadingly read as "nothing under it."
      const [detail, sanctions] = await Promise.all([
        borrowerApi.getGroupDetail(group.id),
        borrowerApi.listGroupSanctions(group.id),
      ]);
      setDeleteTarget({
        ...group,
        companiesCount: detail.directCompaniesCount ?? 0,
        subGroupsCount: detail.subGroupsCount ?? 0,
        sanctionsCount: sanctions.length,
      });
    } catch (e) {
      setDeleteTarget({ ...group, companiesCount: 0, subGroupsCount: 0, sanctionsCount: 0 });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await borrowerApi.deleteGroup(deleteTarget.id);
      showSuccess(`${deleteTarget.parentGroupId ? 'Sub Group' : 'Parent Group'} deleted`);
      setDeleteTarget(null);
      if (deleteTarget.parentGroupId) {
        await loadSubGroups(deleteTarget.parentGroupId);
      } else {
        await loadParents();
      }
    } catch (e) {
      showError(e.message || 'Could not delete this group');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="br-page">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="br-head">
        <span className="bmd-header-icon" aria-hidden="true"><Users size={24} /></span>
        <div className="br-head-text">
          <h1 className="br-title">Borrower Master Data</h1>
          <p className="br-sub">Manage Parent Groups and Sub Groups used across the Lender module.</p>
        </div>
        <button type="button" className="br-btn br-btn-primary" onClick={openAddParent}>
          <Plus size={16} aria-hidden="true" /> Add Parent Group
        </button>
      </div>

      <div className="brx-stats">
        <div className="brx-stat brx-stat-blue">
          <span className="brx-stat-icon"><Users size={19} aria-hidden="true" /></span>
          <span className="brx-stat-body">
            <span className="brx-stat-value">{parents.length}</span>
            <span className="brx-stat-label">Total Parent Groups</span>
          </span>
        </div>
        <div className="brx-stat brx-stat-purple">
          <span className="brx-stat-icon"><GitBranch size={19} aria-hidden="true" /></span>
          <span className="brx-stat-body">
            <span className="brx-stat-value">{totalSubGroups}</span>
            <span className="brx-stat-label">Total Sub Groups</span>
          </span>
        </div>
        <div className="brx-stat brx-stat-green">
          <span className="brx-stat-icon"><FileText size={19} aria-hidden="true" /></span>
          <span className="brx-stat-body">
            <span className="brx-stat-value">{totalSanctionLetters}</span>
            <span className="brx-stat-label">Total Sanction Letters</span>
          </span>
        </div>
      </div>

      <div className="br-filters">
        <div className="br-search">
          <Search size={16} className="br-search-icon" aria-hidden="true" />
          <input
            className="br-input br-input-icon"
            placeholder="Search Parent Groups…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <FilterSelect
          value={levelFilter}
          options={LEVEL_OPTIONS}
          searchable={false}
          onChange={(v) => setLevelFilter(v || 'ALL')}
        />
      </div>

      {error && <div className="br-banner br-banner-danger">{error}</div>}

      {loading ? (
        <CrmPreloader />
      ) : (
        <div className="brx-tree-card">
          <div className="brx-tree-scroll">
          <table className="br-table">
            <thead>
              <tr>
                <th>Group Name</th>
                <th>CIN</th>
                <th>Registered Address</th>
                <th>Sanction Letter(s)</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr><td colSpan={5} className="br-muted">No groups found.</td></tr>
              )}

              {levelFilter === 'SUB_ONLY' ? pageRows.map((s) => (
                <tr key={s.id}>
                  <td>
                    <span className="bmd-row-name">
                      <Avatar name={s.groupName} sub />
                      {s.groupName}
                    </span>
                  </td>
                  <td className="br-mono">{s.cin || '—'}</td>
                  <td>{s.registeredAddress || '—'}</td>
                  <td>{sanctionLabel(sanctionsByGroupId[s.id])}</td>
                  <td>
                    <button type="button" className="bmd-action-btn bmd-action-edit" onClick={() => openEdit(s, 'Sub Group')} aria-label="Edit">
                      <Pencil size={14} />
                    </button>
                    <button type="button" className="bmd-action-btn bmd-action-delete" onClick={() => openDelete(s)} aria-label="Delete">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              )) : pageRows.map((p) => {
                const isOpen = levelFilter === 'ALL' && !!expanded[p.id];
                const subState = subGroups[p.id];
                const subCount = subState?.items?.length ?? 0;
                return (
                  <React.Fragment key={p.id}>
                    <tr>
                      <td>
                        <span className="bmd-row-name">
                          {levelFilter === 'ALL' && (
                            <button type="button" className="br-icon-btn" onClick={() => toggleExpand(p.id)}
                              aria-label={isOpen ? 'Collapse' : 'Expand'} aria-expanded={isOpen}>
                              {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                          )}
                          <Avatar name={p.groupName} />
                          <strong>{p.groupName}</strong>
                          {levelFilter === 'ALL' && (
                            <span className="bmd-pill">{subCount} sub group{subCount === 1 ? '' : 's'}</span>
                          )}
                        </span>
                      </td>
                      <td className="br-mono">{p.cin || '—'}</td>
                      <td>{p.registeredAddress || '—'}</td>
                      <td>{sanctionLabel(sanctionsByGroupId[p.id])}</td>
                      <td>
                        <button type="button" className="bmd-action-btn bmd-action-add" onClick={() => openAddSub(p.id)} aria-label="Add Sub Group" title="Add Sub Group">
                          <Plus size={15} />
                        </button>
                        <button type="button" className="bmd-action-btn bmd-action-edit" onClick={() => openEdit(p, 'Parent Group')} aria-label="Edit">
                          <Pencil size={14} />
                        </button>
                        <button type="button" className="bmd-action-btn bmd-action-delete" onClick={() => openDelete(p)} aria-label="Delete">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={5} style={{ background: 'var(--c-f8fafc, #f8fafc)', padding: '8px 8px 8px 32px' }}>
                          {subState?.loading ? (
                            <span className="br-muted">Loading Sub Groups…</span>
                          ) : (subState?.items || []).length === 0 ? (
                            <span className="br-muted">No Sub Groups under this Parent Group.</span>
                          ) : (
                            <table className="br-table">
                              <tbody>
                                {subState.items.map((s) => (
                                  <tr key={s.id}>
                                    <td>
                                      <span className="bmd-row-name">
                                        <span className="bmd-connector">└</span>
                                        <Avatar name={s.groupName} sub />
                                        {s.groupName}
                                      </span>
                                    </td>
                                    <td className="br-mono">{s.cin || '—'}</td>
                                    <td>{s.registeredAddress || '—'}</td>
                                    <td>{sanctionLabel(sanctionsByGroupId[s.id])}</td>
                                    <td>
                                      <button type="button" className="bmd-action-btn bmd-action-edit" onClick={() => openEdit(s, 'Sub Group')} aria-label="Edit">
                                        <Pencil size={14} />
                                      </button>
                                      <button type="button" className="bmd-action-btn bmd-action-delete" onClick={() => openDelete(s)} aria-label="Delete">
                                        <Trash2 size={14} />
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          </div>

          <Pagination
            page={safePage}
            pageCount={pageCount}
            pageSize={PAGE_SIZE}
            totalRows={totalRows}
            onPageChange={setPage}
            showSizeSelector={false}
          />
        </div>
      )}

      {formOpen && (
        <div className="br-modal-backdrop" onMouseDown={() => setFormOpen(false)}>
          <div className="br-modal" onMouseDown={(e) => e.stopPropagation()}
            role="dialog" aria-modal="true" aria-label={`${formTarget.editing ? 'Edit' : 'Add'} ${formTarget.kind}`}>
            <div className="br-modal-head">
              <h3 className="br-modal-title">{formTarget.editing ? 'Edit' : 'Add'} {formTarget.kind}</h3>
              <button type="button" className="br-icon-btn" onClick={() => setFormOpen(false)} aria-label="Close">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="br-modal-body br-modal-body-single">
              <label className="br-field">
                <span className="br-field-label">{formTarget.kind} name<span className="br-req"> *</span></span>
                <input
                  className="br-input" autoFocus
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  disabled={saving}
                />
              </label>
              <label className="br-field">
                <span className="br-field-label">CIN (optional)</span>
                <input
                  className="br-input br-input-mono"
                  value={form.cin}
                  onChange={(e) => setForm((f) => ({ ...f, cin: toCin(e.target.value) }))}
                  placeholder="Not on file"
                  maxLength={21}
                  disabled={saving}
                />
              </label>
              <label className="br-field">
                <span className="br-field-label">Registered Address (optional)</span>
                <textarea
                  className="br-input br-textarea" rows={2}
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  disabled={saving}
                />
              </label>
            </div>
            {formError && <div className="br-banner br-banner-danger">{formError}</div>}
            <div className="br-modal-foot">
              <button type="button" className="br-btn" onClick={() => setFormOpen(false)} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="br-btn br-btn-primary" onClick={handleSaveForm} disabled={saving}>
                <Check size={15} aria-hidden="true" />
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
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
                  <h3 className="br-modal-title">
                    Delete this {deleteTarget.parentGroupId ? 'Sub Group' : 'Parent Group'}?
                  </h3>
                  <p className="br-modal-sub">{deleteTarget.groupName}</p>
                </div>
              </div>
            </div>
            <div className="br-modal-body br-modal-body-single">
              <p className="br-confirm-text">
                {(() => {
                  const companies = deleteTarget.companiesCount ?? 0;
                  const subGroupsN = deleteTarget.subGroupsCount ?? 0;
                  const sanctions = deleteTarget.sanctionsCount ?? 0;
                  const parts = [];
                  if (sanctions > 0) {
                    parts.push(`${sanctions} sanction letter${sanctions === 1 ? '' : 's'} attached directly to it`);
                  }
                  if (companies > 0) {
                    parts.push(`the ${companies} compan${companies === 1 ? 'y' : 'ies'} under it (with their own sanction letters and stored documents)`);
                  }
                  if (subGroupsN > 0) {
                    parts.push(`${subGroupsN} Sub Group${subGroupsN === 1 ? '' : 's'} (with everything under ${subGroupsN === 1 ? 'it' : 'them'})`);
                  }
                  if (parts.length === 0) {
                    return `This ${deleteTarget.parentGroupId ? 'Sub Group' : 'Parent Group'} has nothing under it.`;
                  }
                  const joined = parts.length === 1 ? parts[0]
                    : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
                  return `${joined[0].toUpperCase()}${joined.slice(1)} will be permanently deleted with it.`;
                })()}
              </p>
              <p className="br-muted br-confirm-note">This is permanent and cannot be undone.</p>
            </div>
            <div className="br-modal-foot">
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
    </div>
  );
};

export default BorrowerMasterData;
