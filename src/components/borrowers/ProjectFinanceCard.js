// src/components/borrowers/ProjectFinanceCard.js
//
// Card rendering of the Overview tab's "Project Cost & Finance" section (04)
// — same rows buildDetailRows already produces (Project Cost, Debt/Equity
// amounts and %, Sanctioned Amount, Debt : equity), laid out two-up via CSS
// columns (.sr-dl-2col) to match the denser card in the target design,
// without reordering or recomputing any of the underlying figures.
import React from 'react';
import { Landmark } from 'lucide-react';
import { Row, LEFT_ALIGN_KEYS } from './SanctionOverviewPanel';

const ProjectFinanceCard = ({ rows }) => (
  <div className="br-card">
    <div className="br-card-head">
      <Landmark size={16} aria-hidden="true" className="br-dl-icon" />
      <h3 className="br-card-title">Project Cost &amp; Finance</h3>
    </div>
    <dl className="br-dl sr-dl-2col">
      {rows.map((f) => (
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
  </div>
);

export default ProjectFinanceCard;
