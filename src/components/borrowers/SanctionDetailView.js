// src/components/borrowers/SanctionDetailView.js
//
// The read-only Overview tab, shared by both BorrowerDetail.js branches
// (company and Parent/Sub Group): a full-width, plain-flowing dashboard —
// KPI row, then cards grouped into rows (Borrower/Project Details;
// Project Cost & Finance/Limit Terms/Derived Values; Interest &
// Repayment/Repayment Details; then the remaining compact cards). Every
// value shown here is read straight from `sanction`/`borrower` — nothing is
// computed here that isn't already computed by buildDetailRows/DERIVED_ROWS
// (SanctionOverviewPanel.js) or SanctionDerivedCalculator.java, so this is a
// pure display reshuffle, not a new source of truth.
//
// There's no left section-jump nav on this read-only view (unlike the Edit
// Sanction/Review What Was Read modal, which keeps its own separate,
// narrower section nav via the same useSectionNav.js hook) — every section
// below is still wrapped in an anchor `<section id=...>` for stable deep
// links, just without the scroll-spy/jump-to-section chrome.
//
// "Interest & Repayment" (one field group in sanctionFields.js) is split
// into two visual cards here — rate mechanics vs. schedule mechanics — pure
// presentation: the underlying field list/order/labels are untouched.
import React from 'react';
import {
  User, FileText, Landmark, Package, ClipboardList, Percent,
  Calendar, Shield, LineChart, Info, MoreHorizontal, RefreshCw,
} from 'lucide-react';
import { sanctionFieldGroups } from './sanctionFields';
import {
  Row, isBlank, statusLabel, sourceLabel,
  buildDetailRows, DERIVED_ROWS, DSRA_DETAIL_KEYS, ISRA_DETAIL_KEYS, LEFT_ALIGN_KEYS,
} from './SanctionOverviewPanel';
import { useAuth } from '../../hooks/useAuth';
import OverviewSummaryCards from './OverviewSummaryCards';
import BorrowerDetailsCard from './BorrowerDetailsCard';
import ProjectDetailsCard from './ProjectDetailsCard';
import ProjectFinanceCard from './ProjectFinanceCard';
import LimitTermsCard from './LimitTermsCard';
import DetailedSection from './DetailedSection';
import '../../pages-css/SanctionRedesign.css';

const NAV_ORDER = [
  'Overview', 'Borrower Details', 'Project Details', 'Project Cost & Finance',
  'Product', 'Limit Terms', 'Interest & Repayment', 'Important Dates',
  'Conditions & Covenants', 'Derived Values', 'Status', 'Additional Information',
];
const NAV_ICONS = {
  'Borrower Details': User,
  'Project Details': FileText,
  'Project Cost & Finance': Landmark,
  Product: Package,
  'Limit Terms': ClipboardList,
  'Interest & Repayment': Percent,
  'Repayment Details': RefreshCw,
  'Important Dates': Calendar,
  'Conditions & Covenants': Shield,
  'Derived Values': LineChart,
  Status: Info,
  'Additional Information': MoreHorizontal,
};
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
const sectionByGroup = Object.fromEntries(NAV_SECTIONS.map((s) => [s.group, s]));

// Interest & Repayment (one field group in sanctionFields.js) split into two
// cards purely for layout — see file header comment.
const INTEREST_RATE_KEYS = ['baseRatePct', 'spreadPct', 'interestRateText', 'tenorText'];
const REPAYMENT_SCHEDULE_KEYS = [
  'moratoriumMonths', 'interestDuringMoratorium', 'repaymentFrequency',
  'repaymentFrequencyOtherMonths', 'repaymentStartDate', 'repaymentEndDate',
];

// sanction.limitAmount/term.termLimit arrive already formatted for display
// ("₹65.50 Cr", from SanctionValueParser.formatCrore) here, unlike the edit
// modal's own numFrom, which reads the raw, unformatted form value — so this
// one strips everything but digits/decimal/minus, not just commas.
const numFrom = (v) => parseFloat(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;

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
 * The Borrower Details card here covers the sanction LETTER's own band
 * (Borrower, Lender, Project, Registered Address, Reference number).
 */
const SanctionDetailView = ({ borrower, sanction }) => {
  const { pagePermissions } = useAuth();
  const hasDsraPermission = !!pagePermissions?.BARROWER?.includes('VIEW_DSRA_DETAILS');
  const hasIsraPermission = !!pagePermissions?.BARROWER?.includes('VIEW_ISRA_DETAILS');

  if (!sanction) {
    return (
      <div className="sr-detail-empty">
        <p className="br-muted">These fill in once a sanction is recorded.</p>
      </div>
    );
  }

  const allRows = buildDetailRows(borrower, sanction, { hasDsraPermission, hasIsraPermission });
  const rowsByGroup = {};
  allRows.forEach((f) => { (rowsByGroup[f.group] = rowsByGroup[f.group] || []).push(f); });
  // Both cards' row order/membership is reshuffled from sanctionFields.js's
  // own declaration order for these two dashboard cards specifically — a
  // display-only rearrangement (SANCTION_FIELDS itself, and every other
  // consumer of it — the edit form, SanctionCompareModal — keep their
  // existing order untouched):
  //   - Borrower Details: Borrower, Lender, CIN, Reference number (folded in
  //     from the old standalone "Number" section, now placed after CIN
  //     rather than first), Registered Address, Project Location.
  //   - "Project" (the project description) moves out of Borrower Details
  //     and into Project Details, between Sub Category and Technology.
  const borrowerDetailsAll = rowsByGroup['Borrower Details'] || [];
  const projectNameRow = borrowerDetailsAll.find((f) => f.key === 'projectName');
  const borrowerDetailsRestByKey = Object.fromEntries(
    borrowerDetailsAll.filter((f) => f.key !== 'projectName').map((f) => [f.key, f]),
  );
  const refNoRow = (rowsByGroup.Number || []).find((f) => f.key === 'refNo');
  const borrowerDetailsRows = [
    borrowerDetailsRestByKey.borrowerName,
    borrowerDetailsRestByKey.lenderName,
    borrowerDetailsRestByKey.cin,
    refNoRow,
    borrowerDetailsRestByKey.registeredAddress,
    borrowerDetailsRestByKey.location,
  ].filter(Boolean);
  const derivedRows = DERIVED_ROWS.filter((d) => (
    (hasDsraPermission || !DSRA_DETAIL_KEYS.has(d.key))
    && (hasIsraPermission || !ISRA_DETAIL_KEYS.has(d.key))
  ));
  const terms = sanction.terms || [];
  const limit = numFrom(sanction.limitAmount);

  // Stable anchor id per card — id defaults to the section's own nav id, or
  // an explicit override for a card that doesn't map 1:1 to one nav entry
  // (the Interest & Repayment / Repayment Details split, below).
  const renderSection = (sec, body, idOverride) => (
    <section
      key={idOverride || sec.id}
      id={idOverride || sec.id}
      data-section-id={idOverride || sec.id}
      className="sr-detail-section"
    >
      {body}
    </section>
  );

  const fieldListDl = (sec, onlyKeys) => {
    const rows = rowsByGroup[sec.group] || [];
    const filtered = onlyKeys ? rows.filter((f) => onlyKeys.includes(f.key)) : rows;
    return (
      <dl className="br-dl">
        {filtered.map((f) => (
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
    );
  };

  // The plain detailed sections (no bespoke dashboard card) — Product,
  // Important Dates, Conditions & Covenants, Additional Information — get
  // the same DetailedSection card treatment instead of a bare numbered
  // heading over a full-width <dl>. `titleOverride`/`onlyKeys` let one field
  // group (Interest & Repayment) render as two cards with two different
  // subsets of its own rows.
  const renderFieldList = (sec, titleOverride, onlyKeys) => (
    <DetailedSection icon={NAV_ICONS[titleOverride || sec.group]} title={titleOverride || sec.group}>
      {fieldListDl(sec, onlyKeys)}
    </DetailedSection>
  );

  const borrowerSec = sectionByGroup['Borrower Details'];
  const projectSec = sectionByGroup['Project Details'];
  const financeSec = sectionByGroup['Project Cost & Finance'];
  const limitSec = sectionByGroup['Limit Terms'];
  const interestSec = sectionByGroup['Interest & Repayment'];
  const productSec = sectionByGroup.Product;
  const datesSec = sectionByGroup['Important Dates'];
  const covenantsSec = sectionByGroup['Conditions & Covenants'];
  const derivedSec = sectionByGroup['Derived Values'];
  const statusSec = sectionByGroup.Status;
  const additionalSec = sectionByGroup['Additional Information'];

  const repaymentDetailsId = `${interestSec.id}-repayment-details`;

  return (
    <div className="sr-detail-content">
      <OverviewSummaryCards sanction={sanction} />

      <div className="sr-card-grid-2 sr-card-grid-2-equal">
        {renderSection(borrowerSec, <BorrowerDetailsCard rows={borrowerDetailsRows} />)}
        {renderSection(projectSec, (
          <ProjectDetailsCard
            rows={(() => {
              const byKey = Object.fromEntries((rowsByGroup[projectSec.group] || []).map((f) => [f.key, f]));
              return [byKey.projectGroup, byKey.projectSubGroup, projectNameRow, byKey.technology].filter(Boolean);
            })()}
          />
        ))}
      </div>

      <div className="sr-card-grid-3 sr-card-grid-3-equal">
        {renderSection(financeSec, <ProjectFinanceCard rows={rowsByGroup[financeSec.group] || []} />)}
        {renderSection(limitSec, <LimitTermsCard terms={terms} limit={limit} />)}
        {renderSection(derivedSec, (
          <DetailedSection icon={NAV_ICONS[derivedSec.group]} title={derivedSec.group}>
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
          </DetailedSection>
        ))}
      </div>

      <div className="sr-card-grid-3 sr-card-grid-3-equal">
        {renderSection(interestSec, renderFieldList(interestSec, 'Interest & Repayment', INTEREST_RATE_KEYS))}
        {renderSection(interestSec, renderFieldList(interestSec, 'Repayment Details', REPAYMENT_SCHEDULE_KEYS), repaymentDetailsId)}
        {renderSection(productSec, renderFieldList(productSec))}
        {renderSection(datesSec, renderFieldList(datesSec))}
        {renderSection(statusSec, (
          <DetailedSection icon={NAV_ICONS[statusSec.group]} title={statusSec.group}>
            <dl className="br-dl">
              <Row label="Sanction Status" value={statusLabel(sanction.status)} />
              <Row label="Source" value={sourceLabel(sanction.source)} />
            </dl>
          </DetailedSection>
        ))}
        {renderSection(additionalSec, renderFieldList(additionalSec))}
      </div>

      {/* Conditions & Covenants gets its own full-width row rather than
          sitting in the compact grid above — its Cash Sweep field is
          free-text and can run long, which forced that whole grid ROW
          (every card sharing it) to match its height, leaving big blank
          gaps under Important Dates/Status. Full width lets that same text
          wrap into far fewer lines and never affects any other card's
          layout. */}
      {renderSection(covenantsSec, renderFieldList(covenantsSec))}
    </div>
  );
};

export default SanctionDetailView;
