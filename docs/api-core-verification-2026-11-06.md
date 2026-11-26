# 백엔드 API 핵심 동작 검증

- 실행일: 2026-11-06 (Asia/Seoul)
- 브랜치·커밋: `feature/search-filter-query`, `482daff6ad8cf5770942b133cf8317ee4bed79d3`
- 명령: backend 디렉터리에서 `& ./scripts/test-all-postgres.ps1 -ItemPort 55449`
- 결과: 전체 287개, 실패 0개, 오류 0개, 건너뜀 0개. 동시 태그 등록 두 시나리오는 각각 20회 포함.
- 환경: 독립적인 임시 PostgreSQL 17 두 개와 테스트 데이터. 인증은 개발용 `sms-mock`. 데이터베이스 접속 및 Flyway 마이그레이션을 포함한다.

## 항목별 검증 범위

| 항목 | 확인된 동작 | 근거 테스트 |
|---|---|---|
| 인증 | 가입과 세션 쿠키 생성, 전화번호·PIN 로그인, 로그아웃, 유휴·절대 세션 만료 | `SignupApiIntegrationTest`, `LoginApiIntegrationTest`, `SessionApiIntegrationTest` |
| 권한 | 미인증·일반 사용자·관리자 접근 제한, 세션 권한 변경 반영, Origin 검사 | `ItemCrudPostgresIntegrationTest`, `AdminQueryApiTest`, `RentalApiPostgresIntegrationTest` |
| 물품 | 등록·상세·수정·삭제, 관리자 상태 변경과 상태 이력, 진행 중 대여 및 연관 이력 제한 | `ItemCrudPostgresIntegrationTest`, `ItemStatusApiTest` |
| 검색 | 물품명·종류·상태 단독 및 복합 검색, 활성 태그, 비활성 태그 제외, 빈 결과와 페이지 | `ItemCrudPostgresIntegrationTest` |
| 태그 | 등록·조회·교체·해제, 활성·비활성 UID, 중복 및 동시 등록 | `TagRegistrationIntegrationTest`, `TagLifecycleIntegrationTest`, `TagRegistrationConcurrencyIntegrationTest` |
| 대여·반납 | 코드 발급·인증, 반출·반납 저장, 물품 상태·대여·이력, 중복 요청 및 동시성 | `RentalApiPostgresIntegrationTest`, `RentalCheckoutPostgresIntegrationTest`, `RentalRepositoryIntegrationTest` |
| 예외 | 잘못된 입력·없는 물품·중복 요청·다른 물품 태그·진행 중 또는 연체 대여 충돌 등 | `ItemCrudPostgresIntegrationTest`, `TagLifecycleIntegrationTest`, `RentalApiPostgresIntegrationTest` |

위 결과는 테스트에 구현된 조건의 자동 검증이다. 일부 API 테스트는 MockMvc 또는 서비스 수준에서 수행하며 실제 외부 HTTP 서버에서 전체 API를 한 흐름으로 호출한 결과가 아니다. 실제 SMS 제공자·운영 인증·실물 NFC 리더기와 프론트·백엔드·NFC 전체 연결 검증은 포함하지 않는다. 과거 검색 관리자 화면과 반납의 별도 실제 서버 브라우저 테스트 기록은 해당 기능 문서를 참고한다.
