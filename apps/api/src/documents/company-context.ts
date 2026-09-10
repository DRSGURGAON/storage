import type postgres from 'postgres';
import { CompanyContext } from './html/layout';

/** Shared by every document type's template -- the letterhead data is the same regardless of what's being rendered. */
export async function loadCompanyContext(tx: postgres.TransactionSql, tenantId: string): Promise<CompanyContext> {
  const [row] = await tx<
    {
      legal_name: string;
      trade_name: string | null;
      address_line1: string | null;
      address_line2: string | null;
      city: string | null;
      state: string | null;
      pincode: string | null;
      gstin: string | null;
      phone: string | null;
      email: string | null;
      is_demo: boolean;
    }[]
  >`
    select legal_name, trade_name, address_line1, address_line2, city, state, pincode, gstin, phone, email, is_demo
    from tenants where id = ${tenantId}
  `;
  return {
    legalName: row.legal_name,
    tradeName: row.trade_name,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    gstin: row.gstin,
    phone: row.phone,
    email: row.email,
    isDemo: row.is_demo,
  };
}
