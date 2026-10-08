# NFC 태그 등록·물품 연결 (5주차)

이 문서는 NFC 태그 등록 API 초안이다. API 경로와 UID 규칙은 팀 합의 전이다.

## 현재 범위

- `POST /api/items/{itemId}/tag`로 기존 물품에 NFC UID를 연결한다.
- 등록 API는 세션 인증이 필요하며 `ADMIN` 역할만 호출할 수 있다. 세션이 없거나 유효하지 않으면 `401`, 일반 `USER`이면 `403`을 반환한다.
- UID는 양끝 공백과 내부 공백·콜론·하이픈을 제거한 뒤 대문자로 저장한다.
- 허용 길이는 4·7·10바이트(16진수 8·14·20자리)다. 바이트 순서는 바꾸지 않는다.
- 같은 물품 ID와 같은 정규화 UID의 재요청은 새 행을 만들지 않고 기존 태그를 `200`으로 반환한다. 최초 연결은 `201`이다.
- 같은 물품의 다른 UID는 `409 ITEM_ALREADY_TAGGED`, 다른 물품에 연결된 UID는 `409 TAG_ALREADY_REGISTERED`를 반환한다.
- 오늘은 실물 리더기 입력 대신 수동 입력한 테스트 UID로 확인한다.

## API 계약 초안

요청:

```http
POST /api/items/12/tag
Content-Type: application/json

{"uid":"04:a2:3b:1c:5d:6e:80"}
```

성공 `201`:

```json
{"tag":{"tagId":1,"uid":"04A23B1C5D6E80","itemId":12,"status":"ACTIVE","createdAt":"2026-10-06T12:00:00+09:00"}}
```

같은 `itemId`와 정규화된 UID로 다시 요청하면 `200`과 동일한 `tagId`·물품 ID·UID를 반환한다. 현재 V4 스키마에는 비활성 태그 상태가 없으므로 저장된 태그는 모두 활성으로 취급한다. 동시에 같은 연결을 시도해도 DB 유니크 제약으로 행은 하나만 생성되며, 나머지 요청은 기존 연결을 조회해 성공으로 반환한다.

태그 등록 오류와 세션·권한 오류 모두 공용 형식 `{"error":{"code":"...","message":"...","retryAt":null}}`을 사용한다. 태그 등록 오류의 `retryAt`은 `null`이다.

예를 들어 이미 등록된 UID는 `409`와 함께 다음 본문을 반환한다.

```json
{"error":{"code":"TAG_ALREADY_REGISTERED","message":"이미 등록된 태그입니다.","retryAt":null}}
```

| HTTP | code | 조건 |
| --- | --- | --- |
| 400 | `VALIDATION` | 본문 또는 UID 누락, 잘못된 JSON |
| 400 | `INVALID_UID_FORMAT` | 정규화 후 길이·16진수 형식 오류 |
| 404 | `ITEM_NOT_FOUND` | 없는 물품 ID |
| 409 | `TAG_ALREADY_REGISTERED` | UID가 다른 물품에 연결됨 |
| 409 | `ITEM_ALREADY_TAGGED` | 물품에 다른 UID가 이미 연결됨 |

## 프런트엔드 연동 흐름

1. 기존 물품에 태그 추가: 관리자가 기존 물품의 `itemId`를 선택하고 UID를 읽거나 입력한 뒤 등록 API를 호출한다. `201`과 `200`은 모두 연결 성공으로 처리한다.
2. 신규 등록: 물품을 먼저 생성해 얻은 `itemId`로 태그 연결 API를 호출한다. 태그 연결이 실패하거나 응답을 받지 못하면 물품을 다시 만들지 않고 **같은 `itemId`**와 UID로 연결을 재시도한다. 같은 연결이 이미 완료됐다면 `200`과 기존 태그 정보가 돌아온다. 다른 물품·UID 충돌의 `409`는 재시도로 덮어쓰지 않고 사용자에게 알려야 한다.

## DB와 후속 작업

등록·중복 방지는 이미 병합된 V4의 `nfc_tags.tag_uid UNIQUE`와 `item_id UNIQUE`를 사용한다. 동시 요청에서 유니크 위반이 나면 삽입 트랜잭션을 롤백한 뒤 해당 물품·UID를 다시 조회한다. 같은 연결이면 기존 태그를 성공으로 반환하고, 다른 연결이면 위 409 오류로 변환한다.

기존 태그 비활성화와 교체는 현재 스키마로 불가능하다. `develop`에는 인증 스키마 V8이 병합됐으므로 마이그레이션 번호를 팀과 맞춘 뒤 후속 버전에서 `deactivated_at`과 물품별 활성 태그 유니크 인덱스를 추가해야 한다. 이미 적용된 V1~V8은 수정하지 않는다.

등록 API는 관리자 전용 세션을 요구한다. 현재 세션 발급 기능은 `sms-mock` 프로필에서만 제공되므로 운영 사용 전 실제 인증 연동을 별도로 확인해야 한다.

## 수동 연결 확인

1. 로컬 PostgreSQL에 `item_types`, `items` 테스트 행을 만들고 물품 ID를 확인한다.
2. 관리자 세션으로 위 API에 테스트 UID를 전송하고 `201`, 정규화된 UID, 물품 ID를 확인한다.
3. 같은 물품과 UID로 재요청하면 `200`이며 태그 ID가 최초 `201` 응답과 같은지 확인한다.
4. 같은 UID로 다른 물품에 등록하면 `409 TAG_ALREADY_REGISTERED`인지 확인한다.
5. 같은 물품에 다른 UID를 등록하면 `409 ITEM_ALREADY_TAGGED`인지 확인한다.
6. DB에서 아래 조회로 실제 연결을 확인한다.

```sql
SELECT t.nfc_tag_id, t.tag_uid, t.item_id, i.item_name
FROM nfc_tags t
JOIN items i ON i.item_id = t.item_id
WHERE t.tag_uid = '04A23B1C5D6E80';
```

예시 UID는 가상 값이며, 실물 NFC 태그에서 읽은 UID로 검증한 결과와 구분한다.
