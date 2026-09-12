// src/components/borrowers/LimitTermsCard.js
//
// Card rendering of the Overview tab's "Limit Terms" section (06) — a pure
// extraction of the read-only Sanction Terms table SanctionDetailView.js
// used to render inline, now wrapped in a .br-card so it sits beside
// Project Cost & Finance in the two-column card grid. No change to the
// %-of-limit math or the Fund/Non Fund Based label logic.
import React from 'react';
import { ClipboardList } from 'lucide-react';
import { getSanctionLimitLabel } from './sanctionFields';

const numFrom = (v) => parseFloat(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;

// No "View All Terms" link — the table below already renders every term
// (terms.map, no row limit/pagination), nothing held back.
const LimitTermsCard = ({ terms, limit }) => (
  <div className="br-card">
    <div className="br-card-head">
      <ClipboardList size={16} aria-hidden="true" className="br-dl-icon" />
      <h3 className="br-card-title">Limit Terms</h3>
    </div>
    {terms.length > 0 ? (
      <div className="br-table-wrap">
        <table className="br-table-list sr-terms-table-readonly">
          <thead>
            <tr>
              <th className="br-center">Limit</th>
              <th className="br-right">Amount Rs. Cr's</th>
              <th>Instrument</th>
              <th className="br-right">% of Limit</th>
              <th className="br-center">Tentative Disb. Date</th>
              <th className="br-center">Actual Disb. Date</th>
            </tr>
          </thead>
          <tbody>
            {terms.map((t, i) => {
              const pct = limit > 0 ? (numFrom(t.termLimit) / limit) * 100 : 0;
              const limitName = t.limitLabel || getSanctionLimitLabel(i);
              return (
                <tr key={i}>
                  <td className="br-center">{limitName}</td>
                  <td className="br-right">{t.termLimit || '—'}</td>
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
      <p className="br-muted">No Limit Terms recorded.</p>
    )}
  </div>
);

export default LimitTermsCard;
