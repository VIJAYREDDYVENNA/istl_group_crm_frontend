// src/components/borrowers/SanctionDetailView.js
//
// The read-only "Sanction Letter Detailed View" — one Overview tab shared by
// both BorrowerDetail.js branches (company and Parent/Sub Group), replacing
// the old 3-card side-by-side grid with the same left section-nav shell the
// Edit Sanction/Review What Was Read modal uses (see useSectionNav.js),
// walking the same 12 numbered sections in the same order. Every value shown
// here is read straight from `sanction`/`identityFields` — nothing is
// computed here that isn't already computed by buildDetailRows/DERIVED_ROWS
// (SanctionOverviewPanel.js) or SanctionDerivedCalculator.java, so this is a
// pure display reshuffle, not a new source of truth.
//
// Repayment Schedule stays its own tab (RepaymentScheduleSection) — this
// view only adds a read-only Sanction Terms *list* (06), not the schedule
// itself.
import React, { useRef } from 'react';
import { useSectionNav } from './useSectionNav';
import { sanctionFieldGroups } from './sanctionFields';
import {
  Row, isBlank, statusLabel, sourceLabel,
  buildDetailRows, DERIVED_ROWS, DSRA_DETAIL_KEYS, ISRA_DETAIL_KEYS, LEFT_ALIGN_KEYS,
} from './SanctionOverviewPanel';
import { useAuth } from '../../hooks/useAuth';
import '../../pages-css/SanctionRedesign.css';

const NAV_ORDER = [
  'Number', 'Borrower Details', 'Project Details', 'Project Cost & Finance',
  'Product', 'Sanction Terms', 'Interest & Repayment', 'Important Dates',
  'Conditions & Covenants', 'Derived Values', 'Status', 'Additional Information',
];
const FIELD_GROUPS = sanctionFieldGroups();
const NAV_SECTIONS = (() => {
  const byGroup = Object.fromEntries(FIELD_GROUPS.map((g) => [g.group, g]));
  return NAV_ORDER.map((group, i) => ({
    id: `srd-sec-${group.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`,
    num: String(i + 1).padStart(2, '0'),
    group,
    isFieldsGroup: !!byGroup[group],
  }));
})();
const NAV_SECTION_IDS = NAV_SECTIONS.map((s) => s.id);

const numFrom = (v) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0;

/**
 * @param {object} borrower
 * @param {object|null} sanction — the active BorrowerSanctionWrapper (with `terms`, all
 *   SANCTION_FIELDS keys, and every `derived*` figure), or null when the
 *   borrower/group has no sanction recorded yet.
 *
 * The borrower/group's own KYC identity (Promoter, Guarantor, Category,
 * contact details, etc.) and its "Manage"/"Complete identity details" action
 * stay in a small card the caller renders beside/above this view — that
 * identity is edited from its own screen, never from a sanction, so it's
 * kept out of this component rather than threaded through as another prop.
 * Section 02 here covers the sanction LETTER's own Borrower Details band
 * (Borrower, Lender, Project, Category, Registered Address).
 */
const SanctionDetailView = ({ borrower, sanction }) => {
  const { pagePermissions } = useAuth();
  const hasDsraPermission = !!pagePermissions?.BARROWER?.includes('VIEW_DSRA_DETAILS');
  const hasIsraPermission = !!pagePermissions?.BARROWER?.includes('VIEW_ISRA_DETAILS');
  const bodyRef = useRef(null);
  const { activeId, setSectionRef, jumpTo } = useSectionNav(NAV_SECTION_IDS, { rootRef: bodyRef });

  if (!sanction) {
    return (
      <div className="sr-detail-shell">
        <nav className="sr-nav" aria-label="Sanction section navigation">
          {NAV_SECTIONS.map((sec) => (
            <span key={sec.id} className="sr-nav-link">
              <span className="sr-nav-num">{sec.num}</span><span>{sec.group}</span>
            </span>
          ))}
        </nav>
        <div className="sr-detail-content">
          <p className="br-muted">These fill in once a sanction is recorded.</p>
        </div>
      </div>
    );
  }

  const allRows = buildDetailRows(borrower, sanction, { hasDsraPermission, hasIsraPermission });
  const rowsByGroup = {};
  allRows.forEach((f) => { (rowsByGroup[f.group] = rowsByGroup[f.group] || []).push(f); });
  const derivedRows = DERIVED_ROWS.filter((d) => (
    (hasDsraPermission || !DSRA_DETAIL_KEYS.has(d.key))
    && (hasIsraPermission || !ISRA_DETAIL_KEYS.has(d.key))
  ));
  const terms = sanction.terms || [];
  const limit = numFrom(sanction.limitAmount);

  return (
    <div className="sr-detail-shell">
      <nav className="sr-nav" aria-label="Sanction section navigation">
        {NAV_SECTIONS.map((sec) => (
          <button
            key={sec.id}
            type="button"
            className={`sr-nav-link${activeId === sec.id ? ' sr-nav-link--active' : ''}`}
            onClick={() => jumpTo(sec.id)}
          >
            <span className="sr-nav-num">{sec.num}</span><span>{sec.group}</span>
          </button>
        ))}
      </nav>

      <div className="sr-detail-content" ref={bodyRef}>
        {NAV_SECTIONS.map((sec) => (
          <section
            key={sec.id}
            id={sec.id}
            ref={setSectionRef(sec.id)}
            data-section-id={sec.id}
            className="sr-detail-section"
          >
            <div className="sr-detail-section-head">
              <span className="sr-nav-num">{sec.num}</span>
              <h3 className="sr-detail-section-title">{sec.group}</h3>
              {sec.group === 'Borrower Details' && sanction.source && (
                <span className="br-chip">{sourceLabel(sanction.source)}</span>
              )}
            </div>

            {sec.isFieldsGroup && (
              <dl className="br-dl">
                {(rowsByGroup[sec.group] || []).map((f) => (
                  <Row
                    key={f.key}
                    label={f.label}
                    value={f.value}
                    strong={f.key === 'sanctionedAmount'}
                    mono={f.mono}
                    align={LEFT_ALIGN_KEYS.has(f.key) ? 'left' : ''}
                    caption={f.hint}
                  />
                ))}
              </dl>
            )}

            {sec.group === 'Sanction Terms' && (
              terms.length > 0 ? (
                <div className="br-table-wrap">
                  <table className="br-table-list sr-terms-table-readonly">
                    <thead>
                      <tr>
                        <th className="br-center">#</th>
                        <th className="br-right">Term Limit (₹ Cr)</th>
                        <th>Facility Type</th>
                        <th className="br-right">% of Limit</th>
                        <th className="br-center">Tentative Disb. Date</th>
                        <th className="br-center">Actual Disb. Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {terms.map((t, i) => {
                        const pct = limit > 0 ? (numFrom(t.termLimit) / limit) * 100 : 0;
                        return (
                          <tr key={i}>
                            <td className="br-center">{i + 1}</td>
                            <td className="br-right">Rs. {t.termLimit || '—'}</td>
                            <td>{t.facilityType || '—'}</td>
                            <td className="br-right">{pct.toFixed(2)}%</td>
                            <td className="br-center">{t.tentativeDisbursementDate || '—'}</td>
                            <td className="br-center">{t.actualDisbursementDate || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="br-muted">No Sanction Terms recorded.</p>
              )
            )}

            {sec.group === 'Derived Values' && (
              <dl className="br-dl">
                {derivedRows.map((d) => (
                  <Row key={d.key} label={d.label} value={sanction[d.key]} tone={d.tone ? d.tone(sanction[d.key]) : ''} />
                ))}
                {derivedRows.every((d) => isBlank(sanction[d.key])) && (
                  <p className="br-muted br-dl-note">
                    Nothing to work these out from yet. They fill in as the amounts, rate and dates are recorded.
                  </p>
                )}
              </dl>
            )}

            {sec.group === 'Status' && (
              <dl className="br-dl">
                <Row label="Sanction Status" value={statusLabel(sanction.status)} />
                <Row label="Source" value={sourceLabel(sanction.source)} />
              </dl>
            )}
          </section>
        ))}
      </div>
    </div>
  );
};

export default SanctionDetailView;
