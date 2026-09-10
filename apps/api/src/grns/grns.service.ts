import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { assertWarehouseInScope, loadWarehouseScope } from '../auth/warehouse-scope';
import { withTenant } from '../db/tenant-context';
import { NumberingService } from '../numbering/numbering.service';
import { StockMovement, StockService } from '../stock/stock.service';
import { CreateGrnItemDto } from './dto/create-grn-item.dto';
import { CreateGrnDto } from './dto/create-grn.dto';
import { ListGrnsQuery } from './dto/list-grns.query';
import { UpdateGrnDto } from './dto/update-grn.dto';

interface GrnRow {
  id: string;
  number: string;
  grn_date: string;
  warehouse_id: string;
  customer_id: string;
  supplier_id: string | null;
  supplier_name: string | null;
  inward_id: string | null;
  gate_entry_id: string | null;
  vehicle_id: string | null;
  vehicle_number: string | null;
  driver_id: string | null;
  driver_name: string | null;
  driver_mobile: string | null;
  transporter_id: string | null;
  transporter_name: string | null;
  lr_number: string | null;
  lr_date: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  eway_bill_number: string | null;
  po_number: string | null;
  remarks: string | null;
  status: string;
  submitted_at: string | null;
  checked_at: string | null;
  approved_at: string | null;
  stock_posted_at: string | null;
  has_discrepancy: boolean;
  created_at: string;
  updated_at: string;
}

interface GrnItemRow {
  id: string;
  line_no: number;
  inward_item_id: string | null;
  product_id: string;
  product_snapshot: Record<string, unknown>;
  batch_id: string | null;
  batch_no: string | null;
  mfg_date: string | null;
  expiry_date: string | null;
  expected_qty: string;
  received_qty: string;
  accepted_qty: string;
  rejected_qty: string;
  damaged_qty: string;
  short_qty: string;
  excess_qty: string;
  packages: number | null;
  package_type: string | null;
  gross_weight_kg: string | null;
  condition: string | null;
  remarks: string | null;
}

const SELECT_COLUMNS = `
  id, number, grn_date, warehouse_id, customer_id, supplier_id, supplier_name, inward_id, gate_entry_id,
  vehicle_id, vehicle_number, driver_id, driver_name, driver_mobile, transporter_id, transporter_name,
  lr_number, lr_date, invoice_number, invoice_date, eway_bill_number, po_number, remarks, status,
  submitted_at, checked_at, approved_at, stock_posted_at, has_discrepancy, created_at, updated_at`;

const ITEM_SELECT_COLUMNS = `
  id, line_no, inward_item_id, product_id, product_snapshot, batch_id, batch_no, mfg_date, expiry_date,
  expected_qty, received_qty, accepted_qty, rejected_qty, damaged_qty, short_qty, excess_qty,
  packages, package_type, gross_weight_kg, condition, remarks`;

function toApi(row: GrnRow, items?: (GrnItemRow & { serial_nos?: string[] })[]) {
  return {
    id: row.id,
    number: row.number,
    grnDate: row.grn_date,
    warehouseId: row.warehouse_id,
    customerId: row.customer_id,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    inwardId: row.inward_id,
    gateEntryId: row.gate_entry_id,
    vehicleId: row.vehicle_id,
    vehicleNumber: row.vehicle_number,
    driverId: row.driver_id,
    driverName: row.driver_name,
    driverMobile: row.driver_mobile,
    transporterId: row.transporter_id,
    transporterName: row.transporter_name,
    lrNumber: row.lr_number,
    lrDate: row.lr_date,
    invoiceNumber: row.invoice_number,
    invoiceDate: row.invoice_date,
    ewayBillNumber: row.eway_bill_number,
    poNumber: row.po_number,
    remarks: row.remarks,
    status: row.status,
    submittedAt: row.submitted_at,
    checkedAt: row.checked_at,
    approvedAt: row.approved_at,
    stockPostedAt: row.stock_posted_at,
    hasDiscrepancy: row.has_discrepancy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(items && {
      items: items.map((i) => ({
        id: i.id,
        lineNo: i.line_no,
        inwardItemId: i.inward_item_id,
        productId: i.product_id,
        productSnapshot: i.product_snapshot,
        batchId: i.batch_id,
        batchNo: i.batch_no,
        mfgDate: i.mfg_date,
        expiryDate: i.expiry_date,
        expectedQty: Number(i.expected_qty),
        receivedQty: Number(i.received_qty),
        acceptedQty: Number(i.accepted_qty),
        rejectedQty: Number(i.rejected_qty),
        damagedQty: Number(i.damaged_qty),
        shortQty: Number(i.short_qty),
        excessQty: Number(i.excess_qty),
        packages: i.packages,
        packageType: i.package_type,
        grossWeightKg: i.gross_weight_kg === null ? null : Number(i.gross_weight_kg),
        condition: i.condition,
        remarks: i.remarks,
        serialNos: i.serial_nos ?? [],
      })),
    }),
  };
}

interface InwardDefaults {
  warehouseId: string;
  customerId: string;
  supplierId: string | null;
  supplierName: string | null;
  gateEntryId: string | null;
  vehicleId: string | null;
  vehicleNumber: string | null;
  driverId: string | null;
  driverName: string | null;
  driverMobile: string | null;
  transporterId: string | null;
  transporterName: string | null;
  lrNumber: string | null;
  lrDate: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  ewayBillNumber: string | null;
  poNumber: string | null;
  items: CreateGrnItemDto[];
}

/**
 * Blueprint §18: "one of the most important V1 transactions."
 * Draft -> Submitted -> Checked -> Approved (or Rejected), the
 * Operator -> Manager split from §50's approval engine:
 * `create_grn` submits, `approve_grn` checks and approves.
 *
 * "Only approved GRNs post stock" -- but stock does not move in Phase 4
 * at all (dev-phases.md), so `approve()` deliberately leaves
 * `stock_posted_at` null rather than faking a posting; Phase 5's stock
 * engine is what fills it. `'reversed'` is deferred for the same reason:
 * a controlled reversal (§50) exists to undo a stock posting, and there
 * is no posting to undo yet.
 */
@Injectable()
export class GrnsService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
  ) {}

  private async resolveTransportRefs(
    tx: postgres.TransactionSql,
    tenantId: string,
    dto: {
      vehicleId?: string;
      vehicleNumber?: string;
      driverId?: string;
      driverName?: string;
      driverMobile?: string;
      transporterId?: string;
      transporterName?: string;
    },
    seed: Omit<InwardDefaults, 'warehouseId' | 'customerId' | 'items'> | null,
  ) {
    const vehicleId = dto.vehicleId ?? seed?.vehicleId ?? undefined;
    let vehicleNumber = dto.vehicleNumber ?? (dto.vehicleId ? undefined : (seed?.vehicleNumber ?? undefined));
    let transporterId = dto.transporterId ?? (dto.vehicleId ? undefined : (seed?.transporterId ?? undefined));
    let transporterName = dto.transporterName ?? (dto.transporterId ? undefined : (seed?.transporterName ?? undefined));

    if (vehicleId) {
      const [vehicle] = await tx<{ vehicle_number: string; transporter_id: string | null }[]>`
        select vehicle_number, transporter_id from vehicles where id = ${vehicleId} and tenant_id = ${tenantId}
      `;
      if (!vehicle) throw new NotFoundException('Vehicle not found');
      vehicleNumber = dto.vehicleNumber ?? vehicle.vehicle_number;
      if (!transporterId && vehicle.transporter_id) transporterId = vehicle.transporter_id;
    }

    const driverId = dto.driverId ?? seed?.driverId ?? undefined;
    let driverName = dto.driverName ?? (dto.driverId ? undefined : (seed?.driverName ?? undefined));
    let driverMobile = dto.driverMobile ?? (dto.driverId ? undefined : (seed?.driverMobile ?? undefined));
    if (driverId) {
      const [driver] = await tx<{ name: string; mobile: string | null }[]>`
        select name, mobile from drivers where id = ${driverId} and tenant_id = ${tenantId}
      `;
      if (!driver) throw new NotFoundException('Driver not found');
      driverName = dto.driverName ?? driver.name;
      driverMobile = dto.driverMobile ?? driver.mobile ?? undefined;
    }

    if (transporterId && !transporterName) {
      const [transporter] = await tx<{ name: string }[]>`
        select name from transporters where id = ${transporterId} and tenant_id = ${tenantId}
      `;
      if (!transporter) throw new NotFoundException('Transporter not found');
      transporterName = transporter.name;
    } else if (dto.transporterId) {
      const [transporter] = await tx`select 1 from transporters where id = ${dto.transporterId} and tenant_id = ${tenantId}`;
      if (!transporter) throw new NotFoundException('Transporter not found');
    }

    return {
      vehicleId: vehicleId ?? null,
      vehicleNumber: vehicleNumber ?? null,
      driverId: driverId ?? null,
      driverName: driverName ?? null,
      driverMobile: driverMobile ?? null,
      transporterId: transporterId ?? null,
      transporterName: transporterName ?? null,
    };
  }

  /** Blueprint §18's "Auto-fill from Inward" -- header *and* items, resolved server-side. */
  private async loadInwardDefaults(
    tx: postgres.TransactionSql,
    tenantId: string,
    inwardId: string,
  ): Promise<InwardDefaults> {
    const [inward] = await tx<
      {
        status: string;
        warehouse_id: string;
        customer_id: string;
        supplier_id: string | null;
        supplier_name: string | null;
        gate_entry_id: string | null;
        vehicle_id: string | null;
        vehicle_number: string | null;
        driver_id: string | null;
        driver_name: string | null;
        driver_mobile: string | null;
        transporter_id: string | null;
        transporter_name: string | null;
        lr_number: string | null;
        lr_date: string | null;
        invoice_number: string | null;
        invoice_date: string | null;
        eway_bill_number: string | null;
        po_number: string | null;
      }[]
    >`
      select status, warehouse_id, customer_id, supplier_id, supplier_name, gate_entry_id, vehicle_id,
             vehicle_number, driver_id, driver_name, driver_mobile, transporter_id, transporter_name,
             lr_number, lr_date, invoice_number, invoice_date, eway_bill_number, po_number
      from inwards where id = ${inwardId} and tenant_id = ${tenantId}
    `;
    if (!inward) throw new NotFoundException('Inward not found');
    if (inward.status !== 'received') {
      throw new BadRequestException(
        `Cannot create a GRN from an inward in '${inward.status}' status (expected 'received')`,
      );
    }

    const items = await tx<
      {
        id: string;
        product_id: string;
        batch_no: string | null;
        mfg_date: string | null;
        expiry_date: string | null;
        expected_qty: string;
        received_qty: string;
        accepted_qty: string;
        rejected_qty: string;
        packages: number | null;
        package_type: string | null;
        gross_weight_kg: string | null;
        condition: string | null;
        remarks: string | null;
      }[]
    >`
      select id, product_id, batch_no, mfg_date, expiry_date, expected_qty, received_qty, accepted_qty,
             rejected_qty, packages, package_type, gross_weight_kg, condition, remarks
      from inward_items where tenant_id = ${tenantId} and inward_id = ${inwardId}
      order by line_no
    `;

    return {
      warehouseId: inward.warehouse_id,
      customerId: inward.customer_id,
      supplierId: inward.supplier_id,
      supplierName: inward.supplier_name,
      gateEntryId: inward.gate_entry_id,
      vehicleId: inward.vehicle_id,
      vehicleNumber: inward.vehicle_number,
      driverId: inward.driver_id,
      driverName: inward.driver_name,
      driverMobile: inward.driver_mobile,
      transporterId: inward.transporter_id,
      transporterName: inward.transporter_name,
      lrNumber: inward.lr_number,
      lrDate: inward.lr_date,
      invoiceNumber: inward.invoice_number,
      invoiceDate: inward.invoice_date,
      ewayBillNumber: inward.eway_bill_number,
      poNumber: inward.po_number,
      items: items.map((i) => ({
        productId: i.product_id,
        inwardItemId: i.id,
        batchNo: i.batch_no ?? undefined,
        mfgDate: i.mfg_date ?? undefined,
        expiryDate: i.expiry_date ?? undefined,
        expectedQty: Number(i.expected_qty),
        receivedQty: Number(i.received_qty),
        acceptedQty: Number(i.accepted_qty),
        rejectedQty: Number(i.rejected_qty),
        packages: i.packages ?? undefined,
        packageType: i.package_type ?? undefined,
        grossWeightKg: i.gross_weight_kg === null ? undefined : Number(i.gross_weight_kg),
        condition: (i.condition ?? undefined) as CreateGrnItemDto['condition'],
        remarks: i.remarks ?? undefined,
      })),
    };
  }

  private async insertItems(
    tx: postgres.TransactionSql,
    tenantId: string,
    grnId: string,
    customerId: string,
    itemDtos: CreateGrnItemDto[],
  ) {
    let lineNo = 1;
    for (const dto of itemDtos) {
      const accepted = dto.acceptedQty ?? 0;
      const rejected = dto.rejectedQty ?? 0;
      const received = dto.receivedQty ?? 0;
      // The table has this as a check constraint too -- re-stated here so a caller gets a 400 with a
      // readable message instead of a raw constraint violation (the same shape billing.spec.ts proves
      // for rate-card scopes).
      if (accepted + rejected > received) {
        throw new BadRequestException(
          `Line ${lineNo}: acceptedQty + rejectedQty (${accepted + rejected}) cannot exceed receivedQty (${received})`,
        );
      }

      const [product] = await tx<
        {
          sku: string;
          name: string;
          hsn_code: string | null;
          uom_code: string;
          weight_kg: string | null;
          serial_tracked: boolean;
        }[]
      >`
        select sku, name, hsn_code, uom_code, weight_kg, serial_tracked from products
        where id = ${dto.productId} and tenant_id = ${tenantId} and (customer_id is null or customer_id = ${customerId})
      `;
      if (!product) throw new NotFoundException('Product not found');
      if (dto.serialNos?.length && !product.serial_tracked) {
        throw new BadRequestException(`Line ${lineNo}: product ${product.sku} is not serial-tracked`);
      }

      const snapshot = {
        sku: product.sku,
        name: product.name,
        hsn: product.hsn_code,
        uom: product.uom_code,
        weightKg: product.weight_kg === null ? null : Number(product.weight_kg),
      };

      const itemId = randomUUID();
      await tx`
        insert into grn_items (
          id, tenant_id, grn_id, line_no, inward_item_id, product_id, product_snapshot, batch_no,
          mfg_date, expiry_date, expected_qty, received_qty, accepted_qty, rejected_qty, damaged_qty,
          packages, package_type, gross_weight_kg, condition, remarks
        ) values (
          ${itemId}, ${tenantId}, ${grnId}, ${lineNo}, ${dto.inwardItemId ?? null}, ${dto.productId},
          ${JSON.stringify(snapshot)}::jsonb, ${dto.batchNo ?? null}, ${dto.mfgDate ?? null},
          ${dto.expiryDate ?? null}, ${dto.expectedQty ?? 0}, ${received}, ${accepted}, ${rejected},
          ${dto.damagedQty ?? 0}, ${dto.packages ?? null}, ${dto.packageType ?? null},
          ${dto.grossWeightKg ?? null}, ${dto.condition ?? null}, ${dto.remarks ?? null}
        )
      `;

      for (const serialNo of dto.serialNos ?? []) {
        await tx`
          insert into grn_item_serials (id, tenant_id, grn_item_id, serial_no)
          values (${randomUUID()}, ${tenantId}, ${itemId}, ${serialNo})
        `;
      }
      lineNo += 1;
    }
  }

  /** `has_discrepancy` is derived, never client-supplied -- short/excess are generated columns, so it is read back after the lines land. */
  private async refreshDiscrepancyFlag(tx: postgres.TransactionSql, tenantId: string, grnId: string) {
    await tx`
      update grns set has_discrepancy = coalesce((
        select bool_or(short_qty > 0 or excess_qty > 0 or damaged_qty > 0)
        from grn_items where tenant_id = ${tenantId} and grn_id = ${grnId}
      ), false)
      where id = ${grnId} and tenant_id = ${tenantId}
    `;
  }

  private async fetchWithItems(tx: postgres.TransactionSql, tenantId: string, id: string) {
    const [row] = await tx<GrnRow[]>`
      select ${tx.unsafe(SELECT_COLUMNS)} from grns where id = ${id} and tenant_id = ${tenantId}
    `;
    if (!row) return null;
    const items = await tx<GrnItemRow[]>`
      select ${tx.unsafe(ITEM_SELECT_COLUMNS)} from grn_items
      where tenant_id = ${tenantId} and grn_id = ${id}
      order by line_no
    `;
    const serials = await tx<{ grn_item_id: string; serial_no: string }[]>`
      select s.grn_item_id, s.serial_no from grn_item_serials s
      join grn_items i on i.id = s.grn_item_id
      where s.tenant_id = ${tenantId} and i.grn_id = ${id}
      order by s.serial_no
    `;
    const withSerials = items.map((i) => ({
      ...i,
      serial_nos: serials.filter((s) => s.grn_item_id === i.id).map((s) => s.serial_no),
    }));
    return { row, items: withSerials };
  }

  async create(actor: AuthenticatedUser, dto: CreateGrnDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const inwardDefaults = dto.inwardId ? await this.loadInwardDefaults(tx, actor.tenantId, dto.inwardId) : null;

      const warehouseId = dto.warehouseId ?? inwardDefaults?.warehouseId;
      const customerId = dto.customerId ?? inwardDefaults?.customerId;
      if (!warehouseId || !customerId) {
        throw new BadRequestException('warehouseId and customerId are required (directly, or via an inwardId)');
      }
      const [warehouse] = await tx`select 1 from warehouses where id = ${warehouseId} and tenant_id = ${actor.tenantId}`;
      if (!warehouse) throw new NotFoundException('Warehouse not found');
      assertWarehouseInScope(scope, warehouseId);
      const [customer] = await tx`select 1 from customers where id = ${customerId} and tenant_id = ${actor.tenantId}`;
      if (!customer) throw new NotFoundException('Customer not found');

      const supplierId = dto.supplierId ?? inwardDefaults?.supplierId ?? null;
      if (dto.supplierId) {
        const [supplier] = await tx`select 1 from suppliers where id = ${dto.supplierId} and tenant_id = ${actor.tenantId}`;
        if (!supplier) throw new NotFoundException('Supplier not found');
      }
      const gateEntryId = dto.gateEntryId ?? inwardDefaults?.gateEntryId ?? null;
      if (dto.gateEntryId) {
        const [gateEntry] = await tx`select 1 from gate_entries where id = ${dto.gateEntryId} and tenant_id = ${actor.tenantId}`;
        if (!gateEntry) throw new NotFoundException('Gate entry not found');
      }

      const items = dto.items ?? inwardDefaults?.items;
      if (!items?.length) {
        throw new BadRequestException('items are required (directly, or via an inwardId whose own items are copied)');
      }

      const refs = await this.resolveTransportRefs(tx, actor.tenantId, dto, inwardDefaults);
      const number = await this.numbering.allocateNumberIn(tx, actor.tenantId, 'GRN_GENERATION');

      const id = randomUUID();
      await tx`
        insert into grns (
          id, tenant_id, number, grn_date, warehouse_id, customer_id, supplier_id, supplier_name,
          inward_id, gate_entry_id, vehicle_id, vehicle_number, driver_id, driver_name, driver_mobile,
          transporter_id, transporter_name, lr_number, lr_date, invoice_number, invoice_date,
          eway_bill_number, po_number, remarks, created_by, updated_by
        ) values (
          ${id}, ${actor.tenantId}, ${number}, ${dto.grnDate ?? new Date().toISOString().slice(0, 10)},
          ${warehouseId}, ${customerId}, ${supplierId}, ${dto.supplierName ?? inwardDefaults?.supplierName ?? null},
          ${dto.inwardId ?? null}, ${gateEntryId}, ${refs.vehicleId}, ${refs.vehicleNumber}, ${refs.driverId},
          ${refs.driverName}, ${refs.driverMobile}, ${refs.transporterId}, ${refs.transporterName},
          ${dto.lrNumber ?? inwardDefaults?.lrNumber ?? null}, ${dto.lrDate ?? inwardDefaults?.lrDate ?? null},
          ${dto.invoiceNumber ?? inwardDefaults?.invoiceNumber ?? null},
          ${dto.invoiceDate ?? inwardDefaults?.invoiceDate ?? null},
          ${dto.ewayBillNumber ?? inwardDefaults?.ewayBillNumber ?? null},
          ${dto.poNumber ?? inwardDefaults?.poNumber ?? null}, ${dto.remarks ?? null},
          ${actor.userId}, ${actor.userId}
        )
      `;
      await this.insertItems(tx, actor.tenantId, id, customerId, items);
      await this.refreshDiscrepancyFlag(tx, actor.tenantId, id);

      if (dto.inwardId) {
        await tx`update inwards set status = 'grn_created' where id = ${dto.inwardId} and tenant_id = ${actor.tenantId}`;
      }

      const fetched = await this.fetchWithItems(tx, actor.tenantId, id);
      return fetched!;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'create',
      entityType: 'grn',
      entityId: result.row.id,
      newValue: result.row,
      ipAddress,
    });
    return toApi(result.row, result.items);
  }

  async list(actor: AuthenticatedUser, query: ListGrnsQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    const warehouseFilter = query.warehouseId ?? null;
    const customerFilter = query.customerId ?? null;
    const statusFilter = query.status ?? null;

    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const rows = await tx<GrnRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)}
        from grns
        where tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or warehouse_id = any(${scope}))
          and (${pattern}::text is null or number ilike ${pattern} or invoice_number ilike ${pattern} or lr_number ilike ${pattern})
          and (${warehouseFilter}::uuid is null or warehouse_id = ${warehouseFilter})
          and (${customerFilter}::uuid is null or customer_id = ${customerFilter})
          and (${statusFilter}::text is null or status = ${statusFilter})
        order by grn_date desc, created_at desc
        limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`
        select count(*)::text as count from grns
        where tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or warehouse_id = any(${scope}))
          and (${pattern}::text is null or number ilike ${pattern} or invoice_number ilike ${pattern} or lr_number ilike ${pattern})
          and (${warehouseFilter}::uuid is null or warehouse_id = ${warehouseFilter})
          and (${customerFilter}::uuid is null or customer_id = ${customerFilter})
          and (${statusFilter}::text is null or status = ${statusFilter})
      `;
      return { items: rows.map((r) => toApi(r)), total: Number(count), limit: query.limit, offset: query.offset };
    });
  }

  async get(actor: AuthenticatedUser, id: string) {
    const fetched = await withTenant(this.sql, actor.tenantId, (tx) => this.fetchWithItems(tx, actor.tenantId, id));
    if (!fetched) throw new NotFoundException('GRN not found');
    return toApi(fetched.row, fetched.items);
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateGrnDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [before] = await tx<GrnRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from grns where id = ${id} and tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or warehouse_id = any(${scope})) for update
      `;
      if (!before) return null;
      if (before.status !== 'draft') {
        throw new BadRequestException(`Cannot edit a GRN in '${before.status}' status`);
      }

      const customerId = dto.customerId ?? before.customer_id;
      if (dto.customerId) {
        const [customer] = await tx`select 1 from customers where id = ${dto.customerId} and tenant_id = ${actor.tenantId}`;
        if (!customer) throw new NotFoundException('Customer not found');
      }
      if (dto.warehouseId) {
        const [warehouse] = await tx`select 1 from warehouses where id = ${dto.warehouseId} and tenant_id = ${actor.tenantId}`;
        if (!warehouse) throw new NotFoundException('Warehouse not found');
        assertWarehouseInScope(scope, dto.warehouseId);
      }
      if (dto.supplierId) {
        const [supplier] = await tx`select 1 from suppliers where id = ${dto.supplierId} and tenant_id = ${actor.tenantId}`;
        if (!supplier) throw new NotFoundException('Supplier not found');
      }

      const refs = await this.resolveTransportRefs(
        tx,
        actor.tenantId,
        {
          vehicleId: dto.vehicleId !== undefined ? dto.vehicleId : (before.vehicle_id ?? undefined),
          vehicleNumber: dto.vehicleNumber !== undefined ? dto.vehicleNumber : (before.vehicle_number ?? undefined),
          driverId: dto.driverId !== undefined ? dto.driverId : (before.driver_id ?? undefined),
          driverName: dto.driverName !== undefined ? dto.driverName : (before.driver_name ?? undefined),
          driverMobile: dto.driverMobile !== undefined ? dto.driverMobile : (before.driver_mobile ?? undefined),
          transporterId: dto.transporterId !== undefined ? dto.transporterId : (before.transporter_id ?? undefined),
          transporterName: dto.transporterName !== undefined ? dto.transporterName : (before.transporter_name ?? undefined),
        },
        null,
      );

      await tx`
        update grns
        set warehouse_id = ${dto.warehouseId ?? before.warehouse_id},
            customer_id = ${customerId},
            grn_date = ${dto.grnDate ?? before.grn_date},
            supplier_id = ${dto.supplierId !== undefined ? dto.supplierId : before.supplier_id},
            supplier_name = ${dto.supplierName !== undefined ? dto.supplierName : before.supplier_name},
            vehicle_id = ${refs.vehicleId},
            vehicle_number = ${refs.vehicleNumber},
            driver_id = ${refs.driverId},
            driver_name = ${refs.driverName},
            driver_mobile = ${refs.driverMobile},
            transporter_id = ${refs.transporterId},
            transporter_name = ${refs.transporterName},
            lr_number = ${dto.lrNumber !== undefined ? dto.lrNumber : before.lr_number},
            lr_date = ${dto.lrDate !== undefined ? dto.lrDate : before.lr_date},
            invoice_number = ${dto.invoiceNumber !== undefined ? dto.invoiceNumber : before.invoice_number},
            invoice_date = ${dto.invoiceDate !== undefined ? dto.invoiceDate : before.invoice_date},
            eway_bill_number = ${dto.ewayBillNumber !== undefined ? dto.ewayBillNumber : before.eway_bill_number},
            po_number = ${dto.poNumber !== undefined ? dto.poNumber : before.po_number},
            remarks = ${dto.remarks !== undefined ? dto.remarks : before.remarks},
            updated_by = ${actor.userId},
            updated_at = now()
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;

      if (dto.items) {
        await tx`delete from grn_items where tenant_id = ${actor.tenantId} and grn_id = ${id}`;
        await this.insertItems(tx, actor.tenantId, id, customerId, dto.items);
      }
      await this.refreshDiscrepancyFlag(tx, actor.tenantId, id);

      const after = await this.fetchWithItems(tx, actor.tenantId, id);
      return { before, after: after! };
    });
    if (!result) throw new NotFoundException('GRN not found');

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'update',
      entityType: 'grn',
      entityId: id,
      previousValue: result.before,
      newValue: result.after.row,
      ipAddress,
    });
    return toApi(result.after.row, result.after.items);
  }

  private async transition(
    actor: AuthenticatedUser,
    id: string,
    ipAddress: string | undefined,
    allowedFrom: string[],
    apply: (tx: postgres.TransactionSql, before: GrnRow) => Promise<void>,
  ) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [before] = await tx<GrnRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from grns where id = ${id} and tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or warehouse_id = any(${scope})) for update
      `;
      if (!before) return null;
      if (!allowedFrom.includes(before.status)) {
        throw new BadRequestException(
          `Cannot transition a GRN from '${before.status}' (expected one of: ${allowedFrom.join(', ')})`,
        );
      }
      await apply(tx, before);
      const after = await this.fetchWithItems(tx, actor.tenantId, id);
      return { before, after: after! };
    });
    if (!result) throw new NotFoundException('GRN not found');

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'status_change',
      entityType: 'grn',
      entityId: id,
      previousValue: { status: result.before.status },
      newValue: { status: result.after.row.status },
      ipAddress,
    });
    return toApi(result.after.row, result.after.items);
  }

  submit(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['draft'], async (tx) => {
      await tx`
        update grns set status = 'submitted', submitted_at = now(), submitted_by = ${actor.userId}
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
    });
  }

  /** Manager-side verification, gated on `approve_grn` -- §50's "GRN: Operator -> Manager" split, since no separate check_grn permission is seeded. */
  check(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['submitted'], async (tx) => {
      await tx`
        update grns set status = 'checked', checked_at = now(), checked_by = ${actor.userId}
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
    });
  }

  /**
   * "Only approved GRNs post stock" (§18), and this is where that
   * happens: approval writes the `INWARD` ledger rows for every accepted
   * quantity and stamps `stock_posted_at`, inside the same transaction as
   * the status change (§70). Approving is therefore the single moment a
   * receipt becomes stock -- nothing before it moves a balance, and the
   * put-away that follows only relocates what this posted.
   *
   * Stock lands **unallocated** (`location_id` null). That is not a
   * shortcut: 40_stock.sql spells out null as "unallocated / in-transit",
   * a GRN records what arrived rather than where it was shelved, and the
   * put-away slip is the document that decides the latter. Put-away
   * completion then moves it as a TRANSFER_OUT/TRANSFER_IN pair, which is
   * also what makes "stock exists but has not been put away yet" a
   * visible, queryable state rather than an invisible gap.
   */
  approve(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['checked'], async (tx, before) => {
      await this.postApprovalStock(tx, actor, before);
      await tx`
        update grns
        set status = 'approved', approved_at = now(), approved_by = ${actor.userId},
            stock_posted_at = now()
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
    });
  }

  /**
   * Resolves batches, then posts one `INWARD` movement per accepted unit
   * of stock. Serial-tracked products post one movement *per serial* with
   * a quantity of 1, because `stock_lots.serial_no` is part of the lot key
   * -- a serial-tracked product with ten units is ten lots, not one lot of
   * ten, and that is what makes §67's "which unit is where" answerable.
   */
  private async postApprovalStock(tx: postgres.TransactionSql, actor: AuthenticatedUser, grn: GrnRow) {
    const items = await tx<
      {
        id: string;
        product_id: string;
        batch_no: string | null;
        mfg_date: string | null;
        expiry_date: string | null;
        accepted_qty: string;
        uom_code: string;
        sku: string;
        batch_tracked: boolean;
        serial_tracked: boolean;
      }[]
    >`
      select gi.id, gi.product_id, gi.batch_no, gi.mfg_date, gi.expiry_date, gi.accepted_qty,
             p.uom_code, p.sku, p.batch_tracked, p.serial_tracked
      from grn_items gi
      join products p on p.id = gi.product_id
      where gi.tenant_id = ${actor.tenantId} and gi.grn_id = ${grn.id} and gi.accepted_qty > 0
      order by gi.line_no
    `;

    const movements: StockMovement[] = [];
    for (const item of items) {
      const acceptedQty = Number(item.accepted_qty);

      // stock-engine.md §5: `first_received_at` is stamped once from the
      // GRN that first created the batch and never updated, so a later
      // receipt into the same batch cannot make its stock look younger.
      let batchId: string | null = null;
      if (item.batch_tracked && item.batch_no) {
        batchId = await this.stock.resolveBatch(tx, actor.tenantId, {
          customerId: grn.customer_id,
          productId: item.product_id,
          batchNo: item.batch_no,
          mfgDate: item.mfg_date,
          expiryDate: item.expiry_date,
          firstReceivedAt: grn.grn_date,
        });
        await tx`update grn_items set batch_id = ${batchId} where id = ${item.id} and tenant_id = ${actor.tenantId}`;
      }

      const base = {
        txnType: 'INWARD' as const,
        customerId: grn.customer_id,
        warehouseId: grn.warehouse_id,
        locationId: null,
        productId: item.product_id,
        batchId,
        uomCode: item.uom_code,
        sourceLineId: item.id,
      };

      if (item.serial_tracked) {
        const serials = await tx<{ serial_no: string }[]>`
          select serial_no from grn_item_serials
          where tenant_id = ${actor.tenantId} and grn_item_id = ${item.id} and accepted
          order by serial_no
        `;
        if (serials.length !== acceptedQty) {
          throw new BadRequestException(
            `Cannot post stock for ${item.sku}: it is serial-tracked, so it needs one accepted serial number ` +
              `per accepted unit (${serials.length} recorded, ${acceptedQty} accepted)`,
          );
        }
        for (const { serial_no } of serials) {
          movements.push({ ...base, serialNo: serial_no, qtyIn: 1 });
        }
      } else {
        movements.push({ ...base, serialNo: null, qtyIn: acceptedQty });
      }
    }

    await this.stock.postWithin(tx, actor, {
      sourceType: 'grn',
      sourceId: grn.id,
      idempotencyKey: `grn:${grn.id}:approve`,
      movements,
    });
  }

  /**
   * stock-engine.md §3.5's controlled reversal, and the transition that
   * GRN `'reversed'` existed for since Phase 4 without having. It is
   * **additive**: nothing is deleted; every INWARD row this GRN posted gets
   * an offsetting row with `reversal_of_id` pointing back at it, so the
   * ledger keeps both the receipt and its undoing.
   *
   * Two refusals carry the real weight:
   *
   * - If a warehouse receipt is outstanding, reversal is refused. A
   *   customer is holding a document that says these goods are in
   *   storage; that document has to be cancelled first, deliberately.
   * - If the stock has since *moved* -- put away, transferred, partly
   *   dispatched -- the offsetting rows would take the original lot
   *   negative, and the engine refuses them. That is the correct answer:
   *   goods that have been shelved and picked from are no longer "the
   *   receipt", and unwinding them is a Stock Adjustment with a reason,
   *   not a reversal of the paperwork that brought them in.
   *
   * The inward goes back to `'received'`, so a corrected GRN can be
   * raised from it -- which is the whole reason anyone reverses one.
   */
  reverse(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['approved'], async (tx, before) => {
      const [receipt] = await tx<{ number: string }[]>`
        select number from warehouse_receipts
        where tenant_id = ${actor.tenantId} and grn_id = ${id} and status = 'issued'
      `;
      if (receipt) {
        throw new BadRequestException(
          `Warehouse receipt ${receipt.number} is issued against this GRN -- cancel it before reversing the receipt`,
        );
      }

      // Once a put-away has run, the goods are on shelves and may share a
      // lot with other receipts -- reversing "this GRN's" rows could then
      // quietly reverse someone else's stock without ever going negative.
      // So the question is not "would it go negative" but "has it moved".
      const [putaway] = await tx<{ number: string }[]>`
        select number from putaways
        where tenant_id = ${actor.tenantId} and grn_id = ${id} and status <> 'cancelled'
      `;
      if (putaway) {
        throw new BadRequestException(
          `Put-away ${putaway.number} has moved this GRN's stock -- it can no longer be reversed. ` +
            'Write the difference off with a Stock Adjustment instead.',
        );
      }

      const posted = await tx<
        {
          id: string;
          location_id: string | null;
          product_id: string;
          batch_id: string | null;
          serial_no: string | null;
          qty_in: string;
          uom_code: string;
          source_line_id: string | null;
        }[]
      >`
        select id, location_id, product_id, batch_id, serial_no, qty_in, uom_code, source_line_id
        from stock_ledger
        where tenant_id = ${actor.tenantId} and source_type = 'grn' and source_id = ${id}
          and txn_type = 'INWARD' and reversal_of_id is null
        order by txn_at, id
      `;

      try {
        await this.stock.postWithin(tx, actor, {
          sourceType: 'grn',
          sourceId: id,
          idempotencyKey: `grn:${id}:reverse`,
          movements: posted.map((row) => ({
            txnType: 'INWARD' as const,
            customerId: before.customer_id,
            warehouseId: before.warehouse_id,
            locationId: row.location_id,
            productId: row.product_id,
            batchId: row.batch_id,
            serialNo: row.serial_no,
            qtyOut: Number(row.qty_in),
            uomCode: row.uom_code,
            sourceLineId: row.source_line_id,
            reversalOfId: row.id,
            remarks: `Reversal of GRN ${before.number}`,
          })),
        });
      } catch (err) {
        if (err instanceof BadRequestException && /negative/i.test(String((err as Error).message))) {
          throw new BadRequestException(
            'Cannot reverse this GRN: its stock has since been moved (put away, transferred or dispatched). ' +
              'Write the difference off with a Stock Adjustment instead.',
          );
        }
        throw err;
      }

      await tx`
        update grns set status = 'reversed' where id = ${id} and tenant_id = ${actor.tenantId}
      `;
      if (before.inward_id) {
        await tx`
          update inwards set status = 'received'
          where id = ${before.inward_id} and tenant_id = ${actor.tenantId} and status = 'grn_created'
        `;
      }
    });
  }

  reject(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['submitted', 'checked'], async (tx) => {
      await tx`update grns set status = 'rejected' where id = ${id} and tenant_id = ${actor.tenantId}`;
    });
  }

  cancel(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['draft'], async (tx) => {
      await tx`update grns set status = 'cancelled' where id = ${id} and tenant_id = ${actor.tenantId}`;
    });
  }
}
