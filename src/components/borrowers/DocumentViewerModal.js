// src/components/borrowers/DocumentViewerModal.js
//
// Reads the stored sanction letter inside the page. Two render paths, because
// browsers can display a PDF and cannot display a .docx:
//
//   PDF  → blob URL in an iframe, the browser's own viewer
//   DOCX → HTML converted server-side by SanctionDocHtmlRenderer
//
// The HTML is produced from the document by POI with every character escaped
// before it becomes markup, so dangerouslySetInnerHTML here is rendering a
// server-sanitised fragment, not raw upload content.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X, Download, FileText, Loader2, AlertTriangle, ExternalLink } from 'lucide-react';
import borrowerApi from '../../services/borrowerApi';
import '../../pages-css/BorrowerRegistry.css';

// A4 portrait ratio (297mm : 210mm) — the converted letter has no real page
// breaks (Word's own pagination isn't in the data POI gives us), so this
// splits it into same-sized sheets itself, the same illusion a print-preview
// gives. Splitting happens on real element boundaries (each top-level
// paragraph/heading/table SanctionDocHtmlRenderer emits), never mid-element
// and never by visually clipping a shared copy — every page gets its own
// disjoint slice of the actual nodes, so content can't repeat or go missing
// at a page break.
const PAGE_ASPECT = 297 / 210;

const DocxPages = ({ html, degraded }) => {
  const hostRef = useRef(null);
  // null = still on the single unsplit render (also the permanent state when
  // the letter fits on one page — nothing wrong, nothing left to do).
  const [pages, setPages] = useState(null);

  useLayoutEffect(() => {
    setPages(null);
    const host = hostRef.current;
    if (!host) return;

    const pageWidth = host.getBoundingClientRect().width;
    const padV = parseFloat(getComputedStyle(host).paddingTop) || 0;
    const windowHeight = Math.round(pageWidth * PAGE_ASPECT) - padV * 2;

    const children = Array.from(host.children);
    if (children.length <= 1) return;

    const buckets = [];
    let current = [];
    let currentHeight = 0;
    children.forEach((child) => {
      const h = child.getBoundingClientRect().height;
      if (current.length && currentHeight + h > windowHeight) {
        buckets.push(current);
        current = [];
        currentHeight = 0;
      }
      current.push(child);
      currentHeight += h;
    });
    if (current.length) buckets.push(current);

    if (buckets.length > 1) {
      setPages(buckets.map((bucket) => bucket.map((el) => el.outerHTML).join('')));
    }
  }, [html]);

  const degradedBanner = degraded && (
    <div className="br-viewer-degraded">
      <AlertTriangle size={14} aria-hidden="true" />
      <span>
        This letter couldn't be rendered with its original formatting, so it's
        shown as plain text. Download it to see the formatted version.
      </span>
    </div>
  );

  if (!pages) {
    return (
      <div className="br-doc-pages">
        {degradedBanner}
        <div className="br-doc-page">
          <div className="br-doc-page-inner docx-body" ref={hostRef} dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    );
  }

  return (
    <div className="br-doc-pages">
      {degradedBanner}
      {pages.map((pageHtml, i) => (
        <div key={i} className="br-doc-page">
          <div className="br-doc-page-inner docx-body" dangerouslySetInnerHTML={{ __html: pageHtml }} />
          <div className="br-doc-page-number">Page {i + 1} of {pages.length}</div>
        </div>
      ))}
    </div>
  );
};

const DocumentViewerModal = ({ sanctionId, fileName, onClose }) => {
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;

    (async () => {
      try {
        const meta = await borrowerApi.previewDoc(sanctionId);
        if (cancelled) return;

        if (meta.kind === 'PDF') {
          objectUrl = await borrowerApi.docBlobUrl(sanctionId);
          if (cancelled) return;
          setState({ status: 'pdf', url: objectUrl, meta });
        } else {
          setState({ status: 'html', html: meta.html || '', meta });
        }
      } catch (e) {
        if (!cancelled) {
          setState({ status: 'error', message: e.message || 'Could not open the document' });
        }
      }
    })();

    return () => {
      cancelled = true;
      // Blob URLs leak until revoked; the browser won't do it on unmount.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [sanctionId]);

  // Escape closes, matching the other modals in the module.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const displayName = state.meta?.fileName || fileName || 'Sanction letter';

  return (
    <div className="br-modal-backdrop br-modal-backdrop-viewer" onMouseDown={onClose}>
      <div
        className="br-modal br-modal-viewer"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Viewing ${displayName}`}
      >
        <div className="br-modal-head">
          <div className="br-viewer-title">
            <FileText size={18} className="br-viewer-icon" aria-hidden="true" />
            <div className="br-viewer-title-text">
              <h3 className="br-modal-title">{displayName}</h3>
              {state.meta?.size ? (
                <p className="br-modal-sub">{Math.round(state.meta.size / 1024)} KB</p>
              ) : null}
            </div>
          </div>
          <div className="br-viewer-actions">
            {/* Only meaningful for the PDF path — it's a real blob URL a new
                tab can navigate to. The DOCX path has no such URL (it's
                sanitised HTML rendered inline server-side), same as the
                Purchase Orders preview this mirrors, which only ever
                handles PDFs to begin with. */}
            {state.status === 'pdf' && (
              <button
                type="button"
                className="br-btn br-btn-sm"
                onClick={() => window.open(state.url, '_blank')}
              >
                <ExternalLink size={14} aria-hidden="true" />
                <span>Open in Tab</span>
              </button>
            )}
            <button
              type="button"
              className="br-btn br-btn-sm"
              onClick={() => borrowerApi.downloadDocFile(sanctionId, displayName)}
            >
              <Download size={14} aria-hidden="true" />
              <span>Download</span>
            </button>
            <button type="button" className="br-icon-btn" onClick={onClose} aria-label="Close">
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="br-viewer-body">
          {state.status === 'loading' && (
            <div className="br-viewer-centered">
              <Loader2 size={20} className="br-spin" aria-hidden="true" />
              <span>Opening the document…</span>
            </div>
          )}

          {state.status === 'error' && (
            <div className="br-viewer-centered">
              <span className="br-tone-warn">{state.message}</span>
              <button
                type="button"
                className="br-btn br-btn-sm"
                onClick={() => borrowerApi.downloadDocFile(sanctionId, displayName)}
              >
                <Download size={14} aria-hidden="true" />
                Download instead
              </button>
            </div>
          )}

          {state.status === 'pdf' && (
            <iframe className="br-viewer-frame" src={state.url} title={displayName} />
          )}

          {state.status === 'html' && (
            <div className="br-viewer-doc">
              {/* Server-escaped fragment from SanctionDocHtmlRenderer, sliced
                  into page-sized sheets — see DocxPages above. */}
              <DocxPages html={state.html} degraded={!!state.meta?.degraded} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DocumentViewerModal;