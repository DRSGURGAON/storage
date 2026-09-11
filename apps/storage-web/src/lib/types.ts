export interface BookingItem {
  id: string;
  lineNo: number;
  description: string;
  category: string | null;
  quantity: number;
  uomCode: string;
  packing: string | null;
  conditionNote: string | null;
  declaredValue: number | null;
  isFragile: boolean;
  releasedQty: number;
  inStorageQty: number;
  remarks: string | null;
}

export interface BookingCharge {
  id: string;
  description: string;
  quantity: number;
  rate: number;
  amount: number;
  chargedOn: string;
  invoicedAt: string | null;
}

export interface BookingMovement {
  id: string;
  number: string;
  direction: 'in' | 'out';
  movementDate: string;
  vehicleNumber: string | null;
  driverName: string | null;
  counterpartyName: string | null;
  counterpartyPhone: string | null;
  authorisationNote: string | null;
  remarks: string | null;
  status: string;
}

export interface Booking {
  id: string;
  number: string;
  customerId: string;
  customerName: string | null;
  warehouseId: string;
  warehouseName: string | null;
  storageUnitId: string | null;
  storageUnitCode: string | null;
  bookingDate: string;
  storageStartDate: string | null;
  expectedEndDate: string | null;
  actualEndDate: string | null;
  rentBasis: string;
  billableQuantity: number | null;
  monthlyRent: number;
  securityDeposit: number;
  minimumMonths: number;
  noticeDays: number;
  billingDay: number | null;
  customerSnapshot: { name?: string; mobile?: string | null; address?: Record<string, unknown> | null };
  pickupAddress: string | null;
  deliveryAddress: string | null;
  idProofType: string | null;
  idProofLast4: string | null;
  status: string;
  cancelReason: string | null;
  notes: string | null;
  items?: BookingItem[];
  charges?: BookingCharge[];
  movements?: BookingMovement[];
  declaredValueTotal?: number;
  oneTimeChargesTotal?: number;
}

export interface StorageUnit {
  id: string;
  warehouseId: string;
  warehouseName: string | null;
  code: string;
  name: string | null;
  unitType: string;
  areaSqft: number | null;
  volumeCbm: number | null;
  monthlyRate: number | null;
  status: string;
  isActive: boolean;
  occupiedBy?: string | null;
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  mobile: string | null;
  customerType: string | null;
}

export interface Godown {
  id: string;
  code: string;
  name: string;
}

export interface Paged<T> {
  total: number;
  items: T[];
}

export const ITEM_CATEGORIES = [
  { value: 'furniture', label: 'Furniture' },
  { value: 'appliance', label: 'Appliance' },
  { value: 'carton', label: 'Cartons / boxes' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'other', label: 'Other' },
];

export const ID_PROOF_TYPES = [
  { value: 'aadhaar', label: 'Aadhaar' },
  { value: 'driving_licence', label: 'Driving licence' },
  { value: 'voter_id', label: 'Voter ID' },
  { value: 'passport', label: 'Passport' },
  { value: 'other', label: 'Other' },
];
