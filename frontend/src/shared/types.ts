export type ItemStatus = 'available' | 'rented' | 'inspection' | 'repair';
export type Station = { id: string; name: string; location: string };
export type Kind = {
  id: string;
  name: string;
  category: string;
  description: string;
  art: 'calculator' | 'umbrella' | 'battery' | 'cable' | 'generic';
};
export type Item = {
  id: string;
  label: string;
  name?: string;
  inventoryNumber?: string;
  kindId: string;
  stationId: string;
  tag: string;
  active: boolean;
  deleted?: boolean;
  status: ItemStatus;
  image?: string;
};
export type Rental = {
  id: string;
  userId: string;
  itemId: string;
  stationId: string;
  rentedAt: number;
  dueAt: number;
  returnedAt?: number;
  condition?: 'normal' | 'damaged';
};
export type User = {
  id: string;
  phone: string;
  name?: string;
  occupation?: string;
  pinHash?: string;
  passwordHash?: string;
};
export type SmsChallenge = { id: string; expiresAt: number; resendAt: number };
export type Code = { value: string; userId: string; expiresAt: number; used: boolean };
export type Grant = {
  token: string;
  userId: string;
  code: string;
  expiresAt: number;
  maskedPhone: string;
};
export type Catalog = { categories?: string[]; kinds: Kind[]; items: Item[]; stations: Station[] };
export type Receipt = { operationId: string; item: Item; rental: Rental; type: 'rent' | 'return' };
export type Fault = '' | 'network' | 'timeout' | 'save' | 'unknown' | 'conflict';
export type DemoControls = {
  reader: boolean;
  service: boolean;
  nextFault: Fault;
  nextTarget: 'any' | 'read' | 'auth' | 'verify' | 'scan' | 'save';
  sessionSeconds: number;
};
export interface ServiceApi {
  catalog(): Promise<Catalog>;
  logout(token: string): Promise<void>;
  me(token: string): Promise<{ phone: string; name: string; occupation: string }>;
  code(token: string, renew?: boolean): Promise<Code>;
  rentals(token: string): Promise<Rental[]>;
  verifyCode(value: string): Promise<Grant>;
  scan(
    tag: string,
    mode: 'rent' | 'return',
    kindId?: string,
  ): Promise<{ item: Item; rental?: Rental }>;
  rent(operationId: string, grant: Grant, itemId: string, kindId: string): Promise<Receipt>;
  returnItem(
    operationId: string,
    itemId: string,
    condition: 'normal' | 'damaged',
  ): Promise<Receipt>;
  operation(operationId: string): Promise<Receipt | null>;
}
