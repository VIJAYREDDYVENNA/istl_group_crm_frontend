// src/components/borrowers/HierarchyTree.js
//
// Level 1 of the registry drill-down: a flat list of top-level Parent Groups
// and standalone companies — no nested rows. A Sub Group is never shown here;
// it's reached only by drilling into its Parent Group's own detail page
// (GroupDetail.js), which keeps every entity at exactly one place in the
// navigation instead of also appearing as a sibling at this top level.
//
// `data` is already the current page's rows and already search-filtered —
// both now happen server-side (see BorrowerRegistry.js's loadHierarchy) so
// a search can match rows outside whatever page happens to be loaded. This
// component just renders what it's given, plus the pagination footer for it.
//
// The tab strip (All Borrowers/Parent Group/Standalone), the Status filter
// and Sort by control below are all client-side, over the one page of rows
// already fetched — there's no dedicated backend endpoint for any of the
// three, and adding one wasn't asked for here. That means the tab counts and
// filter/sort only ever apply to whatever page is currently loaded, same as
// every other value already shown from `data` — not a registry-wide total.

import React, { useState } from 'react';
import { Users, Lock, Eye, Trash2, Filter, ArrowUpDown } from 'lucide-react';
import Pagination from './Pagination';
import SanctionStatusBadge from './SanctionStatusBadge';

const TYPE_BADGE_CLASS = {
  'Parent Group': 'brx-badge-purple',
  Standalone: 'brx-badge-green',
  Subsidiary: 'brx-badge-blue',
  SPV: 'brx-badge-orange',
  'Subsidiary + SPV': 'brx-badge-orange',
};

const TypeBadge = ({ label }) => (
  <span className={`brx-type-badge ${TYPE_BADGE_CLASS[label] || 'brx-badge-slate'}`}>{label}</span>
);

// A row's own sortable name/amount, regardless of whether it's a group or a
// standalone company row — lets the tab/filter/sort logic below treat both
// kinds as one list instead of branching everywhere.
const rowName = (r) => (r.kind === 'group' ? r.groupName : r.borrowerName);
const rowAmount = (r) => parseFloat(String(r.totalSanctionedAmount || '').replace(/[^0-9.-]/g, '')) || 0;

const HierarchyTree = ({
  data, loading, search, onSelectCompany, onSelectGroup, onViewGroup, onDeleteCompany, onDeleteGroup,
  page, pageCount, pageSize, totalRows, onPageChange, onPageSizeChange, onStatusChanged,
}) => {
  const groups = data?.groups || [];
  const standalone = data?.standalone || [];

  const [tab, setTab] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('default');

  // Small, page-sized arrays (at most `pageSize`, capped at 100) — plain
  // recomputation on every render rather than useMemo, no perf need for it.
  const combined = [
    ...groups.map((g) => ({ kind: 'group', ...g })),
    ...standalone.map((c) => ({ kind: 'company', ...c })),
  ];

  let visibleRows = combined;
  if (tab === 'group') visibleRows = visibleRows.filter((r) => r.kind === 'group');
  if (tab === 'standalone') visibleRows = visibleRows.filter((r) => r.kind === 'company');
  if (statusFilter !== 'all') visibleRows = visibleRows.filter((r) => (r.status || '') === statusFilter);
  if (sortBy !== 'default') {
    visibleRows = [...visibleRows].sort((a, b) => {
      if (sortBy === 'name-asc') return rowName(a).localeCompare(rowName(b));
      if (sortBy === 'name-desc') return rowName(b).localeCompare(rowName(a));
      if (sortBy === 'amount-desc') return rowAmount(b) - rowAmount(a);
      if (sortBy === 'amount-asc') return rowAmount(a) - rowAmount(b);
      return 0;
    });
  }

  if (loading) {
    return <div className="brx-tree-card"><p className="brx-muted brx-pad">Loading…</p></div>;
  }
  if (groups.length === 0 && standalone.length === 0) {
    return (
      <div className="brx-tree-card">
        <p className="brx-muted brx-pad">
          {search ? `Nothing in the registry matches "${search}"` : 'No borrowers yet.'}
        </p>
      </div>
    );
  }

  // Numbering continues across pages (server-paginated), same convention as
  // "Showing X–Y of Z" below it — not reset to 1 on every page.
  const numberOffset = (page - 1) * pageSize;

  return (
    <div className="brx-tree-card">
      <div className="brx-tree-toolbar">
        <div className="brx-tabs" role="tablist" aria-label="Filter by borrower type">
          <button
            type="button" role="tab" aria-selected={tab === 'all'}
            className={`brx-tab ${tab === 'all' ? 'brx-tab-active' : ''}`}
            onClick={() => setTab('all')}
          >
            All Borrowers <span className="brx-tab-count">{combined.length}</span>
          </button>
          <button
            type="button" role="tab" aria-selected={tab === 'group'}
            className={`brx-tab ${tab === 'group' ? 'brx-tab-active' : ''}`}
            onClick={() => setTab('group')}
          >
            Parent Group <span className="brx-tab-count">{groups.length}</span>
          </button>
          <button
            type="button" role="tab" aria-selected={tab === 'standalone'}
            className={`brx-tab ${tab === 'standalone' ? 'brx-tab-active' : ''}`}
            onClick={() => setTab('standalone')}
          >
            Standalone <span className="brx-tab-count">{standalone.length}</span>
          </button>
        </div>
        <div className="brx-toolbar-right">
          <span className="brx-tool-select">
            <Filter size={13} className="brx-tool-select-icon" aria-hidden="true" />
            <select
              className="brx-tool-select-input" aria-label="Filter by status"
              value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">Filters</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </span>
          <span className="brx-tool-select">
            <ArrowUpDown size={13} className="brx-tool-select-icon" aria-hidden="true" />
            <select
              className="brx-tool-select-input" aria-label="Sort by"
              value={sortBy} onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="default">Sort by</option>
              <option value="name-asc">Name (A–Z)</option>
              <option value="name-desc">Name (Z–A)</option>
              <option value="amount-desc">Amount (High–Low)</option>
              <option value="amount-asc">Amount (Low–High)</option>
            </select>
          </span>
        </div>
      </div>

      <div className="brx-tree-scroll brx-tree-scroll-10">
        <table className="brx-tree-table brx-tree-table-numbered">
          <thead>
            <tr>
              <th className="brx-right">#</th>
              <th>Group / Company / Borrower</th>
              <th>Type</th>
              <th>CIN</th>
              <th className="brx-num">Sanctions</th>
              <th className="brx-num">Total Sanctioned Amount</th>
              <th>Status</th>
              <th className="brx-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={8} className="brx-muted brx-pad">Nothing matches this filter.</td>
              </tr>
            )}
            {visibleRows.map((r, i) => (r.kind === 'group' ? (
              <tr key={`g${r.id}`} className="brx-tree-tr brx-tree-tr-group">
                <td className="brx-right brx-mono brx-muted">{numberOffset + i + 1}</td>
                <td>
                  <span className="brx-tree-name-cell">
                    <span className="brx-tree-row-icon brx-tree-row-icon-group" aria-hidden="true">
                      <Users size={13} />
                    </span>
                    <button
                      type="button" className="brx-ref-link" title={r.groupName}
                      onClick={() => onSelectGroup(r.id)}
                    >
                      <strong>{r.groupName}</strong>
                    </button>
                  </span>
                </td>
                <td><TypeBadge label="Parent Group" /></td>
                <td className="brx-mono">{r.cin || <span className="brx-dash">—</span>}</td>
                <td className="brx-num">{r.sanctionsCount}</td>
                <td className="brx-num">{r.totalSanctionedAmount || '₹0.00 Cr'}</td>
                <td>
                  <span className={`brx-status-pill ${r.status === 'Active' ? 'brx-status-active' : 'brx-status-muted'}`}>
                    {r.status}
                  </span>
                </td>
                <td className="brx-right">
                  <div className="brx-row-actions">
                    <button
                      type="button" className="brx-icon-btn"
                      title={`View ${r.groupName}`} aria-label={`View ${r.groupName}`}
                      onClick={() => onViewGroup(r.id)}
                    >
                      <Eye size={15} aria-hidden="true" />
                    </button>
                    <button
                      type="button" className="brx-icon-btn brx-icon-danger"
                      title={`Delete ${r.groupName}`} aria-label={`Delete ${r.groupName}`}
                      onClick={() => onDeleteGroup(r)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              <tr key={`c${r.id}`} className="brx-tree-tr">
                <td className="brx-right brx-mono brx-muted">{numberOffset + i + 1}</td>
                <td>
                  <span className="brx-tree-name-cell">
                    <span className="brx-tree-row-icon brx-tree-row-icon-company" aria-hidden="true">
                      <Lock size={12} />
                    </span>
                    <button
                      type="button" className="brx-ref-link" title={r.borrowerName}
                      onClick={() => onSelectCompany(r.id)}
                    >
                      {r.borrowerName}
                    </button>
                  </span>
                </td>
                <td><TypeBadge label={r.companyType} /></td>
                <td className="brx-mono">{r.cin || <span className="brx-dash">—</span>}</td>
                <td className="brx-num">{r.sanctionsCount}</td>
                <td className="brx-num">{r.totalSanctionedAmount || '₹0.00 Cr'}</td>
                <td>
                  <SanctionStatusBadge
                    sanctionId={r.latestSanctionId}
                    refNo={r.latestSanctionRefNo}
                    cin={r.cin}
                    status={r.status}
                    disabled={!r.latestSanctionId}
                    onChanged={onStatusChanged}
                  />
                </td>
                <td className="brx-right">
                  <div className="brx-row-actions">
                    <button
                      type="button" className="brx-icon-btn"
                      title={`View ${r.borrowerName}`} aria-label={`View ${r.borrowerName}`}
                      onClick={() => onSelectCompany(r.id)}
                    >
                      <Eye size={15} aria-hidden="true" />
                    </button>
                    <button
                      type="button" className="brx-icon-btn brx-icon-danger"
                      title={`Delete ${r.borrowerName}`} aria-label={`Delete ${r.borrowerName}`}
                      onClick={() => onDeleteCompany(r)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            )))}
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
          onPageSizeChange={onPageSizeChange}
          pageSizeOptions={[10, 25, 50, 100]}
        />
      )}
    </div>
  );
};

export default HierarchyTree;
