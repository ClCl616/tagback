# 물품 반납 API 계약

작성: 2026-11-03. 작업 브랜치: `feat/item-return-history`.

## 반납 흐름

1. 키오스크에서 반납을 누르고 물품 태그를 실제로 인식한다.
2. 인식한 UID로 활성 태그와 현재 대여를 조회한다. 물품 ID를 직접 입력해 반납할 수 없다.
3. 확인 화면에는 UID 조회 결과에 연결된 물품과 대여 건을 표시한다. 사용자는 정상 또는 손상을 고른 뒤 확정한다.
4. 정상 반납은 물품을 `AVAILABLE`로, 손상 반납은 `INSPECTION`으로 전환하고 반납 이력에 선택한 상태를 저장한다. 손상 반납은 `inspections`에도 `RETURN` / `DAMAGED` 점검 접수로 기록한다.
5. 완료 화면에서 물품을 대여소 안의 안내된 반납 장소에 두도록 안내한다.

현재 API는 개발 프로필에서 로그인 세션을 확인한다. 키오스크와 백엔드의 실제 반납 화면 연동 및 현장 NFC 리더기 검증은 별도 작업이다.

## 태그 스캔 및 대여 조회

```http
POST /api/v1/rentals/return/scan
Cookie: __Host-tagback-session=<세션 값>
Origin: <허용된 프론트엔드 Origin>
Content-Type: application/json

{"tagUid":"04A23B1C5D6E80"}
```

서버는 활성 NFC 태그에 연결된 물품의 진행 중 대여를 찾는다. 진행 중 대여가 없거나 세션 사용자가 대여자가 아니면 확정할 수 없다. 성공 응답의 `rentalId`는 이 스캔에서 확인한 대여 건을 고정한다.

## 반납 확정

```http
POST /api/v1/rentals/return
Cookie: __Host-tagback-session=<세션 값>
Origin: <허용된 프론트엔드 Origin>
Content-Type: application/json

{
  "tagUid": "04A23B1C5D6E80",
  "rentalId": "101",
  "condition": "NORMAL"
}
```

`tagUid`는 실물 스캔값, `rentalId`는 반납 스캔 응답에서 받은 대여 ID, `condition`은 `NORMAL` 또는 `DAMAGED`다. 요청의 `itemId`만으로 반납할 수 없다. 서버는 태그가 활성 상태인지, 해당 물품의 현재 진행 중 대여 ID가 스캔 응답의 ID와 같은지, 세션 사용자가 그 대여자인지 확인한다.

물품 행 잠금 아래에서 대여·물품 상태·반납 상태·상태 이력을 한 트랜잭션으로 저장한다. 손상 반납은 `inspections`에 점검 접수를 함께 저장한다. 이력 저장에 실패하면 전체 반납을 롤백한다.

## 성공 응답

`200 OK`, `Cache-Control: no-store`:

```json
{
  "rentalId": "101",
  "itemId": "12",
  "rentalStatus": "RETURNED",
  "itemStatus": "AVAILABLE",
  "condition": "NORMAL",
  "rentedAt": "2026-10-14T03:00:00Z",
  "dueAt": "2026-10-17T03:00:00Z",
  "returnedAt": "2026-10-16T04:00:00Z"
}
```

`DAMAGED` 확정 응답은 `itemStatus: "INSPECTION"`, `condition: "DAMAGED"`를 반환한다. 시각은 서버가 정하며 연체였던 대여도 반납 뒤 `RETURNED`가 된다.

## 재시도와 충돌

- 반납 요청은 스캔 때 확인한 `rentalId`와 일치하는 진행 중 대여만 변경한다.
- 같은 물품을 새로 대여한 뒤 이전 요청이 재전송되어도 현재 대여 ID가 다르므로 `RENTAL_CHANGED`로 거부한다.
- 이미 반납된 대여의 재요청은 `RENTAL_NOT_ACTIVE`로 거부한다. 이전 요청을 새 대여에 적용하지 않는다.
- `tagUid`, `rentalId`, `condition`이 다른 미정의 필드는 거부한다. 숫자형 JSON ID와 쿼리 `userId`도 받지 않는다.

| HTTP | 코드 | 조건 |
|---|---|---|
| 400 | `INVALID_INPUT` | 잘못된 ID, 숫자형 JSON ID, 누락되거나 미정의된 필드, `userId` 쿼리 |
| 401 | `SESSION_REQUIRED`, `SESSION_EXPIRED`, `SESSION_REPLACED` | 로그인 세션 누락·만료·교체 |
| 403 | `FORBIDDEN` | 세션 사용자가 해당 대여자가 아님 또는 Origin 거부 |
| 404 | `ITEM_NOT_FOUND` | 태그에 연결된 물품이 없음 |
| 409 | `RENTAL_NOT_ACTIVE` | 진행 중 대여가 없음 |
| 409 | `RENTAL_CHANGED` | 스캔 이후 활성 대여나 태그 연결이 변경됨 |
| 409 | `RENTAL_STATE_CONFLICT` | 대여와 물품 상태가 일치하지 않음 |

이 문서는 새 계약을 기록한다. 반납 API와 실제 키오스크 UI 연결 및 통합 검증은 아직 완료되지 않았다.
