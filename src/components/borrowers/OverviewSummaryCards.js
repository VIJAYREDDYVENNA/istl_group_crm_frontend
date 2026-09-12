// src/components/borrowers/OverviewSummaryCards.js
//
// The five KPI cards atop the read-only Overview tab (SanctionDetailView.js):
// Sanctioned Amount, Debt : Equity, Repayment Tenor, ROI, Repayment
// Frequency. Reuses the same .brx-stat card the Borrower Registry list page
// already uses for its own header stats (see Stat in Pages/BorrowerRegistry.js)
// — no new visual system, just a second instance of it fed from one
// sanction's own fields instead of registry-wide counts.
//
// Every value here is read straight off `sanction` — Debt : Equity falls
// back to a same-page presentational ratio (debt/project cost, from the
// same raw money fields the Project Cost & Finance card already shows) only
// when the letter's own stated ratio (debtEquityRatio) is blank; Repayment
// Tenor's "(X.X years)" caption is the same months/12 conversion, and
// Repayment Frequency reuses the exact same repaymentFrequencyLabel() the
// Interest & Repayment field list already formats its own row with — not a
// new calculation. Nothing here is a source of truth SanctionDerivedCalculator.java
// doesn't already own — see the header note in SanctionDetailView.js.
import React from 'react';
import {
  IndianRupee, PieChart, Calendar, Percent, RefreshCw,
} from 'lucide-react';
import { repaymentFrequencyLabel } from './SanctionOverviewPanel';

const numFrom = (v) => parseFloat(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;

const debtEquityDisplay = (sanction) => {
  if (sanction.debtEquityRatio) return sanction.debtEquityRatio;
  if (sanction.debtPct && sanction.equityPct) {
    return `${numFrom(sanction.debtPct).toFixed(0)} : ${numFrom(sanction.equityPct).toFixed(0)}`;
  }
  const debt = numFrom(sanction.debtAmount);
  const cost = numFrom(sanction.projectCost);
  if (!debt || !cost) return null;
  const debtPct = (debt / cost) * 100;
  return `${debtPct.toFixed(0)} : ${(100 - debtPct).toFixed(0)}`;
};

const tenorYearsCaption = (months) => {
  const n = parseFloat(String(months ?? '').replace(/[^0-9.]/g, ''));
  return n > 0 ? `(${(n / 12).toFixed(1)} years)` : null;
};

const Card = ({ icon: Icon, tone, label, value, sub }) => (
  <div className={`brx-stat brx-stat-${tone}`}>
    <span className="brx-stat-icon"><Icon size={15} aria-hidden="true" /></span>
    <span className="brx-stat-body">
      {sub && <span className="brx-stat-sub">{sub}</span>}
      <span className="brx-stat-value">{value || '—'}</span>
      <span className="brx-stat-label">{label}</span>
    </span>
  </div>
);

const OverviewSummaryCards = ({ sanction }) => (
  <div className="sr-kpi-row">
    <Card icon={IndianRupee} tone="blue" label="Sanctioned Amount" value={sanction.sanctionedAmount} sub="Total debt facility" />
    <Card icon={PieChart} tone="green" label="Debt : Equity" value={debtEquityDisplay(sanction)} sub="Capital structure" />
    <Card
      icon={Calendar}
      tone="purple"
      label="Repayment Tenor"
      value={sanction.derivedTotalTenorMonths}
      sub={tenorYearsCaption(sanction.derivedTotalTenorMonths)}
    />
    <Card icon={Percent} tone="amber" label="ROI" value={sanction.roiPct} sub={sanction.interestRateText || null} />
    <Card
      icon={RefreshCw}
      tone="teal"
      label="Repayment Frequency"
      value={sanction.repaymentFrequency ? repaymentFrequencyLabel(sanction) : null}
    />
  </div>
);

export default OverviewSummaryCards;
