import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { AddMemberDto } from './dto/add-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';

interface MemberRow {
  id: string;
  user_id: string;
  email: string;
  full_name: string;
  role_code: string;
  role_name: string;
  status: string;
  warehouse_ids: string[] | null;
  customer_id: string | null;
  created_at: Date;
}

const MEMBER_SELECT = `
  tu.id, tu.user_id, u.email, u.full_name, r.code as role_code, r.name as role_name,
  tu.status, tu.warehouse_ids, tu.customer_id, tu.created_at`;
const MEMBER_FROM = `
  from tenant_users tu
  join users u on u.id = tu.user_id
  join roles r on r.id = tu.role_id`;

/**
 * Phase 1's "invite users, assign roles" deliverable. There is no email
 * delivery until the notification engine (V1.1), so an admin sets a new
 * account's initial password here instead of an emailed set-password
 * link -- a real, working flow, not a placeholder for one. An email that
 * already has an account (one identity, many tenants -- tenancy-and-
 * security.md §3) just gains a membership; its password is untouched.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthenticatedUser) {
    const rows = await withTenant(this.sql, actor.tenantId, (tx) => tx<MemberRow[]>`
      select ${tx.unsafe(MEMBER_SELECT)} ${tx.unsafe(MEMBER_FROM)}
      where tu.tenant_id = ${actor.tenantId}
      order by u.full_name
    `);
    return rows.map(toApi);
  }

  async addMember(actor: AuthenticatedUser, dto: AddMemberDto, ipAddress?: string) {
    const [role] = await this.sql<{ id: string }[]>`
      select id from roles where code = ${dto.roleCode} and tenant_id is null
    `;
    if (!role) throw new BadRequestException('Unknown role');

    // tenancy-and-security.md §2: a portal login is a `customer` membership
    // with a mandatory `customer_id`. Both halves are enforced here -- a
    // customer membership without one would be a portal session that could
    // see the whole tenant, and a staff membership with one would suggest a
    // scoping that nothing applies.
    if (dto.roleCode === 'customer') {
      const portalCustomerId = dto.customerId;
      if (!portalCustomerId) throw new BadRequestException('A customer (portal) membership needs a customerId');
      const found = await withTenant(this.sql, actor.tenantId, (tx) => tx`
        select 1 from customers where id = ${portalCustomerId} and tenant_id = ${actor.tenantId}
      `);
      if (found.length === 0) throw new NotFoundException('Customer not found');
      if (dto.warehouseIds?.length) throw new BadRequestException('A portal membership is scoped by customer, not by warehouse');
    } else if (dto.customerId) {
      throw new BadRequestException(`customerId applies only to a 'customer' (portal) membership`);
    }

    // users is global identity (no RLS); tenant_users is tenant-scoped.
    const [existing] = await this.sql<{ id: string }[]>`
      select id from users where email = ${dto.email}
    `;

    // Hashed either way, and discarded when the account already exists.
    // The wasted work is the point: branching on `existing` here would
    // make the response time say whether the address is registered
    // somewhere on the platform -- the same oracle the DTO change closes
    // on the validation side. An existing account's own password is never
    // touched.
    const passwordHash = await argon2.hash(dto.password);
    let member: MemberRow;
    try {
      member = await withTenant(this.sql, actor.tenantId, async (tx) => {
        let userId = existing?.id;
        if (!userId) {
          userId = randomUUID();
          await tx`
            insert into users (id, email, full_name, password_hash)
            values (${userId}, ${dto.email}, ${dto.fullName}, ${passwordHash})
          `;
        }
        const membershipId = randomUUID();
        await tx`
          insert into tenant_users (id, tenant_id, user_id, role_id, warehouse_ids, customer_id, status, invited_at)
          values (${membershipId}, ${actor.tenantId}, ${userId}, ${role.id},
                  ${dto.warehouseIds ?? null}, ${dto.customerId ?? null}, 'active', now())
        `;
        const [row] = await tx<MemberRow[]>`
          select ${tx.unsafe(MEMBER_SELECT)} ${tx.unsafe(MEMBER_FROM)}
          where tu.id = ${membershipId} and tu.tenant_id = ${actor.tenantId}
        `;
        return row;
      });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException('That user is already a member of this workspace');
      }
      throw err;
    }

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'create',
      entityType: 'tenant_user',
      entityId: member.id,
      newValue: { email: member.email, roleCode: member.role_code, warehouseIds: member.warehouse_ids },
      ipAddress,
    });
    return toApi(member);
  }

  async updateMember(
    actor: AuthenticatedUser,
    membershipId: string,
    dto: UpdateMemberDto,
    ipAddress?: string,
  ) {
    if (membershipId === actor.tenantUserId) {
      // Changing your own role or disabling yourself is the classic
      // self-lockout; another owner/admin has to do it.
      throw new BadRequestException('You cannot change your own membership');
    }

    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [before] = await tx<MemberRow[]>`
        select ${tx.unsafe(MEMBER_SELECT)} ${tx.unsafe(MEMBER_FROM)}
        where tu.id = ${membershipId} and tu.tenant_id = ${actor.tenantId}
        for update of tu
      `;
      if (!before) return null;

      const demotingOwner =
        before.role_code === 'owner' && before.status === 'active' &&
        ((dto.roleCode && dto.roleCode !== 'owner') || dto.status === 'disabled');
      if (demotingOwner) {
        const [{ owners }] = await tx<{ owners: string }[]>`
          select count(*)::text as owners from tenant_users tu
          join roles r on r.id = tu.role_id
          where tu.tenant_id = ${actor.tenantId} and r.code = 'owner' and tu.status = 'active'
        `;
        if (Number(owners) <= 1) {
          throw new BadRequestException('A workspace must keep at least one active Owner');
        }
      }

      const patch: Record<string, unknown> = {};
      if (dto.roleCode) {
        const [role] = await tx<{ id: string }[]>`
          select id from roles where code = ${dto.roleCode} and tenant_id is null
        `;
        patch.role_id = role.id;
      }
      if (dto.status) patch.status = dto.status;
      if (dto.warehouseIds !== undefined) {
        patch.warehouse_ids = dto.warehouseIds.length ? dto.warehouseIds : null;
      }
      if (Object.keys(patch).length === 0) return { before, after: before };

      await tx`
        update tenant_users set ${tx(patch)}
        where id = ${membershipId} and tenant_id = ${actor.tenantId}
      `;
      const [after] = await tx<MemberRow[]>`
        select ${tx.unsafe(MEMBER_SELECT)} ${tx.unsafe(MEMBER_FROM)}
        where tu.id = ${membershipId} and tu.tenant_id = ${actor.tenantId}
      `;
      return { before, after };
    });
    if (!result) throw new NotFoundException('Member not found');

    if (result.before !== result.after) {
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        userRoleCode: actor.roleCode,
        action: 'update',
        entityType: 'tenant_user',
        entityId: membershipId,
        previousValue: summarize(result.before),
        newValue: summarize(result.after),
        ipAddress,
      });
    }
    return toApi(result.after);
  }
}

function summarize(m: MemberRow) {
  return { roleCode: m.role_code, status: m.status, warehouseIds: m.warehouse_ids, customerId: m.customer_id };
}

function toApi(m: MemberRow) {
  return {
    id: m.id,
    userId: m.user_id,
    email: m.email,
    fullName: m.full_name,
    role: { code: m.role_code, name: m.role_name },
    status: m.status,
    warehouseIds: m.warehouse_ids ?? [],
    customerId: m.customer_id,
    createdAt: m.created_at,
  };
}
