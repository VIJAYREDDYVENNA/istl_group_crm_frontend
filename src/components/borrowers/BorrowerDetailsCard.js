// src/components/borrowers/BorrowerDetailsCard.js
//
// Card rendering of the Overview tab's "Borrower Details" section (02) —
// same `rows`/`Row` data SanctionDetailView.js already builds via
// buildDetailRows, just wrapped in the .br-card shell instead of a bare
// <dl> so it sits in the new two-column card grid alongside Project Details.
import React from 'react';
import { User } from 'lucide-react';
import { Row, LEFT_ALIGN_KEYS } from './SanctionOverviewPanel';

// `source` ("Imported, edited" etc.) used to show as a chip here — it's
// already shown as its own "Source" row in the Status section (11), so
// dropping it from this header isn't losing it, just de-duplicating it.
// No "View Full Details" link either — every Borrower Details field
// (sanctionFields.js's own group) is already rendered below, nothing is
// held back for a fuller view to reveal.
const BorrowerDetailsCard = ({ rows }) => (
  <div className="br-card">
    <div className="br-card-head">
      <User size={16} aria-hidden="true" className="br-dl-icon" />
      <h3 className="br-card-title">Borrower Details</h3>
    </div>
    <dl className="br-dl">
      {rows.map((f) => (
        <Row
          key={f.key}
          label={f.label}
          value={f.value}
          mono={f.mono}
          align={LEFT_ALIGN_KEYS.has(f.key) ? 'left' : ''}
          caption={f.hint}
        />
      ))}
    </dl>
  </div>
);

export default BorrowerDetailsCard;
