import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { NumberingService } from '../numbering/numbering.service';
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
  id, line_no, inward_item_id, product_id, product_snapshot, batch_no, mfg_date, expiry_date,
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
      const inwardDefaults = dto.inwardId ? await this.loadInwardDefaults(tx, actor.tenantId, dto.inwardId) : null;

      const warehouseId = dto.warehouseId ?? inwardDefaults?.warehouseId;
      const customerId = dto.customerId ?? inwardDefaults?.customerId;
      if (!warehouseId || !customerId) {
        throw new BadRequestException('warehouseId and customerId are required (directly, or via an inwardId)');
      }
      const [warehouse] = await tx`select 1 from warehouses where id = ${warehouseId} and tenant_id = ${actor.tenantId}`;
      if (!warehouse) throw new NotFoundException('Warehouse not found');
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
      const rows = await tx<GrnRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)}
        from grns
        where tenant_id = ${actor.tenantId}
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
      const [before] = await tx<GrnRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from grns where id = ${id} and tenant_id = ${actor.tenantId} for update
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
    apply: (tx: postgres.TransactionSql) => Promise<void>,
  ) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [before] = await tx<GrnRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from grns where id = ${id} and tenant_id = ${actor.tenantId} for update
      `;
      if (!before) return null;
      if (!allowedFrom.includes(before.status)) {
        throw new BadRequestException(
          `Cannot transition a GRN from '${before.status}' (expected one of: ${allowedFrom.join(', ')})`,
        );
      }
      await apply(tx);
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

  /** "Only approved GRNs post stock" (§18) -- but Phase 4 posts none, so `stock_posted_at` stays null until Phase 5's stock engine fills it. */
  approve(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['checked'], async (tx) => {
      await tx`
        update grns set status = 'approved', approved_at = now(), approved_by = ${actor.userId}
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
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
