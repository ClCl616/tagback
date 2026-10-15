# 본인 대여 현황 조회 API 계약

작성: 2026-10-14. 작업 브랜치: `feat/rental-due-status`.

현재 상태: 서버 조회 API와 연체 응답 판정을 구현했다. 기존 [물품 반출 API 계약](item-checkout-api-contract.md)의 저장된 `dueAt`을 사용한다.
프론트엔드 연동 전 경로와 DTO를 담당자와 공유한다. 운영 인증과 프론트엔드 연동은 아직 완료되지 않았다.

## 1. 범위

- 로그인한 사용자의 진행 중 대여와 지난 대여 이력을 조회한다.
- 저장된 반납 예정일을 반환하고, 미반납 대여의 연체 여부를 조회 시각에 판정한다.
- 반납 처리, 예정일 연장·변경, 관리자용 사용자별 조회는 이번 API에 포함하지 않는다.
- 요청의 `userId`나 전화번호로 조회 대상을 지정하지 않는다. 서버가 검증한 로그인 세션의 사용자 ID만 사용한다. `userId` 쿼리 파라미터는 400으로 거부한다.

## 2. 요청과 인증

```http
GET /api/v1/rentals/me?scope=ACTIVE&page=0&size=20
Cookie: __Host-tagback-session=<세션 값>
```

키오스크 반출 전용 Bearer 토큰은 이 조회 API의 인증 수단이 아니다. 본인 대여 정보이므로 성공 응답과 오류 응답에 `Cache-Control: no-store`를 적용한다.
현재 서버의 로그인 세션 인증은 `sms-mock & !prod & !production` 프로필에서 제공된다. 운영 인증을 연결하기 전에는 인증을 우회해 조회를 공개하지 않는다.

| 파라미터 | 규칙 |
|---|---|
| `scope` | `ACTIVE` 또는 `HISTORY`. 생략 시 `ACTIVE`. 다른 값은 400. |
| `page` | 0부터 시작. 기본 0. 음수·정수 범위 초과는 400. |
| `size` | 기본 20. 허용 범위 1~100. 그 밖은 400. |

`ACTIVE`는 `returned_at IS NULL`인 대여이며, `RENTED`와 연체 대여를 모두 포함한다. `HISTORY`는 `returned_at IS NOT NULL`인 대여다. DB의 `status` 값만으로 두 목록을 나누지 않는다.
지난 대여 요청은 `GET /api/v1/rentals/me?scope=HISTORY&page=0&size=20`이다.

## 3. 정렬과 페이지네이션

- `ACTIVE`: `dueAt` 오름차순, 같으면 `rentalId` 내림차순. 반납 예정이 빠른 대여를 먼저 보여준다.
- `HISTORY`: `returnedAt` 내림차순, 같으면 `rentalId` 내림차순.
- 응답에는 현재 조건에 맞는 `totalElements`, `totalPages`를 포함한다. 범위를 벗어난 페이지는 200과 빈 `rentals`를 반환한다.
- `page * size`가 서버의 조회 오프셋 범위를 넘으면 400으로 거부한다. 여러 페이지를 순차 조회하는 동안 대여·반납 데이터가 바뀌면 페이지 간 결과가 달라질 수 있다.

## 4. 성공 응답

`200 OK`. ID는 기존 반출 API와 같이 문자열, 시각은 UTC ISO 8601 문자열이다.

```json
{
  "rentals": [
    {
      "rentalId": "101",
      "itemId": "12",
      "itemName": "우산 01",
      "itemTypeId": "3",
      "itemTypeName": "우산",
      "rentalStatus": "OVERDUE",
      "rentedAt": "2026-10-11T03:00:00Z",
      "dueAt": "2026-10-14T03:00:00Z",
      "returnedAt": null
    }
  ],
  "page": 0,
  "size": 20,
  "totalElements": 1,
  "totalPages": 1,
  "evaluatedAt": "2026-10-14T03:00:01Z"
}
```

지난 대여의 항목은 같은 필드를 사용하며, 예를 들어 `rentalStatus: "RETURNED"`와 `returnedAt: "2026-10-14T04:00:00Z"`를 반환한다.

| 필드 | 의미 |
|---|---|
| `rentalId`, `itemId`, `itemTypeId` | 대여·개별 물품·물품 종류 ID. 모두 문자열. |
| `itemName`, `itemTypeName` | 조회 시점의 현재 물품·종류 이름. 대여 시점 이름의 별도 스냅샷은 없다. |
| `rentedAt`, `dueAt`, `returnedAt` | DB에 저장된 시각. 미반납이면 `returnedAt: null`. |
| `rentalStatus` | 아래 규칙으로 조회 시점에 계산한 `RENTED`, `OVERDUE`, `RETURNED`. |
| `evaluatedAt` | 이 응답의 연체 판정에 사용한 서버 시각. |

`returnedAt`이 있으면 `RETURNED`다. 미반납이고 `evaluatedAt`이 `dueAt`을 **지난** 경우에만 `OVERDUE`, 그 외에는 `RENTED`다. 예정일과 정확히 같은 시각은 아직 `RENTED`다. 조회 응답의 상태는 저장된 `status`보다 `returned_at`과 `due_at`을 우선해 계산한다. 이 API는 예약 작업이나 DB 상태 전이를 실행하지 않으며 `status`와 `due_at`을 변경하지 않는다. 이번 범위에서는 과거에 연체했던 반납 건을 별도 상태로 표시하지 않는다. 화면을 오래 열어 둔 경우 다시 조회해야 최신 연체 상태를 확인할 수 있다.

결과가 없으면 `rentals: []`, `totalElements: 0`, `totalPages: 0`이다. `stationId`와 반납 물품 상태(`condition`)는 현재 서버 대여 테이블에 없으므로 이 응답에 넣지 않는다. 기존 모바일 mock 화면의 대여소 표시는 단일 대여소 매핑과 함께 프론트엔드 연동 시 정한다.

## 5. 오류

| HTTP | 코드 | 상황 |
|---|---|---|
| 400 | `INVALID_INPUT` | `scope`, `page`, `size`가 허용 범위를 벗어나거나 `userId` 파라미터가 있음 |
| 401 | `SESSION_REQUIRED` | 세션 쿠키 누락·무효, 로그아웃 등으로 사용할 수 없는 세션 |
| 401 | `SESSION_EXPIRED` | 세션 또는 브라우저 등록 유효기간 만료 |
| 401 | `SESSION_REPLACED` | 다른 브라우저 로그인으로 기존 세션 교체 |

오류 본문은 기존 `{ "error": { "code", "message", "retryAt" } }` 형식을 따른다. 다른 사용자의 대여 ID를 조회하는 경로는 제공하지 않는다.

## 6. 검증 결과와 연동 메모

2026-10-14에 `backend`에서 `.\scripts\test-item-postgres.ps1`을 실행해 임시 PostgreSQL·Flyway 스키마에서 관련 백엔드 테스트가 통과했다. 주요 검증은 다음과 같다.

- 로그인 세션 누락 시 401, 요청 `userId` 거부, 두 사용자 사이 대여 목록 분리, 빈 목록.
- `ACTIVE`·`HISTORY` 구분, 물품 정보·예정일 응답, 정렬·페이지네이션, 잘못된 조회 파라미터 거부.
- 예정일 직전·정확히 같은 시각·직후의 상태, 반납 시각 우선 판정, 조회 후 DB의 `status`·`due_at` 불변.

프론트엔드 HTTP 연동과 운영용 인증은 아직 구현되지 않았다. 현재 반납 API도 없으므로 `HISTORY` HTTP 테스트는 DB에 반납 시각을 설정해 검증했다. 모바일 mock의 `stationId`·`condition`은 이 서버 응답에 없는 데이터다.
