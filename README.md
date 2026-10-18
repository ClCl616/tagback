# TagBack

Vision-UP 2026-2 · 돌려조

NFC 태그로 공용물품을 식별하고 반출·반납, 이용 이력, 연체, 점검·수리 상태를 관리하는 서비스입니다.

## 현재 진행 상태 · 2026-10-18

현재 개발 결과는 [develop](https://github.com/ClCl616/tagback/tree/develop)에 통합합니다. 기본 브랜치 main은 초기 상태이며 배포 완료를 의미하지 않습니다. [구현·검증 현황](docs/project-status.md)을 기준으로 완료 범위와 남은 작업을 확인하세요.

## 개발 범위

- 사용자: 물품·대여소·재고 조회, 로그인, 내 대여 현황과 이력
- 현장: 사용자 인증, NFC 물품 조회, 대여·반납 확인과 기록
- 관리자: 물품·태그 등록, 대여 현황, 연체·점검·수리 관리

태그 인식과 대여 확정은 분리합니다. 서버 저장 성공 후 완료를 표시하며, 중복 대여·반납을 방지합니다.

## 구성

| 디렉터리 | 용도 | 기술/상태 |
|---|---|---|
| `frontend/` | 모바일 사용자·공용 키오스크 화면 | React + TypeScript + Vite, 사용자·키오스크·관리자 mock 화면 및 인증 HTTP 어댑터 구현 |
| `backend/` | 인증·물품·대여·태그 API | Spring Boot·PostgreSQL·Flyway, 인증·권한·물품·태그·반출·본인 대여 조회 API 구현 |
| `nfc/` | 리더기·키오스크 연동 | develop은 구조·계획, 브리지·키오스크 HTTP 연동은 PR #20 검토 중 |
| `docs/` | 설계·결정·개발 기록 | 팀 합의 사항 기록 |

프론트엔드 실행과 테스트는 [frontend/README.md](frontend/README.md)를 참고하세요. 기본은 브라우저 mock이며 `VITE_AUTH_MODE=http`에서 인증 HTTP 어댑터를 사용합니다. 관리자 화면은 DEV 전용 mock이고 물품 관리·본인 대여 조회의 실제 화면 연결은 남아 있습니다. 실제 SMS와 실물 NFC 전체 연동 검증은 미완료입니다. 백엔드는 [DB 설정 안내](docs/database-setup.md)와 기능별 계약을 참고하세요.

현재 이용 구조는 모바일 조회·인증과 현장 키오스크·외장 리더기입니다. 신청서의 스마트폰 직접 NFC 인식은 초기 계획으로 구분합니다. 태그 인식만으로 대여를 확정하지 않습니다.

## 담당

| 담당 | 주요 영역 |
|---|---|
| 안치우 | 팀장, 일정, 프론트엔드, UI/UX, 기능 통합 |
| 유나경 | 백엔드, 인증·권한, 데이터베이스, 물품·대여 관리 |
| 윤종민 | NFC 연동, 태그 등록·물품 연결, 관련 API·예외 처리 |

## 협업

`develop → 작업 브랜치 → PR → CI·팀장 검토 → develop 병합`

- 최신 `develop`에서 `feat/`, `fix/`, `docs/`, `chore/` 브랜치를 만듭니다. 통합 검증을 마친 버전은 별도 PR로 `main`에 반영합니다.
- 하나의 PR에는 하나의 작업을 담고 변경 내용과 검증 결과를 작성합니다.
- develop 대상 PR은 팀장(치우)이 직접 승인·병합합니다. 검증 범위는 PR에 명시합니다.
- API·DB·태그 입력 규격은 관련 담당자와 먼저 합의합니다.
- 위 규칙은 팀 운영 규칙이며 GitHub 보호 설정의 적용을 의미하지 않습니다.

자세한 내용은 [기여 안내](CONTRIBUTING.md)를 확인하세요.

자동 빌드·테스트와 필수 검사 설정은 [CI 안내](docs/ci.md)를 참고하세요.

## 문서

- [현재 전화번호·PIN 인증 및 브라우저 등록](docs/pin-auth.md)
- [프론트와 서버 인증 API 계약](docs/auth-api-contract.md)
- [물품 반출 API 계약 초안](docs/item-checkout-api-contract.md)
- [본인 대여 현황 조회 API 계약](docs/rental-status-api-contract.md)

- [모바일 인증·단일 대여소 및 연동 계약](docs/mobile-auth-catalog.md)

- [결정 기록](docs/decisions.md)
- [5·6주차 계획](docs/weeks-05-06.md)
- [서비스 UI 요구사항·흐름·미정 정책](docs/service-ui.md)
- [서비스 UI 검증 결과](docs/service-ui-verification.md)

신청서 원본, 연락처·학번이 포함된 문서, 개인 사진, 인증 정보는 이 저장소에 포함하지 않습니다.
