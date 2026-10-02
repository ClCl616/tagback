import type { Catalog, Code, Grant, Rental, User, Receipt } from './types';
export type Database = Catalog & {
  users: User[];
  sessions: Record<string, string>;
  codes: Code[];
  grants: Grant[];
  rentals: Rental[];
  operations: Record<string, Receipt>;
};
export const kinds: Catalog['kinds'] = [
  {
    id: 'calc',
    name: '공학용 계산기',
    category: '학습 용품',
    description: '복잡한 계산도 가볍게. 수업과 실습에 필요한 공학용 계산기를 함께 사용해 보세요.',
    art: 'calculator',
  },
  {
    id: 'umbrella',
    name: '공용 우산',
    category: '생활 용품',
    description: '갑작스러운 비에도 괜찮아요. 튼튼한 장우산이 준비되어 있어요.',
    art: 'umbrella',
  },
  {
    id: 'battery',
    name: '보조배터리',
    category: '전자 기기',
    description: '배터리가 부족한 순간, 하루를 이어 주는 휴대용 충전기예요.',
    art: 'battery',
  },
  {
    id: 'cable',
    name: 'USB-C 케이블',
    category: '전자 기기',
    description: '충전과 연결이 필요할 때, 가까운 대여소에서 빌려 보세요.',
    art: 'cable',
  },
];
export function seed(passwordHash: string): Database {
  const now = Date.now();
  return {
    kinds,
    stations: [
      { id: 'engineering', name: '공학관 대여소', location: '공학관 1층 · 학생 라운지' },
      { id: 'library', name: '중앙도서관 대여소', location: '중앙도서관 1층 · 안내 데스크 옆' },
    ],
    items: [
      ...Array.from({ length: 8 }, (_, i) => ({
        id: `calc-${i + 1}`,
        label: `계산기 ${String(i + 1).padStart(3, '0')}`,
        kindId: 'calc',
        stationId: 'engineering',
        tag: `CALC-${i + 1}`,
        active: i !== 7,
        status: (i === 5 ? 'rented' : i > 5 ? 'inspection' : 'available') as
          'rented' | 'inspection' | 'available',
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        id: `umbrella-${i + 1}`,
        label: `우산 ${String(i + 1).padStart(3, '0')}`,
        kindId: 'umbrella',
        stationId: 'engineering',
        tag: `UMBRELLA-${i + 1}`,
        active: true,
        status: 'available' as const,
      })),
      {
        id: 'battery-1',
        label: '보조배터리 001',
        kindId: 'battery',
        stationId: 'engineering',
        tag: 'BATTERY-1',
        active: true,
        status: 'rented',
      },
      {
        id: 'cable-1',
        label: '케이블 001',
        kindId: 'cable',
        stationId: 'engineering',
        tag: 'CABLE-1',
        active: true,
        status: 'available',
      },
      {
        id: 'calc-9',
        label: '계산기 009',
        kindId: 'calc',
        stationId: 'library',
        tag: 'CALC-9',
        active: true,
        status: 'available',
      },
    ],
    users: [{ id: 'demo', phone: '01012345678', passwordHash }],
    sessions: {},
    codes: [],
    grants: [],
    operations: {},
    rentals: [
      {
        id: 'seed-active',
        userId: 'demo',
        itemId: 'calc-6',
        stationId: 'engineering',
        rentedAt: now - 86400000,
        dueAt: now + 172800000,
      },
      {
        id: 'seed-overdue',
        userId: 'demo',
        itemId: 'battery-1',
        stationId: 'engineering',
        rentedAt: now - 432000000,
        dueAt: now - 172800000,
      },
      {
        id: 'seed-history',
        userId: 'demo',
        itemId: 'umbrella-1',
        stationId: 'engineering',
        rentedAt: now - 864000000,
        dueAt: now - 604800000,
        returnedAt: now - 691200000,
        condition: 'normal',
      },
    ],
  };
}
