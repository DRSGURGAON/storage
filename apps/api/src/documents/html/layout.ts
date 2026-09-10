/**
 * document-engine.md §3: "One shared A4 layout shell used by every
 * template... Shared primitives (one implementation, reused by every
 * template): page header/footer, party-detail block, line-item table,
 * totals block, signature block, QR block. A template for a specific
 * document type only supplies which sections it needs and their field
 * bindings." These functions are that shared implementation -- a
 * document type's template (e.g. quotation-document.template.ts) calls
 * them, never writes its own <table>/<style>.
 */

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export interface CompanyContext {
  legalName: string;
  tradeName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  /**
   * `entitlement-engine.md` §10 / saas-layer §46: a demo workspace's
   * paperwork must be unmistakable. A demo Tax Invoice that looks exactly
   * like a real one is the hazard -- it carries a real-looking number, a
   * real-looking GSTIN and a QR code that verifies, and nothing on its face
   * says it is a sample.
   */
  isDemo: boolean;
  /**
   * The letterhead images, already inlined as `data:` URIs.
   *
   * Data URIs rather than URLs because of what renders these: a headless
   * browser with no session, loading HTML from a string. An
   * `<img src="/attachments/...">` would be an unauthenticated request from
   * a page with no origin -- it would fail, silently, and the document
   * would print with a gap where the logo should be. `company-context.ts`
   * reads the bytes through `AttachmentsService` and hands them over
   * already encoded.
   *
   * Null is the normal case, not an error: a workspace that has not
   * uploaded a logo gets the same header without one, and one that has not
   * uploaded a signature keeps the ruled line to sign on by hand.
   */
  logoDataUri: string | null;
  signatureDataUri: string | null;
  stampDataUri: string | null;
}

/** §3's header band: "[Logo] Company legal name & GSTIN / Address · Phone · Email". */
function renderCompanyHeader(company: CompanyContext): string {
  const addressParts = [company.addressLine1, company.addressLine2, company.city, company.state, company.pincode]
    .filter(Boolean)
    .map(escapeHtml)
    .join(', ');
  const contactParts = [company.phone, company.email].filter(Boolean).map(escapeHtml).join(' · ');
  const details = `
      <div class="company-name">${escapeHtml(company.tradeName ?? company.legalName)}</div>
      ${company.gstin ? `<div class="company-gstin">GSTIN: ${escapeHtml(company.gstin)}</div>` : ''}
      ${addressParts ? `<div class="company-address">${addressParts}</div>` : ''}
      ${contactParts ? `<div class="company-contact">${contactParts}</div>` : ''}`;
  // With a logo the band becomes two columns; without one it stays exactly
  // as it was, rather than leaving an empty box where an image would go.
  return company.logoDataUri
    ? `
    <div class="company-header company-header-with-logo">
      <img class="company-logo" src="${company.logoDataUri}" alt="" />
      <div>${details}</div>
    </div>`
    : `
    <div class="company-header">${details}
    </div>`;
}

/** §3's title band: "DOCUMENT TITLE  Doc No: … / Date: …". */
function renderTitleBand(title: string, documentNumber: string, dateLabel: string, date: string): string {
  return `
    <div class="title-band">
      <div class="document-title">${escapeHtml(title)}</div>
      <div class="title-meta">
        <div>Doc No: <strong>${escapeHtml(documentNumber)}</strong></div>
        <div>${escapeHtml(dateLabel)}: <strong>${escapeHtml(date)}</strong></div>
      </div>
    </div>`;
}

/** §3's party-detail block: one bordered card per party (Customer / Consignee / …), reused for every document type that names one or more parties. */
export function renderPartyBlock(title: string, lines: (string | null | undefined)[]): string {
  const body = lines.filter(Boolean).map((line) => `<div>${escapeHtml(line)}</div>`).join('');
  return `
    <div class="party-block">
      <div class="party-title">${escapeHtml(title)}</div>
      ${body}
    </div>`;
}

/**
 * The counterparty's own signature -- the receiver on a POD, the driver on
 * a discrepancy acknowledgement. Deliberately not the shell's signature
 * block: that one is the warehouse's authorised signatory, and on a
 * delivery that came back short the difference is the whole point.
 */
export function renderReceiverSignature(images: Record<string, string | null> | undefined, label = 'Signed by the receiver'): string {
  const signature = images?.signature;
  const stamp = images?.stamp;
  if (!signature && !stamp) return '';
  return `
    <div class="receiver-signature">
      <div class="body-section-title">${escapeHtml(label)}</div>
      <div class="receiver-signature-images">
        ${signature ? `<img src="${signature}" alt="" />` : ''}
        ${stamp ? `<img class="receiver-stamp" src="${stamp}" alt="" />` : ''}
      </div>
    </div>`;
}

/** §3's line-item table: one shared implementation, column headers/rows supplied by the caller. */
export function renderLineItemTable(columns: string[], rows: (string | number)[][]): string {
  const head = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('');
  return `
    <table class="line-items">
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

/** §3's totals block, right-aligned; the last row may be emphasized (e.g. Grand Total). */
export function renderTotalsBlock(rows: { label: string; value: string; emphasize?: boolean }[]): string {
  const body = rows
    .map(
      (r) =>
        `<div class="totals-row${r.emphasize ? ' totals-row-emphasize' : ''}"><span>${escapeHtml(
          r.label,
        )}</span><span>${escapeHtml(r.value)}</span></div>`,
    )
    .join('');
  return `<div class="totals-block">${body}</div>`;
}

/** §3's signature area + QR block, always paired at the foot of the document body. */
function renderSignatureAndQr(company: CompanyContext, qrDataUri: string, qrToken: string): string {
  const signed = Boolean(company.signatureDataUri || company.stampDataUri);
  return `
    <div class="signature-qr-row">
      <div class="signature-block">
        ${
          signed
            ? `<div class="signature-images">
          ${company.signatureDataUri ? `<img class="signature-image" src="${company.signatureDataUri}" alt="" />` : ''}
          ${company.stampDataUri ? `<img class="stamp-image" src="${company.stampDataUri}" alt="" />` : ''}
        </div>`
            : ''
        }
        <div class="signature-line${signed ? ' signature-line-signed' : ''}"></div>
        <div>For ${escapeHtml(company.tradeName ?? company.legalName)}</div>
        <div class="signature-caption">Authorised Signatory</div>
      </div>
      <div class="qr-block">
        <img src="${qrDataUri}" alt="Verify" />
        <div class="qr-caption">Scan to verify · ${escapeHtml(qrToken.slice(0, 8))}…</div>
      </div>
    </div>`;
}

const SHARED_STYLE = `
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #1a1a1a; margin: 0; }
  .page { padding: 18mm 15mm; }
  .company-header { border-bottom: 2px solid #1a1a1a; padding-bottom: 8px; margin-bottom: 10px; }
  .company-name { font-size: 16px; font-weight: 700; }
  .company-gstin, .company-address, .company-contact { font-size: 10px; color: #444; }
  .title-band { display: flex; justify-content: space-between; align-items: baseline; background: #f2f2f2; padding: 8px 10px; margin-bottom: 12px; }
  .document-title { font-size: 14px; font-weight: 700; letter-spacing: 0.5px; }
  .title-meta { text-align: right; font-size: 10px; }
  .party-block { border: 1px solid #ccc; padding: 8px 10px; margin-bottom: 12px; font-size: 10.5px; }
  .party-title { font-weight: 700; margin-bottom: 4px; font-size: 10px; text-transform: uppercase; color: #555; }
  table.line-items { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  table.line-items th, table.line-items td { border: 1px solid #ccc; padding: 5px 6px; font-size: 10px; text-align: left; }
  table.line-items th { background: #f2f2f2; font-weight: 700; }
  .totals-block { width: 260px; margin-left: auto; margin-bottom: 16px; }
  .totals-row { display: flex; justify-content: space-between; padding: 3px 6px; font-size: 10.5px; }
  .totals-row-emphasize { font-weight: 700; border-top: 1px solid #1a1a1a; margin-top: 3px; font-size: 12px; }
  .body-section { margin-bottom: 12px; }
  .body-section-title { font-weight: 700; font-size: 10.5px; text-transform: uppercase; color: #555; margin-bottom: 4px; }
  .signature-qr-row { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 30px; }
  .signature-block { font-size: 10.5px; }
  .company-header-with-logo { display: flex; align-items: flex-start; gap: 12px; }
  .company-logo { max-height: 56px; max-width: 150px; object-fit: contain; }
  /* Signature then stamp, side by side and sitting on the ruled line --
     never overlapping. A scanned signature or seal is nearly always a
     photograph on white paper, so one laid over the other would simply
     erase it. The line stays either way: a scanned signature is not a
     legal substitute everywhere, and someone may still sign the print. */
  .signature-images { display: flex; align-items: flex-end; gap: 10px; margin-bottom: -2px; }
  .signature-image { max-height: 52px; max-width: 150px; }
  .stamp-image { max-height: 56px; max-width: 80px; }
  .signature-line { border-top: 1px solid #1a1a1a; width: 160px; margin-bottom: 4px; margin-top: 30px; }
  /* The images already occupy the space the blank line was leaving. */
  .signature-line-signed { margin-top: 0; }
  .signature-caption { color: #666; font-size: 9px; }
  .qr-block { text-align: center; font-size: 8.5px; color: #666; }
  .qr-block img { width: 70px; height: 70px; }
  .receiver-signature { margin-top: 12px; }
  .receiver-signature-images { border: 1px solid #ccc; padding: 6px 10px; display: flex; align-items: flex-end; gap: 16px; }
  .receiver-signature-images img { max-height: 56px; max-width: 180px; }
  .receiver-signature-images .receiver-stamp { max-height: 64px; max-width: 100px; opacity: 0.85; }
  .footer { margin-top: 20px; padding-top: 6px; border-top: 1px solid #ccc; font-size: 8.5px; color: #888; text-align: center; }
  /* Demo marking: a diagonal watermark behind the content, plus a banner
     above it. Two markings rather than one because either alone survives a
     bad photocopy or a screenshot cropped to the header. */
  .demo-watermark {
    position: fixed; top: 42%; left: 0; right: 0; text-align: center;
    font-size: 84px; font-weight: 700; color: rgba(200, 0, 0, 0.12);
    transform: rotate(-24deg); letter-spacing: 12px; z-index: 0;
  }
  .demo-banner {
    border: 1.5px solid #c00; color: #c00; background: #fff5f5;
    padding: 5px 8px; margin-bottom: 10px; text-align: center;
    font-size: 10px; font-weight: 700; letter-spacing: 1px;
  }
  .page { position: relative; }
`;

export interface DocumentShellParams {
  title: string;
  documentNumber: string;
  dateLabel: string;
  date: string;
  company: CompanyContext;
  bodyHtml: string;
  qrDataUri: string;
  qrToken: string;
}

/** §3's full A4 shell -- the one place every document type's HTML is assembled. */
export function renderDocumentShell(params: DocumentShellParams): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>${SHARED_STYLE}</style>
</head>
<body>
  <div class="page">
    ${params.company.isDemo ? '<div class="demo-watermark">DEMO</div>' : ''}
    ${params.company.isDemo ? '<div class="demo-banner">DEMO / SAMPLE — not a valid commercial document</div>' : ''}
    ${renderCompanyHeader(params.company)}
    ${renderTitleBand(params.title, params.documentNumber, params.dateLabel, params.date)}
    ${params.bodyHtml}
    ${renderSignatureAndQr(params.company, params.qrDataUri, params.qrToken)}
    <div class="footer">Generated by ${escapeHtml(params.company.tradeName ?? params.company.legalName)}'s warehouse management system · This is a system-generated document</div>
  </div>
</body>
</html>`;
}
