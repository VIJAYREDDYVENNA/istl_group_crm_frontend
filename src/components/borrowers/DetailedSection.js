// src/components/borrowers/DetailedSection.js
//
// A detailed-information section (Product, Important Dates, Conditions &
// Covenants, Derived Values, Status, Additional Information, and the full
// field list under Interest & Repayment's summary cards) rendered as the
// same .br-card language the dashboard cards above it already use — icon +
// title header, card body underneath — instead of a bare numbered heading
// over a full-width <dl>. The section number stays in the sidebar nav (it's
// a navigation label there) but isn't repeated in the card's own header.
// Purely presentational: callers still pass in whatever <dl>/rows they
// already built from buildDetailRows/DERIVED_ROWS.
import React from 'react';

const DetailedSection = ({ icon: Icon, title, children }) => (
  <div className="br-card">
    <div className="br-card-head">
      <span className="sr-detail-card-icon"><Icon size={16} aria-hidden="true" /></span>
      <h3 className="br-card-title">{title}</h3>
    </div>
    {children}
  </div>
);

export default DetailedSection;
