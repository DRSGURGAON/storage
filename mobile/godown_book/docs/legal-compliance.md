# What the law asks of each paper, and where the app does it

StorageBill Pro prints papers for a household-goods godown in India.
This page lists, for each paper, the law it lives under, the
particulars that law asks for, and what the app prints. It is a
working checklist, not legal advice: an operator's own CA or lawyer
should read the terms once before the first customer signs them.

## Storage bill / tax invoice

Law: section 31 of the CGST Act, 2017 and Rule 46 of the CGST Rules,
2017 (tax invoice); Rule 49 (bill of supply); Rule 48(2) (a service
invoice is in duplicate - original for recipient, duplicate for
supplier); time of issue within 30 days of the service.

| Rule 46 asks for | Printed |
| --- | --- |
| Supplier name, address, GSTIN | Letterhead (GSTIN and PAN from Company Profile) |
| Consecutive serial number, one series per financial year, 16 characters or fewer | `INV/2026/0001` (prefix is editable) |
| Date of issue | Invoice Date |
| Recipient name, address, GSTIN or "Unregistered" | Bill To box |
| SAC of each service | SAC column: 996729 storage, 996719 handling, 998540 packing, 996511 transport, 997139 insurance |
| Description, quantity, rate, value | Lines table |
| Taxable value after discount | Taxable Value row |
| Rate and amount of CGST/SGST or IGST | Tax rows |
| Place of supply with state code | Place of Supply row (state code from the GSTIN) |
| Whether tax is on reverse charge | Reverse Charge: No |
| Signature or digital signature | Authorised Signatory block, with the uploaded signature |
| Title | TAX INVOICE when tax is charged; BILL OF SUPPLY for a registered supplier with no tax; STORAGE BILL for an unregistered godown |

Amount in words, declaration, "E. & O. E." and the bank / UPI details are
customary rather than required, and are printed.

Not covered: e-invoicing (IRN and QR code) applies only above the
turnover threshold notified for it, which a household-goods godown is
unlikely to cross; when it does, invoices have to be registered on the
Invoice Registration Portal, which this app does not do.

## Credit note

Law: section 34 of the CGST Act; Rule 53(1A) of the CGST Rules.

Printed: its own CN series; the invoice number and date it reduces;
the taxable value and the GST credited, split out at the invoice's
rate; the reason; the customer's acknowledgement line. The credit
note is never counted as money received.

## Advance receipt voucher

Law: Rule 50 of the CGST Rules (receipt voucher on an advance for
services); tax is payable on the advance when received.

Printed: serial number and date, customer, amount, place of supply,
"Reverse Charge: No", the SAC, and a line saying it is adjusted in the
invoice that follows and is not itself a tax invoice. The GST rate on
the advance is the rate the operator charges on storage, shown on the
invoice; the voucher does not compute it because the storage period is
not yet billed.

## Payment receipt

Law: Indian Stamp Act, 1899, Schedule I, Article 53 - a receipt for
more than Rs. 5,000 bears a one-rupee revenue stamp; section 30
obliges the receiver to give such a receipt on demand.

Printed: a "Affix Re. 1 Revenue Stamp" box on every cash receipt above
Rs. 5,000. Bank, UPI, card and cheque receipts need no stamp and get
no box. The default note says a cheque receipt is subject to
realisation.

## Quotation

No statute prescribes a quotation. What a fair one needs, and what
the default terms carry: validity date; that it is not a tax invoice
and GST is extra (with the SACs) unless included; what is excluded
(toll, parking, permits, society charges, levies at actuals); payment
terms; risk and insurance; prohibited goods; loading and handling;
cancellation; claims within 7 days; jurisdiction.

## Storage receipt and storage agreement

Law: Indian Contract Act, 1872, sections 148 to 171 (bailment):
s.151 the bailee's duty of care, s.152 no liability without want of
that care, s.170 the bailee's lien for charges. A general lien across
all of a customer's goods and a right of sale after notice exist only
by contract, so the terms state both. Consumer Protection Act, 2019,
s.2(46): a term that takes away every remedy is unfair and can be set
aside, so liability is limited to the declared value, not excluded.
Contract Act s.74: interest on late payment must be a reasonable
pre-estimate; the default is 18% a year, simple, editable.
Warehousing (Development and Regulation) Act, 2007: the receipt says
it is not a negotiable warehouse receipt and not a document of title.
Aadhaar (Sharing of Information) Regulations, 2016, reg. 6: an
Aadhaar number is never printed in full - every paper shows only the
last four characters of any ID number. Digital Personal Data
Protection Act, 2023: the terms say what the ID copy is kept for and
when it is deleted.

The receipt prints a one-page condensed set of the same clauses and
says the agreement's full terms form part of it. The agreement prints
the full set. Both are editable under Customise Documents.

Stamp duty on the agreement is a state matter (an agreement not
otherwise provided for, typically Rs. 100 or less on e-stamp paper).
The app prints the agreement; the operator affixes or e-stamps it as
their state requires.

## Bilty / lorry receipt

Law: Carriage by Road Act, 2007 and Carriage by Road Rules, 2011.
s.8: the goods receipt; ss.10-11: the carrier's liability, limited to
the declared value; s.12: the consignor's declaration of dangerous
goods; s.16: a claim has to be notified within 180 days; s.17:
uncollected goods. CGST Rules, Rule 138(14) and its Annexure: used
personal and household effects need no e-way bill.

Printed: consignor and consignee, origin and destination, vehicle,
driver and licence, packages, weight, declared value, freight, risk
basis, the e-way-bill exemption, and terms that cite ss.8, 10-12, 16
and 17. A common carrier's registration number under s.3 of the Act
is not in the app's Company Profile yet; a carrier that has one should
add it to the letterhead text.

## Notices and the no-dues certificate

A reminder, final notice and notice before disposal follow the
agreement's own clauses (90 days after written notice; two notices 30
days apart before goods are treated as abandoned). The no-dues
certificate is issued only when the check in the app is clear: goods
released, nothing outstanding, no deposit held.

## Sources

- Rule 46 of the CGST Rules: https://taxguru.in/goods-and-service-tax/tax-invoice-requirements-section-31-cgst-act-gst-rule-46.html
- Rule 50 (receipt voucher) and Rule 53 (credit note): https://cleartax.in/s/cgst-rules-chapter-6-tax-invoice-credit-and-debit-notes
- SAC 996729 and its rate: https://gstverify.co.in/gst/hsn/996729/
- Revenue stamp on receipts above Rs. 5,000: https://www.simpletaxindia.net/2010/01/revenue-stamp-only-for-receipt-above-rs.html
- Carriage by Road Act, 2007: https://www.indiacode.nic.in/bitstream/123456789/2043/1/A2007-41.pdf
- Carriage by Road Rules, 2011: https://taxguru.in/corporate-law/carriage-road-rules-2011-a-gist.html
