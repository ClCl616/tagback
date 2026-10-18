// Explicit opt-in: local simulator and CI remain the default.
export const KIOSK_BRIDGE = import.meta.env.VITE_KIOSK_MODE === 'bridge';
