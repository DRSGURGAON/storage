import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { AuthService } from '../auth/auth.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from './db.module';
import { withTenant } from './tenant-context';
import type postgres from 'postgres';
import { CustomersService } from '../customers/customers.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import { LocationsService } from '../warehouses/locations.service';
import { ProductsService } from '../products/products.service';
import { GrnsService } from '../grns/grns.service';
import { PutawaysService } from '../putaways/putaways.service';
import { ReleaseOrdersService } from '../release-orders/release-orders.service';
import { PickListsService } from '../pick-lists/pick-lists.service';
import { DispatchesService } from '../outbound/dispatches.service';
import { GatePassesService } from '../outbound/gate-passes.service';
import { RateCardsService } from '../billing/rate-cards.service';
import { RateCardLinesService } from '../billing/rate-card-lines.service';
import { ChargeTypesService } from '../billing/charge-types.service';
import { BillingRunsService } from '../invoicing/billing-runs.service';
import { InvoicesService } from '../invoicing/invoices.service';

/**
 * Blueprint §45's demo workspace: a tenant flagged `is_demo` carrying a
 * *worked example* rather than an empty shell, so a prospect clicking
 * "See a demo" lands on a warehouse that has actually received, shelved,
 * shipped and billed something.
 *
 * It is built by **calling the real services**, in order, exactly as a
 * user would drive the API -- not by inserting rows. That is the whole
 * point: a demo assembled from hand-written INSERTs would drift from the
 * product the moment a status machine or a posting rule changed, and
 * would happily contain states the application itself refuses to
 * produce. Here, if the demo can be seeded, the flow works.
 *
 * Idempotent by tenant slug: re-running finds the existing demo and stops
 * rather than building a second one.
 */
const DEMO_SLUG = process.env.DEMO_TENANT_SLUG ?? 'demo-warehouse';
const DEMO_EMAIL = process.env.DEMO_TENANT_EMAIL ?? 'demo@warehouse.local';
const DEMO_PASSWORD = process.env.DEMO_TENANT_PASSWORD ?? 'demo-warehouse-2026';

async function main() {
  const logger = new Logger('seed-demo');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const sql = app.get<postgres.Sql>(PG_CONNECTION);

  const [existing] = await sql<{ id: string; slug: string; is_demo: boolean }[]>`
    select id, slug, is_demo from tenants where slug = ${DEMO_SLUG}
  `;
  if (existing?.is_demo) {
    logger.log(`Demo workspace '${DEMO_SLUG}' already exists (${existing.id}) -- nothing to do.`);
    await app.close();
    return;
  }
  if (existing) {
    // `is_demo` is set at the *end* of a successful build, so a workspace on
    // this slug without it is the wreckage of a run that died partway. Saying
    // "nothing to do" here would leave a permanently broken demo that every
    // future run politely skipped -- which is exactly what the first version
    // of this script did.
    await app.close();
    throw new Error(
      `A workspace already occupies slug '${DEMO_SLUG}' but is not a completed demo (${existing.id}). ` +
        'A previous seeding run failed partway. Remove that workspace, or set DEMO_TENANT_SLUG to a fresh slug, and retry.',
    );
  }

  // `users` is global identity, not tenant-scoped, so an address left behind
  // by a removed workspace still blocks signup. Say so plainly rather than
  // surfacing a bare 409 from three layers down.
  const [orphan] = await sql<{ id: string }[]>`
    select u.id from users u where u.email = ${DEMO_EMAIL}
      and not exists (select 1 from tenant_users tu where tu.user_id = u.id)
  `;
  if (orphan) {
    await app.close();
    throw new Error(
      `The address ${DEMO_EMAIL} already has a platform account with no workspace (${orphan.id}), left by an earlier run. ` +
        'Remove that user, or set DEMO_TENANT_EMAIL to a different address, and retry.',
    );
  }

  const auth = app.get(AuthService);
  const signup = await auth.signup({
    companyLegalName: 'Demo Warehousing Pvt Ltd',
    tenantSlug: DEMO_SLUG,
    email: DEMO_EMAIL,
    fullName: 'Demo Owner',
    password: DEMO_PASSWORD,
  });
  const claims = JSON.parse(Buffer.from(signup.accessToken.split('.')[1], 'base64url').toString());
  const actor: AuthenticatedUser = {
    userId: claims.sub, tenantId: claims.tenantId, tenantUserId: claims.tenantUserId, roleCode: claims.roleCode, customerId: null,
  };

  // The company's own GST identity, needed before anything can be invoiced.
  await sql`update tenants set state_code = '06', gstin = '06AABCU9603R1ZM', city = 'Gurugram', state = 'Haryana' where id = ${actor.tenantId}`;

  const customers = app.get(CustomersService);
  const acme = await customers.create(actor, { name: 'Acme Consumer Goods', legalName: 'Acme Consumer Goods Pvt Ltd', placeOfSupply: '06', creditDays: 15 } as never);
  const bolt = await customers.create(actor, { name: 'Bolt Retail', legalName: 'Bolt Retail Ltd', placeOfSupply: '27', creditDays: 30 } as never);

  const warehouses = app.get(WarehousesService);
  const locations = app.get(LocationsService);
  const warehouse = await warehouses.create(actor, { code: 'WH01', name: 'Gurugram Central' } as never);
  const zone = await locations.create(actor, warehouse.id, { level: 'zone', segment: 'A' } as never);
  const rack = await locations.create(actor, warehouse.id, { level: 'rack', segment: 'R01', parentId: zone.id } as never);
  const binA = await locations.create(actor, warehouse.id, { level: 'bin', segment: 'B01', parentId: rack.id } as never);
  const binB = await locations.create(actor, warehouse.id, { level: 'bin', segment: 'B02', parentId: rack.id } as never);

  const products = app.get(ProductsService);
  const rice = await products.create(actor, { sku: 'RICE-25', name: 'Basmati Rice 25kg', uomCode: 'BAG', weightKg: 25 } as never);
  const oil = await products.create(actor, { sku: 'OIL-15L', name: 'Sunflower Oil 15L', uomCode: 'BOX', weightKg: 14 } as never);

  const chargeTypes = await app.get(ChargeTypesService).list(actor.tenantId);
  const rateCards = app.get(RateCardsService);
  const rateCardLines = app.get(RateCardLinesService);
  const card = await rateCards.create(actor, { code: 'STD', name: 'Standard Warehousing', scope: 'company', validFrom: isoDaysAgo(365), status: 'active' } as never);
  const byCode = (code: string) => (chargeTypes as { id: string; code: string }[]).find((c) => c.code === code)!.id;
  await rateCardLines.create(actor, card.id, { chargeTypeId: byCode('STORAGE'), basis: 'unit_day', rate: 2.5, freeDays: 2, sacCode: '996729' } as never);
  await rateCardLines.create(actor, card.id, { chargeTypeId: byCode('INWARD_HANDLING'), basis: 'per_unit', rate: 1.5, sacCode: '996719' } as never);
  await rateCardLines.create(actor, card.id, { chargeTypeId: byCode('OUTWARD_HANDLING'), basis: 'per_unit', rate: 2, sacCode: '996719' } as never);

  const grns = app.get(GrnsService);
  const putaways = app.get(PutawaysService);
  const receive = async (customerId: string, productId: string, quantity: number, locationId: string) => {
    const grn = await grns.create(actor, { warehouseId: warehouse.id, customerId, items: [{ productId, expectedQty: quantity, receivedQty: quantity, acceptedQty: quantity }] } as never);
    await grns.submit(actor, grn.id);
    await grns.check(actor, grn.id);
    await grns.approve(actor, grn.id);
    const putaway = await putaways.create(actor, { grnId: grn.id, lines: [{ grnItemId: grn.items![0].id, quantity, toLocationId: locationId }] } as never);
    await putaways.complete(actor, putaway.id);
    return grn;
  };
  await receive(acme.id, rice.id, 400, binA.id);
  await receive(acme.id, oil.id, 150, binB.id);
  await receive(bolt.id, rice.id, 200, binA.id);

  // Ten days of history, so the demo's storage accrual has something to accrue
  // over. Through `withTenant`, not the bare connection: these three tables are
  // under FORCE ROW LEVEL SECURITY, and a tenant-less update matches zero rows
  // and reports success -- which is how the first version of this script
  // produced a demo with an empty billing run (`DECISIONS.md` §44).
  await withTenant(sql, actor.tenantId, async (tx) => {
    await tx`update stock_ledger set txn_at = txn_at - interval '10 days' where tenant_id = ${actor.tenantId}`;
    await tx`update grns set approved_at = approved_at - interval '10 days', grn_date = grn_date - interval '10 days' where tenant_id = ${actor.tenantId}`;
    await tx`update putaways set completed_at = completed_at - interval '10 days' where tenant_id = ${actor.tenantId}`;
  });

  const releaseOrders = app.get(ReleaseOrdersService);
  const pickLists = app.get(PickListsService);
  const dispatches = app.get(DispatchesService);
  const gatePasses = app.get(GatePassesService);
  const ship = async (customerId: string, productId: string, quantity: number) => {
    const order = await releaseOrders.create(actor, { customerId, warehouseId: warehouse.id, lines: [{ productId, requestedQty: quantity }] } as never);
    await releaseOrders.approve(actor, order.id);
    await releaseOrders.reserve(actor, order.id, {});
    const pick = await pickLists.create(actor, { releaseOrderId: order.id } as never);
    await pickLists.confirm(actor, pick.id, { lines: pick.lines!.map((l) => ({ lineId: l.id, pickQty: l.requiredQty })) } as never);
    await pickLists.complete(actor, pick.id);
    const dispatch = await dispatches.create(actor, { releaseOrderId: order.id } as never);
    const pass = await gatePasses.create(actor, { dispatchId: dispatch.id } as never);
    await gatePasses.gateOut(actor, pass.id);
    return dispatch;
  };
  await ship(acme.id, rice.id, 120);
  await ship(bolt.id, rice.id, 60);
  // One release order left mid-flight, so the demo dashboard has something pending.
  const openOrder = await releaseOrders.create(actor, { customerId: acme.id, warehouseId: warehouse.id, lines: [{ productId: oil.id, requestedQty: 40 }] } as never);
  await releaseOrders.approve(actor, openOrder.id);
  await releaseOrders.reserve(actor, openOrder.id, {});

  const runs = app.get(BillingRunsService);
  const invoices = app.get(InvoicesService);
  const run = await runs.generate(actor, { customerId: acme.id, periodStart: isoDaysAgo(10), periodEnd: isoDaysAgo(1) } as never);
  if (!run.hasErrors) {
    const invoice = await invoices.createFromRun(actor, { billingRunId: run.id } as never);
    await invoices.submit(actor, invoice.id);
    await invoices.approve(actor, invoice.id);
    await invoices.issue(actor, invoice.id);
    logger.log(`Demo invoice ${invoice.number} issued for ${invoice.grandTotal}`);
  } else {
    logger.warn(`Demo billing run has rate errors, invoice skipped: ${run.calculation.errors.join('; ')}`);
  }

  // Last: the flag is what says "this one is complete and safe to skip next time".
  await sql`update tenants set is_demo = true where id = ${actor.tenantId}`;
  logger.log(`Demo workspace ready: slug '${DEMO_SLUG}', login ${DEMO_EMAIL}`);
  await app.close();
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
