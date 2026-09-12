// src/components/borrowers/ProjectDetailsCard.js
//
// Card rendering of the Overview tab's "Project Details" section (03) — same
// treatment as BorrowerDetailsCard.js, for the Category/Sub Category/Project/
// Technology rows already built by buildDetailRows.
import React from 'react';
import { FileText } from 'lucide-react';
import { Row, LEFT_ALIGN_KEYS } from './SanctionOverviewPanel';

// No "View Full Details" link — every Project Details field is already
// rendered below, nothing held back.
const ProjectDetailsCard = ({ rows }) => (
  <div className="br-card">
    <div className="br-card-head">
      <FileText size={16} aria-hidden="true" className="br-dl-icon" />
      <h3 className="br-card-title">Project Details</h3>
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

export default ProjectDetailsCard;
