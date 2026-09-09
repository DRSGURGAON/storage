import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { assertWarehouseInScope, loadWarehouseScope } from '../auth/warehouse-scope';
import { withTenant } from '../db/tenant-context';
import { NumberingService } from '../numbering/numbering.service';
import { CreateInwardItemDto } from './dto/create-inward-item.dto';
import { CreateInwardDto } from './dto/create-inward.dto';
import { ListInwardsQuery } from './dto/list-inwards.query';
import { UpdateInwardDto } from './dto/update-inward.dto';

interface InwardRow {
  id: string;
  number: string;
  inward_at: string;
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
  invoice_value: string | null;
  eway_bill_number: string | null;
  eway_bill_date: string | null;
  po_number: string | null;
  remarks: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface InwardItemRow {
  id: string;
  line_no: number;
  product_id: string;
  product_snapshot: Record<string, unknown>;
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
}

const SELECT_COLUMNS = `
  id, number, inward_at, warehouse_id, customer_id, supplier_id, supplier_name, gate_entry_id,
  vehicle_id, vehicle_number, driver_id, driver_name, driver_mobile, transporter_id, transporter_name,
  lr_number, lr_date, invoice_number, invoice_date, invoice_value, eway_bill_number, eway_bill_date,
  po_number, remarks, status, created_at, updated_at`;

const ITEM_SELECT_COLUMNS = `
  id, line_no, product_id, product_snapshot, batch_no, mfg_date, expiry_date, expected_qty,
  received_qty, accepted_qty, rejected_qty, packages, package_type, gross_weight_kg, condition, remarks`;

function toApi(row: InwardRow, items?: InwardItemRow[]) {
  return {
    id: row.id,
    number: row.number,
    inwardAt: row.inward_at,
    warehouseId: row.warehouse_id,
    customerId: row.customer_id,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
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
    invoiceValue: row.invoice_value === null ? null : Number(row.invoice_value),
    ewayBillNumber: row.eway_bill_number,
    ewayBillDate: row.eway_bill_date,
    poNumber: row.po_number,
    remarks: row.remarks,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(items && {
      items: items.map((i) => ({
        id: i.id,
        lineNo: i.line_no,
        productId: i.product_id,
        productSnapshot: i.product_snapshot,
        batchNo: i.batch_no,
        mfgDate: i.mfg_date,
        expiryDate: i.expiry_date,
        expectedQty: Number(i.expected_qty),
        receivedQty: Number(i.received_qty),
        acceptedQty: Number(i.accepted_qty),
        rejectedQty: Number(i.rejected_qty),
        packages: i.packages,
        packageType: i.package_type,
        grossWeightKg: i.gross_weight_kg === null ? null : Number(i.gross_weight_kg),
        condition: i.condition,
        remarks: i.remarks,
      })),
    }),
  };
}

interface TransportRefs {
  vehicleId: string | null;
  vehicleNumber: string | null;
  driverId: string | null;
  driverName: string | null;
  driverMobile: string | null;
  transporterId: string | null;
  transporterName: string | null;
}

interface GateEntryDefaults {
  customerId: string | null;
  vehicleId: string | null;
  vehicleNumber: string | null;
  driverId: string | null;
  driverName: string | null;
  driverMobile: string | null;
  transporterId: string | null;
  transporterName: string | null;
}

/**
 * Blueprint §17: Goods Inward, Phase 4's second slice. "If a Gate Entry
 * already exists, selecting it must auto-fill its available data" is
 * resolved server-side (not left as a frontend convention) the same way
 * Gate Entry's own "selecting vehicle auto-fills transporter" was --
 * proven directly, not just implemented per the blueprint's prose.
 * `status = 'grn_created'` is set by GRN's own increment, not here --
 * same deferral shape as Gate Entry's `'linked'`.
 */
@Injectable()
export class InwardsService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  /** "Selecting vehicle must auto-fill transporter" (§16), reused here with an extra fallback layer: an explicit dto field wins, then the linked Gate Entry's own value, then nothing. */
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
    seed: GateEntryDefaults | null,
  ): Promise<TransportRefs> {
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

  private async snapshotProduct(
    tx: postgres.TransactionSql,
    tenantId: string,
    customerId: string,
    productId: string,
  ): Promise<Record<string, unknown>> {
    const [product] = await tx<
      { sku: string; name: string; hsn_code: string | null; uom_code: string; weight_kg: string | null }[]
    >`
      select sku, name, hsn_code, uom_code, weight_kg from products
      where id = ${productId} and tenant_id = ${tenantId} and (customer_id is null or customer_id = ${customerId})
    `;
    if (!product) throw new NotFoundException('Product not found');
    return {
      sku: product.sku,
      name: product.name,
      hsn: product.hsn_code,
      uom: product.uom_code,
      weightKg: product.weight_kg === null ? null : Number(product.weight_kg),
    };
  }

  private async insertItems(
    tx: postgres.TransactionSql,
    tenantId: string,
    inwardId: string,
    customerId: string,
    itemDtos: CreateInwardItemDto[],
  ) {
    let lineNo = 1;
    for (const dto of itemDtos) {
      const snapshot = await this.snapshotProduct(tx, tenantId, customerId, dto.productId);
      await tx`
        insert into inward_items (
          id, tenant_id, inward_id, line_no, product_id, product_snapshot, batch_no, mfg_date, expiry_date,
          expected_qty, received_qty, accepted_qty, rejected_qty, packages, package_type, gross_weight_kg,
          condition, remarks
        ) values (
          ${randomUUID()}, ${tenantId}, ${inwardId}, ${lineNo}, ${dto.productId}, ${JSON.stringify(snapshot)}::jsonb,
          ${dto.batchNo ?? null}, ${dto.mfgDate ?? null}, ${dto.expiryDate ?? null}, ${dto.expectedQty ?? 0},
          ${dto.receivedQty ?? 0}, ${dto.acceptedQty ?? 0}, ${dto.rejectedQty ?? 0}, ${dto.packages ?? null},
          ${dto.packageType ?? null}, ${dto.grossWeightKg ?? null}, ${dto.condition ?? null}, ${dto.remarks ?? null}
        )
      `;
      lineNo += 1;
    }
  }

  private async fetchWithItems(tx: postgres.TransactionSql, tenantId: string, id: string) {
    const [row] = await tx<InwardRow[]>`
      select ${tx.unsafe(SELECT_COLUMNS)} from inwards where id = ${id} and tenant_id = ${tenantId}
    `;
    if (!row) return null;
    const items = await tx<InwardItemRow[]>`
      select ${tx.unsafe(ITEM_SELECT_COLUMNS)} from inward_items
      where tenant_id = ${tenantId} and inward_id = ${id}
      order by line_no
    `;
    return { row, items };
  }

  async create(actor: AuthenticatedUser, dto: CreateInwardDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [warehouse] = await tx`select 1 from warehouses where id = ${dto.warehouseId} and tenant_id = ${actor.tenantId}`;
      if (!warehouse) throw new NotFoundException('Warehouse not found');
      assertWarehouseInScope(scope, dto.warehouseId);

      let customerId = dto.customerId ?? null;
      let gateEntryDefaults: GateEntryDefaults | null = null;

      if (dto.gateEntryId) {
        const [gateEntry] = await tx<
          {
            status: string;
            customer_id: string | null;
            vehicle_id: string | null;
            vehicle_number: string | null;
            driver_id: string | null;
            driver_name: string | null;
            driver_mobile: string | null;
            transporter_id: string | null;
            transporter_name: string | null;
          }[]
        >`
          select status, customer_id, vehicle_id, vehicle_number, driver_id, driver_name, driver_mobile,
                 transporter_id, transporter_name
          from gate_entries where id = ${dto.gateEntryId} and tenant_id = ${actor.tenantId}
        `;
        if (!gateEntry) throw new NotFoundException('Gate entry not found');
        if (gateEntry.status !== 'open') {
          throw new BadRequestException(`Cannot link a gate entry in '${gateEntry.status}' status (expected 'open')`);
        }
        customerId = customerId ?? gateEntry.customer_id;
        gateEntryDefaults = {
          customerId: gateEntry.customer_id,
          vehicleId: gateEntry.vehicle_id,
          vehicleNumber: gateEntry.vehicle_number,
          driverId: gateEntry.driver_id,
          driverName: gateEntry.driver_name,
          driverMobile: gateEntry.driver_mobile,
          transporterId: gateEntry.transporter_id,
          transporterName: gateEntry.transporter_name,
        };
      }
      if (!customerId) {
        throw new BadRequestException('customerId is required (directly, or via a gate entry that has one)');
      }
      const [customer] = await tx`select 1 from customers where id = ${customerId} and tenant_id = ${actor.tenantId}`;
      if (!customer) throw new NotFoundException('Customer not found');

      if (dto.supplierId) {
        const [supplier] = await tx`select 1 from suppliers where id = ${dto.supplierId} and tenant_id = ${actor.tenantId}`;
        if (!supplier) throw new NotFoundException('Supplier not found');
      }

      const refs = await this.resolveTransportRefs(tx, actor.tenantId, dto, gateEntryDefaults);
      const number = await this.numbering.allocateNumberIn(tx, actor.tenantId, 'INWARD');

      const id = randomUUID();
      await tx`
        insert into inwards (
          id, tenant_id, number, inward_at, warehouse_id, customer_id, supplier_id, supplier_name, gate_entry_id,
          vehicle_id, vehicle_number, driver_id, driver_name, driver_mobile, transporter_id, transporter_name,
          lr_number, lr_date, invoice_number, invoice_date, invoice_value, eway_bill_number, eway_bill_date,
          po_number, remarks, created_by, updated_by
        ) values (
          ${id}, ${actor.tenantId}, ${number}, ${dto.inwardAt ?? new Date().toISOString()}, ${dto.warehouseId},
          ${customerId}, ${dto.supplierId ?? null}, ${dto.supplierName ?? null}, ${dto.gateEntryId ?? null},
          ${refs.vehicleId}, ${refs.vehicleNumber}, ${refs.driverId}, ${refs.driverName}, ${refs.driverMobile},
          ${refs.transporterId}, ${refs.transporterName}, ${dto.lrNumber ?? null}, ${dto.lrDate ?? null},
          ${dto.invoiceNumber ?? null}, ${dto.invoiceDate ?? null}, ${dto.invoiceValue ?? null},
          ${dto.ewayBillNumber ?? null}, ${dto.ewayBillDate ?? null}, ${dto.poNumber ?? null}, ${dto.remarks ?? null},
          ${actor.userId}, ${actor.userId}
        )
      `;
      await this.insertItems(tx, actor.tenantId, id, customerId, dto.items);

      if (dto.gateEntryId) {
        await tx`update gate_entries set status = 'linked' where id = ${dto.gateEntryId} and tenant_id = ${actor.tenantId}`;
      }

      const fetched = await this.fetchWithItems(tx, actor.tenantId, id);
      return fetched!;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'create',
      entityType: 'inward',
      entityId: result.row.id,
      newValue: result.row,
      ipAddress,
    });
    return toApi(result.row, result.items);
  }

  async list(actor: AuthenticatedUser, query: ListInwardsQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    const warehouseFilter = query.warehouseId ?? null;
    const customerFilter = query.customerId ?? null;
    const statusFilter = query.status ?? null;

    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const rows = await tx<InwardRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)}
        from inwards
        where tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or warehouse_id = any(${scope}))
          and (${pattern}::text is null or number ilike ${pattern} or lr_number ilike ${pattern} or invoice_number ilike ${pattern})
          and (${warehouseFilter}::uuid is null or warehouse_id = ${warehouseFilter})
          and (${customerFilter}::uuid is null or customer_id = ${customerFilter})
          and (${statusFilter}::text is null or status = ${statusFilter})
        order by inward_at desc
        limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`
        select count(*)::text as count from inwards
        where tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or warehouse_id = any(${scope}))
          and (${pattern}::text is null or number ilike ${pattern} or lr_number ilike ${pattern} or invoice_number ilike ${pattern})
          and (${warehouseFilter}::uuid is null or warehouse_id = ${warehouseFilter})
          and (${customerFilter}::uuid is null or customer_id = ${customerFilter})
          and (${statusFilter}::text is null or status = ${statusFilter})
      `;
      return { items: rows.map((r) => toApi(r)), total: Number(count), limit: query.limit, offset: query.offset };
    });
  }

  async get(actor: AuthenticatedUser, id: string) {
    const fetched = await withTenant(this.sql, actor.tenantId, (tx) => this.fetchWithItems(tx, actor.tenantId, id));
    if (!fetched) throw new NotFoundException('Inward not found');
    return toApi(fetched.row, fetched.items);
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateInwardDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [before] = await tx<InwardRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from inwards where id = ${id} and tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or warehouse_id = any(${scope})) for update
      `;
      if (!before) return null;
      if (before.status !== 'draft') {
        throw new BadRequestException(`Cannot edit an inward in '${before.status}' status`);
      }

      if (dto.warehouseId) {
        const [warehouse] = await tx`select 1 from warehouses where id = ${dto.warehouseId} and tenant_id = ${actor.tenantId}`;
        if (!warehouse) throw new NotFoundException('Warehouse not found');
        assertWarehouseInScope(scope, dto.warehouseId);
      }
      const customerId = dto.customerId ?? before.customer_id;
      if (dto.customerId) {
        const [customer] = await tx`select 1 from customers where id = ${dto.customerId} and tenant_id = ${actor.tenantId}`;
        if (!customer) throw new NotFoundException('Customer not found');
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
        update inwards
        set warehouse_id = ${dto.warehouseId ?? before.warehouse_id},
            customer_id = ${customerId},
            inward_at = ${dto.inwardAt ?? before.inward_at},
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
            invoice_value = ${dto.invoiceValue !== undefined ? dto.invoiceValue : before.invoice_value},
            eway_bill_number = ${dto.ewayBillNumber !== undefined ? dto.ewayBillNumber : before.eway_bill_number},
            eway_bill_date = ${dto.ewayBillDate !== undefined ? dto.ewayBillDate : before.eway_bill_date},
            po_number = ${dto.poNumber !== undefined ? dto.poNumber : before.po_number},
            remarks = ${dto.remarks !== undefined ? dto.remarks : before.remarks},
            updated_by = ${actor.userId},
            updated_at = now()
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;

      if (dto.items) {
        await tx`delete from inward_items where tenant_id = ${actor.tenantId} and inward_id = ${id}`;
        await this.insertItems(tx, actor.tenantId, id, customerId, dto.items);
      }

      const after = await this.fetchWithItems(tx, actor.tenantId, id);
      return { before, after: after! };
    });
    if (!result) throw new NotFoundException('Inward not found');

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'update',
      entityType: 'inward',
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
    newStatus: string,
  ) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [before] = await tx<InwardRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from inwards where id = ${id} and tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or warehouse_id = any(${scope})) for update
      `;
      if (!before) return null;
      if (!allowedFrom.includes(before.status)) {
        throw new BadRequestException(
          `Cannot transition an inward from '${before.status}' (expected one of: ${allowedFrom.join(', ')})`,
        );
      }
      await tx`update inwards set status = ${newStatus}, updated_by = ${actor.userId}, updated_at = now() where id = ${id} and tenant_id = ${actor.tenantId}`;
      const after = await this.fetchWithItems(tx, actor.tenantId, id);
      return { before, after: after! };
    });
    if (!result) throw new NotFoundException('Inward not found');

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'status_change',
      entityType: 'inward',
      entityId: id,
      previousValue: { status: result.before.status },
      newValue: { status: result.after.row.status },
      ipAddress,
    });
    return toApi(result.after.row, result.after.items);
  }

  /** Confirms the recorded quantities/condition are final and locks editing -- the basis a GRN will be raised from. */
  receive(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['draft'], 'received');
  }

  /** Not once a GRN exists ('grn_created') -- cancelling then would orphan it. */
  cancel(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['draft', 'received'], 'cancelled');
  }
}
