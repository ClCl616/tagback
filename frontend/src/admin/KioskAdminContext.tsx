import { createContext, useContext } from 'react';
export const KioskAdminContext = createContext<{
  token: string;
  reauthenticate: (password: string) => Promise<string>;
  lock: (locked: boolean) => void;
} | null>(null);
export const useKioskAdmin = () => useContext(KioskAdminContext);
