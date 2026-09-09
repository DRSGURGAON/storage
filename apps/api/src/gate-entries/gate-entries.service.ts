import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { NumberingService } from '../numbering/numbering.service';
import { CreateGateEntryDto } from './dto/create-gate-entry.dto';
import { ListGateEntriesQuery } from './dto/list-gate-entries.query';
import { CloseGateEntryDto } from './dto/close-gate-entry.dto';
import { UpdateGateEntryDto } from './dto/update-gate-entry.dto';

interface GateEntryRow {
  id: string;
  number: string;
  warehouse_id: string;
  direction: string;
  // Read back as plain strings, not Date objects -- db/client.ts's createDbConnection() wraps the
  // shared connection with drizzle(sql), which registers its own timestamptz parser on the connection
  // even though this codebase never uses Drizzle's own query builder (DECISIONS.md §27). A raw JS Date
  // passed as a bind parameter for one of these columns fails at the wire-encoding layer for the same
  // reason -- always round-trip these as the string Postgres itself hands back, never `new Date()`.
  entry_at: string;
  exit_at: string | null;
  customer_id: string | null;
  vehicle_id: string | null;
  vehicle_number: string | null;
  driver_id: string | null;
  driver_name: string | null;
  driver_mobile: string | null;
  transporter_id: string | null;
  transporter_name: string | null;
  purpose: string;
  reference_no: string | null;
  remarks: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

const SELECT_COLUMNS = `
  id, number, warehouse_id, direction, entry_at, exit_at, customer_id, vehicle_id, vehicle_number,
  driver_id, driver_name, driver_mobile, transporter_id, transporter_name, purpose, reference_no,
  remarks, status, created_at, updated_at`;

function toApi(row: GateEntryRow) {
  return {
    id: row.id,
    number: row.number,
    warehouseId: row.warehouse_id,
    direction: row.direction,
    entryAt: row.entry_at,
    exitAt: row.exit_at,
    customerId: row.customer_id,
    vehicleId: row.vehicle_id,
    vehicleNumber: row.vehicle_number,
    driverId: row.driver_id,
    driverName: row.driver_name,
    driverMobile: row.driver_mobile,
    transporterId: row.transporter_id,
    transporterName: row.transporter_name,
    purpose: row.purpose,
    referenceNo: row.reference_no,
    remarks: row.remarks,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface ResolvedRefs {
  vehicleId: string | null;
  vehicleNumber: string | null;
  driverId: string | null;
  driverName: string | null;
  driverMobile: string | null;
  transporterId: string | null;
  transporterName: string | null;
}

/**
 * Blueprint §16: the vehicle gate log, Phase 4's first slice -- a
 * standalone record with no line items, so the whole shape is simpler
 * than Quotation/Agreement. Draft-like editability lives on `status =
 * 'open'` rather than a literal 'draft' value (schema/30_inbound.sql).
 * `'linked'` (an Inward referencing this gate entry) is set by a later
 * Phase 4 slice, not here -- Gate Entry alone has nothing to link to yet.
 */
@Injectable()
export class GateEntriesService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  /** "Selecting vehicle must auto-fill transporter" (§16) -- resolved server-side so it's proven, not just a frontend convention. */
  private async resolveRefs(
    tx: postgres.TransactionSql,
    tenantId: string,
    dto: Pick<
      CreateGateEntryDto,
      'vehicleId' | 'vehicleNumber' | 'driverId' | 'driverName' | 'driverMobile' | 'transporterId' | 'transporterName'
    >,
  ): Promise<ResolvedRefs> {
    let vehicleNumber = dto.vehicleNumber ?? null;
    let transporterId = dto.transporterId ?? null;
    let transporterName = dto.transporterName ?? null;

    if (dto.vehicleId) {
      const [vehicle] = await tx<{ vehicle_number: string; transporter_id: string | null }[]>`
        select vehicle_number, transporter_id from vehicles where id = ${dto.vehicleId} and tenant_id = ${tenantId}
      `;
      if (!vehicle) throw new NotFoundException('Vehicle not found');
      vehicleNumber = dto.vehicleNumber ?? vehicle.vehicle_number;
      if (!transporterId && vehicle.transporter_id) transporterId = vehicle.transporter_id;
    }

    let driverName = dto.driverName ?? null;
    let driverMobile = dto.driverMobile ?? null;
    if (dto.driverId) {
      const [driver] = await tx<{ name: string; mobile: string | null }[]>`
        select name, mobile from drivers where id = ${dto.driverId} and tenant_id = ${tenantId}
      `;
      if (!driver) throw new NotFoundException('Driver not found');
      driverName = dto.driverName ?? driver.name;
      driverMobile = dto.driverMobile ?? driver.mobile;
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
      vehicleId: dto.vehicleId ?? null,
      vehicleNumber,
      driverId: dto.driverId ?? null,
      driverName,
      driverMobile,
      transporterId,
      transporterName,
    };
  }

  async create(actor: AuthenticatedUser, dto: CreateGateEntryDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [warehouse] = await tx`select 1 from warehouses where id = ${dto.warehouseId} and tenant_id = ${actor.tenantId}`;
      if (!warehouse) throw new NotFoundException('Warehouse not found');
      if (dto.customerId) {
        const [customer] = await tx`select 1 from customers where id = ${dto.customerId} and tenant_id = ${actor.tenantId}`;
        if (!customer) throw new NotFoundException('Customer not found');
      }

      const refs = await this.resolveRefs(tx, actor.tenantId, dto);
      const number = await this.numbering.allocateNumberIn(tx, actor.tenantId, 'GATE_ENTRY');

      const id = randomUUID();
      await tx`
        insert into gate_entries (
          id, tenant_id, number, warehouse_id, direction, entry_at, customer_id,
          vehicle_id, vehicle_number, driver_id, driver_name, driver_mobile,
          transporter_id, transporter_name, purpose, reference_no, remarks, created_by, updated_by
        ) values (
          ${id}, ${actor.tenantId}, ${number}, ${dto.warehouseId}, ${dto.direction}, ${dto.entryAt ?? new Date().toISOString()},
          ${dto.customerId ?? null}, ${refs.vehicleId}, ${refs.vehicleNumber}, ${refs.driverId}, ${refs.driverName},
          ${refs.driverMobile}, ${refs.transporterId}, ${refs.transporterName}, ${dto.purpose},
          ${dto.referenceNo ?? null}, ${dto.remarks ?? null}, ${actor.userId}, ${actor.userId}
        )
      `;
      const [row] = await tx<GateEntryRow[]>`select ${tx.unsafe(SELECT_COLUMNS)} from gate_entries where id = ${id}`;
      return row;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'create',
      entityType: 'gate_entry',
      entityId: result.id,
      newValue: result,
      ipAddress,
    });
    return toApi(result);
  }

  async list(actor: AuthenticatedUser, query: ListGateEntriesQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    const warehouseFilter = query.warehouseId ?? null;
    const statusFilter = query.status ?? null;
    const directionFilter = query.direction ?? null;

    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const rows = await tx<GateEntryRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)}
        from gate_entries
        where tenant_id = ${actor.tenantId}
          and (${pattern}::text is null or number ilike ${pattern} or vehicle_number ilike ${pattern} or driver_name ilike ${pattern} or reference_no ilike ${pattern})
          and (${warehouseFilter}::uuid is null or warehouse_id = ${warehouseFilter})
          and (${statusFilter}::text is null or status = ${statusFilter})
          and (${directionFilter}::text is null or direction = ${directionFilter})
        order by entry_at desc
        limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`
        select count(*)::text as count from gate_entries
        where tenant_id = ${actor.tenantId}
          and (${pattern}::text is null or number ilike ${pattern} or vehicle_number ilike ${pattern} or driver_name ilike ${pattern} or reference_no ilike ${pattern})
          and (${warehouseFilter}::uuid is null or warehouse_id = ${warehouseFilter})
          and (${statusFilter}::text is null or status = ${statusFilter})
          and (${directionFilter}::text is null or direction = ${directionFilter})
      `;
      return { items: rows.map(toApi), total: Number(count), limit: query.limit, offset: query.offset };
    });
  }

  async get(actor: AuthenticatedUser, id: string) {
    const [row] = await withTenant(this.sql, actor.tenantId, (tx) => tx<GateEntryRow[]>`
      select ${tx.unsafe(SELECT_COLUMNS)} from gate_entries where id = ${id} and tenant_id = ${actor.tenantId}
    `);
    if (!row) throw new NotFoundException('Gate entry not found');
    return toApi(row);
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateGateEntryDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [before] = await tx<GateEntryRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from gate_entries
        where id = ${id} and tenant_id = ${actor.tenantId}
        for update
      `;
      if (!before) return null;
      if (before.status !== 'open') {
        throw new BadRequestException(`Cannot edit a gate entry in '${before.status}' status`);
      }

      if (dto.warehouseId) {
        const [warehouse] = await tx`select 1 from warehouses where id = ${dto.warehouseId} and tenant_id = ${actor.tenantId}`;
        if (!warehouse) throw new NotFoundException('Warehouse not found');
      }
      const customerId = dto.customerId !== undefined ? dto.customerId : before.customer_id;
      if (dto.customerId) {
        const [customer] = await tx`select 1 from customers where id = ${dto.customerId} and tenant_id = ${actor.tenantId}`;
        if (!customer) throw new NotFoundException('Customer not found');
      }

      const refs = await this.resolveRefs(tx, actor.tenantId, {
        vehicleId: dto.vehicleId !== undefined ? dto.vehicleId : (before.vehicle_id ?? undefined),
        vehicleNumber: dto.vehicleNumber !== undefined ? dto.vehicleNumber : (before.vehicle_number ?? undefined),
        driverId: dto.driverId !== undefined ? dto.driverId : (before.driver_id ?? undefined),
        driverName: dto.driverName !== undefined ? dto.driverName : (before.driver_name ?? undefined),
        driverMobile: dto.driverMobile !== undefined ? dto.driverMobile : (before.driver_mobile ?? undefined),
        transporterId: dto.transporterId !== undefined ? dto.transporterId : (before.transporter_id ?? undefined),
        transporterName: dto.transporterName !== undefined ? dto.transporterName : (before.transporter_name ?? undefined),
      });

      await tx`
        update gate_entries
        set warehouse_id = ${dto.warehouseId ?? before.warehouse_id},
            direction = ${dto.direction ?? before.direction},
            entry_at = ${dto.entryAt ?? before.entry_at},
            customer_id = ${customerId},
            vehicle_id = ${refs.vehicleId},
            vehicle_number = ${refs.vehicleNumber},
            driver_id = ${refs.driverId},
            driver_name = ${refs.driverName},
            driver_mobile = ${refs.driverMobile},
            transporter_id = ${refs.transporterId},
            transporter_name = ${refs.transporterName},
            purpose = ${dto.purpose ?? before.purpose},
            reference_no = ${dto.referenceNo !== undefined ? dto.referenceNo : before.reference_no},
            remarks = ${dto.remarks !== undefined ? dto.remarks : before.remarks},
            updated_by = ${actor.userId},
            updated_at = now()
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
      const [after] = await tx<GateEntryRow[]>`select ${tx.unsafe(SELECT_COLUMNS)} from gate_entries where id = ${id}`;
      return { before, after };
    });
    if (!result) throw new NotFoundException('Gate entry not found');

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'update',
      entityType: 'gate_entry',
      entityId: id,
      previousValue: result.before,
      newValue: result.after,
      ipAddress,
    });
    return toApi(result.after);
  }

  private async transition(
    actor: AuthenticatedUser,
    id: string,
    ipAddress: string | undefined,
    allowedFrom: string[],
    setClauseFor: (tx: postgres.TransactionSql, before: GateEntryRow) => Promise<void>,
  ) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [before] = await tx<GateEntryRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from gate_entries
        where id = ${id} and tenant_id = ${actor.tenantId}
        for update
      `;
      if (!before) return null;
      if (!allowedFrom.includes(before.status)) {
        throw new BadRequestException(
          `Cannot transition a gate entry from '${before.status}' (expected one of: ${allowedFrom.join(', ')})`,
        );
      }
      await setClauseFor(tx, before);
      const [after] = await tx<GateEntryRow[]>`select ${tx.unsafe(SELECT_COLUMNS)} from gate_entries where id = ${id}`;
      return { before, after };
    });
    if (!result) throw new NotFoundException('Gate entry not found');

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'status_change',
      entityType: 'gate_entry',
      entityId: id,
      previousValue: { status: result.before.status },
      newValue: { status: result.after.status },
      ipAddress,
    });
    return toApi(result.after);
  }

  /** Vehicle exit -- allowed from 'open' or 'linked' (an Inward may already have been created off this gate entry by the time the vehicle actually leaves). */
  close(actor: AuthenticatedUser, id: string, dto: CloseGateEntryDto, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['open', 'linked'], async (tx) => {
      await tx`
        update gate_entries set status = 'closed', exit_at = ${dto.exitAt ?? new Date().toISOString()}
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
    });
  }

  /** Only from 'open' -- once a downstream Inward exists ('linked') or the gate has closed, cancelling would orphan or contradict that record. */
  cancel(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['open'], async (tx) => {
      await tx`update gate_entries set status = 'cancelled' where id = ${id} and tenant_id = ${actor.tenantId}`;
    });
  }
}
