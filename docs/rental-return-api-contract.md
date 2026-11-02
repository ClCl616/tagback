# 물품 반납 API 계약

작성: 2026-11-02. 작업 브랜치: `feat/item-return-history`.

현재 상태: 개발 프로필용 사용자 세션 반납 API와 서버 처리를 구현했다. 실제 키오스크·프론트엔드 연동은 아직 완료되지 않았다.

## 1. 범위와 권한

- 로그인한 대여자 본인이 자신의 진행 중 대여만 반납할 수 있다.
- 서버가 검증한 세션의 사용자 ID를 사용한다. 요청 본문이나 쿼리의 `userId`는 받지 않는다.
- 반출 시 소비된 대여 코드·반출 토큰은 반납 인증으로 재사용하지 않는다. 이 API는 사용자 세션만 받으며 키오스크 반출 토큰을 허용하지 않는다.
- 사용자의 세션 쿠키를 공유 키오스크에 복사하지 않는다. 현재 API를 키오스크 흐름과 연결하려면 NFC로 확인한 `itemId`를 사용자 세션이 있는 클라이언트에 안전하게 전달해야 한다.
- API는 현재 `sms-mock & !prod & !production` 프로필에서만 제공된다. 운영 세션 인증과 실물 키오스크 연결은 별도 검증이 필요하다.

## 2. 요청

```http
POST /api/v1/rentals/return
Cookie: __Host-tagback-session=<세션 값>
Origin: <허용된 프론트엔드 Origin>
Content-Type: application/json

{
  "itemId": "12"
}
```

`itemId`는 NFC 조회로 확인한 양의 BIGINT 범위의 10진 문자열이다. 숫자형 JSON 값, `userId`, `returnedAt` 등 미정의 필드는 거부한다. 요청 시각은 받지 않으며 서버가 반납 시각을 정한다.

서버는 물품 행을 잠근 뒤 해당 물품의 진행 중 대여(`returned_at IS NULL`)를 찾고, 대여자 ID가 세션 사용자와 같은지 확인한다. 반출 전용 Bearer 토큰을 보내도 세션을 대신할 수 없다.

## 3. 성공 응답

`200 OK`, `Cache-Control: no-store`:

```json
{
  "rentalId": "101",
  "itemId": "12",
  "rentalStatus": "RETURNED",
  "itemStatus": "AVAILABLE",
  "rentedAt": "2026-10-14T03:00:00Z",
  "dueAt": "2026-10-17T03:00:00Z",
  "returnedAt": "2026-10-16T04:00:00Z"
}
```

반납 시각은 서버 시각(UTC)이며, 연체였던 대여도 반납 완료 후 `RETURNED`다. 대여, 물품 상태 변경, `RENTAL_FLOW` 상태 이력은 하나의 트랜잭션으로 저장한다.

## 4. 오류

| HTTP | 코드 | 조건 |
|---|---|---|
| 400 | `INVALID_INPUT` | 잘못된 ID, 숫자 ID, 미정의 요청 필드, `userId` 쿼리 |
| 401 | `SESSION_REQUIRED`, `SESSION_EXPIRED`, `SESSION_REPLACED` | 로그인 세션 누락·만료·교체 |
| 403 | `FORBIDDEN` | 세션 사용자가 해당 대여자가 아님 또는 Origin 거부 |
| 404 | `ITEM_NOT_FOUND` | 물품이 없음 |
| 409 | `RENTAL_NOT_ACTIVE` | 반납할 진행 중 대여가 없음(이미 반납된 경우 포함) |
| 409 | `RENTAL_STATE_CONFLICT` | 진행 중 대여가 있으나 물품 상태가 `RENTED`가 아님 |

요청을 다시 보내도 기존 성공 응답을 재생하지 않는다. 이미 반납된 물품의 재요청은 `RENTAL_NOT_ACTIVE`로 거부한다. 별도의 재시도·멱등성 정책은 후속 검증 항목이다.

## 5. 검증

2026-11-02 `backend/scripts/test-item-postgres.ps1 -Port 55441` 실행 결과: 139개 통과, 실패·오류·건너뜀 0. 임시 PostgreSQL에서 기존 Flyway 스키마를 적용해 검증했고 테스트 서버를 종료했다.

- 연체 대여 반납 후 `returned_at`, `RETURNED`, 물품 `AVAILABLE`, 대여자와 `RENTAL_FLOW` 상태 이력이 함께 저장되는지 확인했다.
- 상태 이력 저장을 DB 제약으로 실패시켜 반납 시각·대여 상태·물품 상태가 모두 롤백되는지 확인했다. 제약 제거 후 재시도 성공도 확인했다.
- HTTP 세션 누락, 다른 사용자, 잘못된 입력을 거부하고, 대여자 본인의 반납은 정상 응답과 저장 결과를 반환하는지 확인했다.
- 이미 반납된 건의 재요청·멱등성 동작은 별도 중복 반납 방지 작업에서 검증한다.
