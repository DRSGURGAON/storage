# Which documents a household-storage operator needs, and which ones StorageBill Pro still lacks

Researched September 2026, for the V1 product direction ("Simple Storage Management
& Document App for Packers & Movers").

## How to read this

Every item says whether it is a **legal requirement**, a **tax requirement** or a
**trade practice**, and what actually goes wrong without it. Legal points were
gathered from secondary sources (commentary, government FAQ pages, judgment
reports) because the primary bare-act texts could not be opened during the
research; each one that matters is marked with how confident it is. **Nothing here
is legal advice, and no wording below should reach a customer-facing document
without a lawyer reading it first.**

The app must never claim a document is "legally binding" or that a storage
receipt is a warehouse receipt in the regulatory sense.

## What StorageBill Pro prints today

Quotation · Storage Agreement · Storage Receipt · Goods List · Storage Bill ·
Payment Receipt · Customer Statement · Release Record · Letter Head · Company Card ·
**Notice Letter** · **Damage / Loss Report** · **Authority Letter** ·
**Indemnity Bond** · **Security Deposit Receipt, Refund Voucher and Adjustment
Note** · **Bilty / Lorry Receipt** · **Goods Forwarding Note** · **Delivery
Challan**.

Customer signature by link works on the Storage Receipt and on the Release
Record.

**Status of this document.** Everything marked BUILT below was built after this
analysis was written; the rest is still open. One item in the first draft was
wrong and is corrected here: condition remarks on each item were already in the
app (field, form and both PDFs) - only photos per item are missing.

## The legal frame, in one paragraph

Household storage is a **bailment for reward** under Chapter IX of the Indian
Contract Act 1872 - the customer is the bailor, the operator is the bailee. It is
not a tenancy (no exclusive possession of a defined space) and not a WDRA
warehouse (WDRA registration matters only for those who issue *negotiable*
warehouse receipts, over notified commodities - household goods are outside it).
The customer is also a "consumer" and storage is a "service" under the Consumer
Protection Act 2019, so a dispute can go to a District Consumer Commission, not
only a civil court. Section 151 sets the standard of care; section 152 excuses the
bailee who met it. Where the operator also transports goods, a second statute
applies - see "If you also move goods" below.

---

## Tier 1 - missing, and load-bearing for a pure storage operator

### 1. Security deposit receipt, and the refund / adjustment voucher - BUILT
Status: trade practice; the **GST treatment is statutory**.
The proviso to section 2(31) of the CGST Act says a deposit is not consideration
until the supplier applies it against the supply. So a refundable deposit is
outside GST when taken and becomes taxable only when adjusted against rent or
damage. An advance against rent is the opposite - taxable on receipt.
*In the app:* the deposit is captured and printed, but never settled - no refund,
no adjustment, and it is absent from the statement and the balance.
**Without it:** GST charged on money that has to be refunded, and an exit argument
with no agreed figure.

### 2. Customer signature on the Release Record - BUILT
Status: trade practice, decisive in a dispute.
The release slip should carry "goods received in good condition" over the
customer's signature, with the collector's name, ID reference and vehicle number.
*In the app:* the release record captures collector name, phone, ID proof, vehicle
and gate-out time - but no signature, and sign-by-link is wired only to the
Storage Receipt.
**Without it:** the most common dispute of all - "maal poora nahi mila" - is
undefendable, and the quiet rule of bailment is that the operator must show the
care they took.

### 3. Authority letter, and an indemnity bond - BUILT
Status: trade practice; the indemnity bond is a contract of indemnity (section 124)
and carries **state-specific stamp duty** (Article 34, Schedule I, Indian Stamp Act 1899).
Needed when somebody other than the depositor collects the goods, when the receipt
is lost, or when two family members both claim the lot. Section 166 protects an
operator who redelivers in good faith on the bailor's directions - the authority
letter is what makes "on his directions" provable. If a third party disputes
ownership, do not decide it: hold delivery and let them go to court (section 167).
**Without it:** goods handed to the wrong person, with no defence.

### 4. Notice letters: rent reminder, final notice, notice of intended disposal - BUILT
Status: trade practice, but they are the precondition for every remedy.
Research finding that matters most: **a lien is a right to retain, never a right to
sell.** The particular lien (section 170) needs "labour or skill in respect of the
goods", which pure storage arguably is not; the general lien (section 171) lists
bankers, factors, wharfingers, attorneys and policy-brokers and then says no other
person has it *unless there is an express contract*. So the operator's power to
dispose of abandoned goods lives entirely in the **storage agreement**, and the
notice has to say plainly that the goods will be sold - by analogy with section
176, courts look for "a positive assertion disclosing the intention to sell", a
sale to a third party (not to yourself), and the surplus returned to the customer.
Serve by registered post AD to the address in the agreement (section 27, General
Clauses Act 1897 gives a presumption of service), and keep the receipt.
*In the app:* no notice document at all. The blank Letter Head is the base to
build on; the arrears figure already exists in the statement.
**Without it:** abandoned goods occupy paid space forever, and any self-help
disposal turns a small debt into a conversion claim - possibly a criminal breach
of trust complaint under section 316 BNS.
*Opinion, flagged:* against a household consumer, a clause letting the operator
sell a family's belongings is a plausible target for an "unfair contract term"
finding under section 2(46) of the Consumer Protection Act 2019. For a high-value
lot, the court route is safer than self-help.

### 5. Damage / loss incident report - BUILT
Status: trade practice; the gateway to every insurance claim.
Same day, dated, with photographs, the lot and box numbers, staff statements,
cause if known, and the FIR or fire-brigade reference for theft or fire.
*In the app:* photos exist on the storage entry, but there is no incident record.
**Without it:** the insurer repudiates for late or unsupported notification, and in
court the operator cannot show the care they took.

### 6. Condition remarks on the intake item list, and photos per item
Status: trade practice; usually the decisive evidence.
Every line needs a condition column - "scratch on left panel", "glass top hairline
crack" - and a photo tied to that lot, signed off by the customer at intake.
*In the app:* items carry name, quantity and unit only; photos attach to the whole
entry, not to an item.
**Without it:** phantom-item claims cannot be resisted, and old damage becomes new
damage.

### 7. Declared value declaration, signed by the customer
Status: trade practice for storage; **statutory for the transport leg** (below).
*In the app:* declared value and an insurance note are captured, but the customer
never signs a declaration.
**Without it:** liability is argued from whatever figure the customer asserts after
the loss. A declared-value cap, offered with a higher-cover option, is far more
defensible than a blanket "goods at owner's risk" line - Indian commentary and at
least one High Court have pushed back on disclaimers that dilute the section 151
duty of care, and consumer fora routinely ignore one-sided small print.

### 8. "NON-NEGOTIABLE" legend on the Storage Receipt - BUILT
Status: one line of text, real protection.
The receipt should say "NON-NEGOTIABLE - NOT A DOCUMENT OF TITLE - NOT TRANSFERABLE
BY ENDORSEMENT", so it can never be presented as a WDRA negotiable warehouse receipt.
*In the app:* the intent is only a code comment; the PDF says nothing.

### 9. Clauses missing from the default Storage Agreement terms - BUILT
Present today: acceptance on declared count, rent in advance, release against the
receipt, owner's-risk, excluded goods, disposal after 90 days' written notice,
jurisdiction.
Missing, and each is cheap to add: **express general lien and express power of
sale** with how proceeds are applied and surplus returned; **declared-value cap**;
**notice address, email and mobile with a deemed-service clause**; a **no-tenancy /
leave-and-licence clause** (no exclusive possession, no interest in immovable
property); an **abandonment definition**; and **who insures what**, said plainly.

---

## Tier 2 - needed the moment the operator also moves goods (most do)

### 10. Lorry Receipt / bilty (consignment note) and Goods Forwarding Note - BUILT
Status: **legal requirement**, and the single biggest gap against competitors.
The Carriage by Road Act 2007 makes the **Goods Forwarding Note** (section 8, executed
by the consignor, including a declaration of value and of dangerous goods) and the
**Goods Receipt** (section 9, issued by the carrier) mandatory for a common carrier -
and "common carrier" is defined widely enough to cover a packers-and-movers firm
that collects, stores, forwards or distributes goods. Rule 12 of the Carriage by
Road Rules 2011 caps liability for total loss at **ten times the freight, but not
above the value declared in the forwarding note** - which is why the declaration is
the customer's real protection. Section 16 also requires written notice within
**180 days of booking** before any suit, so a dated LR is what starts the clock.
Under GST the consignment note is definitional rather than mandatory: issuing one
is what makes a transporter a Goods Transport Agency.
Every Indian bilty app ships this (Packers Bill, QuickBilty, Bill Bilty, OnlineLR,
Packers Billing). StorageBill Pro has nothing.
Confidence: high on the sections; the GST rate on a bundled relocation service
(5% / 18% / exempt for an unregistered customer) is genuinely contested - leave
the rate as the operator's own setting, do not hard-code advice.

### 11. Delivery challan (Rule 55, CGST Rules) - BUILT
Status: **legal where applicable**. Used when goods move without a tax invoice -
including the operator's own leg into or between godowns under one GSTIN. A move
to a branch in another state under a different GSTIN is a supply and needs a tax
invoice instead.
**Without it:** the truck is detained under section 129 with a customer's goods in it.

### 12. Pre-move survey sheet
Status: trade practice. Room-wise items, approximate volume (CFT), fragile and
high-value flags, and the access conditions that decide the price - lift, parking
distance, staircase floors, society entry rules. Shipped by three of the Indian
competitor apps as "Survey List".
**Without it:** the price is revised upward on loading day with no baseline.

### 13. Proof of delivery, with a damage endorsement - BUILT (on the bilty)
The bilty carries a delivery block: delivered on, received by, and room to note
a shortage or damage. A separate unpacking acknowledgement is still open.
Status: trade practice, with a sharp consequence - under the Carriage by Road Rules
delivery is treated as prima facie evidence that the goods were delivered as
described in the forwarding note, so a clean signature works *against* the customer.
The form must have room to write shortages and damage on the carrier's own copy.

### 14. Vehicle condition report (car or two-wheeler)
Status: trade practice; a proven differentiator (QuickBilty ships it).
Odometer, fuel level, photographs from four sides, existing dents.
Useful note for the app's help text: moving a **used personal vehicle needs no
e-way bill** - see below - and RTO Forms 28/29/30 are for re-registration and
ownership transfer, **not** for transporting your own car. Several movers' websites
get this wrong.

---

## Tier 3 - money and tax completeness

### 15. Credit note
Status: **legal when used** (section 34, CGST Act), and it must be declared in the
GST return by 30 November following the financial year of the original supply.
*In the app:* a bill can be edited and silently restated. For a registered operator
who has already given the customer the bill, that is the wrong instrument.

### 16. Advance receipt voucher
Status: **statutory for a registered supplier** (section 31(3)(d)) on receipt of an
advance for services - distinct from the payment receipt against a bill.

### 17. Plain bill vs tax invoice for a small operator
Below the ₹20 lakh services threshold (₹10 lakh in special-category states) an
operator must **not** charge GST. The app must never force tax-invoice wording or a
GSTIN field on an unregistered operator. (Current behaviour is close to right - the
document is titled "Storage Bill" and GST lines appear only when a rate is set -
worth an explicit test.)

### 18. No-dues / closure certificate at move-out
Status: trade practice. Closes the lot, confirms the deposit is settled and stops
the meter. Pairs with item 1.

### 19. The two reports the trade actually runs on
**Rent roll** - who is in storage, from when, paid up to when, balance owed - and
**aged outstanding**. The per-customer statement exists; the "kaun kitna baaki hai"
list does not.

---

## What is NOT needed - worth saying out loud in the app

- **E-way bill for used household effects: not required.** "Used personal and
  household effects" appear at S. No. 7 of the Annexure to Rule 138(14) of the
  CGST Rules 2017. The Kerala High Court has applied the same entry to a used
  personal car. Some movers charge customers for an e-way bill they do not need;
  an operator who can say this with confidence looks like the professional in the
  room. (Confidence: high on the entry; state SGST mirrors were not all checked.)
- **WDRA registration:** only for warehouses issuing negotiable warehouse receipts
  over notified commodities. Not a household godown. But check your **state's own
  Warehouses Act** for a licensing duty - they are aimed at agricultural and
  notified goods, which was not verified line by line.
- **No KYC statute** applies to a storage operator (PMLA reaches reporting entities,
  not godowns). Collecting ID stays a sensible trade practice - and the app already
  captures it.
- GRN / put-away / pick list / stock ledger / ASN / TMS - out of V1 by design, and
  the research gives no reason to revisit that.

---

## Order of work

Done: Release Record signature · security deposit settlement · non-negotiable
legend · the missing agreement clauses · notice letters · damage / loss report ·
authority letter and indemnity bond · the bilty pack (Lorry Receipt, Goods
Forwarding Note, Delivery Challan, with delivery recorded on the bilty itself).

Still open, in the order they are worth doing:

1. Photos attached per item on the intake list.
2. Credit note, advance receipt voucher, no-dues certificate.
3. Pre-move survey sheet, unpacking acknowledgement, vehicle condition report.
4. Rent roll and aged-outstanding reports.

Items 1-7 keep the app inside the V1 promise - "enter once, use everywhere", no
ERP screens - because every one of them is a new print of data the app already
holds. Item 8 is a new module and should be sold as one.

## Sources and confidence

Legal points come from commentary and government FAQ pages read through search
rather than opened directly: the Carriage by Road Act 2007 and Rules 2011, the
Indian Contract Act 1872 (ss. 148-181), CGST Act ss. 2(31), 31, 34 and Rules 46,
55, 138, Notification 12/2017-CT(R), the Consumer Protection Act 2019 and the
Warehousing (Development and Regulation) Act 2007. Verify the exact wording on
indiacode.nic.in and cbic-gst.gov.in before any of it is printed on a customer's
document. Specifically unsettled, and marked as such above: whether a pure storer
has a section 170 lien at all; whether an "owner's risk" clause survives against a
consumer; and the GST rate on a bundled relocation service.
