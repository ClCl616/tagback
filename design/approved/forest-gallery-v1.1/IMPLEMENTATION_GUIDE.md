# 구현 지침
1. 기존 AI 에이전트 규칙, UI/UX 지침, 기술 스택, 인증, 라우트, 데이터 모델, API, NFC/거래 처리 분석. 충돌과 미확정 사항 기록. 기존 기능/보안 유지.
2. 토큰 및 공통 컴포넌트를 우선 적용. Button, Input, SearchInput, Select, Switch, StatusBadge, ItemCard, Modal, Alert, EmptyState 등 역할에 맞춰 기존 구성 활용. 이름/디렉터리 강제 금지.
3. 사용자 웹 PC 및 모바일은 동일 데이터와 기능 사용. 모바일 전용 하단 메뉴/안전 영역 및 반응형 적용. 카카오 로그인만. 통합 코드는 전역 접근 기능으로 물품 상세에서 동일 기능으로 이동.
4. 관리자 전용 AdminSidebar, DataTable, TableToolbar, Pagination, MetricSummary, ItemForm, ConfirmDialog, DetailPanel. 종류/개별 실물/거래 단위를 명확하게 구분. 연체는 미반납의 부분집합이며 비율 차트 중복 금지. 실제 지표만 표시. 기존 권한 및 개인정보 최소화.
5. 키오스크 KioskShell, StepIndicator, TouchKeypad, CodeInput, NFCReaderGuide, ItemConfirmation, ConditionSelector, TransactionResult, KioskActionBar, ErrorRecovery를 기존 구성과 통합. 단계 변경은 검증 성공에 의해서만. 안전한 취소/복귀와 세션 초기화. 처리 결과 불명확 시 기존 요청 확인 우선; 상태 조회 지원 없으면 관리자 안내, 무조건 재시도 금지.
6. 각 화면별 명세에 적힌 이미지 오류를 교정한다. 시안에 없는 기존 필수 기능도 보존한다. 불필요한 기능/의미 없는 UI 추가 금지. 신규 API/DB/인증 변경이 필요하면 별도 검토 및 사용자 결정 요청.
7. 실제 렌더링 및 테스트: 사용자 PC 1440×900, 모바일 390×844와 인접 breakpoint, 관리자 PC 1440×900, 키오스크 1920×1080 및 DPI. 실제 화면 캡처로 정렬/문구/공통 스타일 확인. 오류 상태/긴 텍스트/빈 데이터/권한/서버 처리 검증. 발견 문제 범위 내 직접 수정하고 재검수. 테스트 결과, 변경 파일, 남은 제한 및 재현 절차 보고. 실행 불가한 환경은 명시하고 성공으로 표시하지 않는다.
