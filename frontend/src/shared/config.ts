// Kiosk interaction settings and the configured single service location.
export const KIOSK = {
  codeLength: 6,
  sessionSeconds: 180,
  completionSeconds: 12,
  stationId: 'engineering',
} as const;
export const STATION = {
  id: KIOSK.stationId,
  name: '대전대 융합과학관',
  location: '융합과학관 2층 학생 라운지',
};
