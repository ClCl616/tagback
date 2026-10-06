# NFC 태그 등록·물품 연결 (5주차)

이 문서는 2026-10-06 기준의 등록 API 초안이다. API 경로, UID 규칙, 인증 정책은 팀 합의 전이다.

## 현재 범위

- `POST /api/items/{itemId}/tag`로 기존 물품에 NFC UID를 연결한다.
- UID는 양끝 공백과 내부 공백·콜론·하이픈을 제거한 뒤 대문자로 저장한다.
- 허용 길이는 4·7·10바이트(16진수 8·14·20자리)다. 바이트 순서는 바꾸지 않는다.
- 등록된 UID나 이미 태그가 있는 물품에 대한 중복 요청은 `409`를 반환한다.
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

오류 본문은 `{"code":"...","message":"..."}`이다.

| HTTP | code | 조건 |
| --- | --- | --- |
| 400 | `VALIDATION` | 본문 또는 UID 누락, 잘못된 JSON |
| 400 | `INVALID_UID_FORMAT` | 정규화 후 길이·16진수 형식 오류 |
| 404 | `ITEM_NOT_FOUND` | 없는 물품 ID |
| 409 | `TAG_ALREADY_REGISTERED` | UID 중복 |
| 409 | `ITEM_ALREADY_TAGGED` | 물품에 다른 태그가 이미 연결됨 |

## DB와 후속 작업

오늘의 등록·중복 방지는 이미 병합된 V4의 `nfc_tags.tag_uid UNIQUE`와 `item_id UNIQUE`를 사용한다. 동시 요청에서 발생하는 DB 유니크 위반도 제약 이름을 확인해 위 409 오류로 변환한다.

기존 태그 비활성화와 교체는 현재 스키마로 불가능하다. `feat/auth` 브랜치가 이미 V8을 사용하고 있으므로 마이그레이션 번호를 팀과 맞춘 뒤 후속 버전에서 `deactivated_at`과 물품별 활성 태그 유니크 인덱스를 추가해야 한다. 이미 적용된 V1~V7은 수정하지 않는다.

현재 등록 API에는 인증이 없다. 인증·관리자 권한이 연결되기 전에는 외부에 노출하거나 운영 DB에서 사용하지 않는다.

## 수동 연결 확인

1. 로컬 PostgreSQL에 `item_types`, `items` 테스트 행을 만들고 물품 ID를 확인한다.
2. 위 API에 테스트 UID를 전송하고 `201`, 정규화된 UID, 물품 ID를 확인한다.
3. 같은 UID로 다른 물품에 등록하면 `409 TAG_ALREADY_REGISTERED`인지 확인한다.
4. 같은 물품에 다른 UID를 등록하면 `409 ITEM_ALREADY_TAGGED`인지 확인한다.
5. DB에서 아래 조회로 실제 연결을 확인한다.

```sql
SELECT t.nfc_tag_id, t.tag_uid, t.item_id, i.item_name
FROM nfc_tags t
JOIN items i ON i.item_id = t.item_id
WHERE t.tag_uid = '04A23B1C5D6E80';
```

예시 UID는 가상 값이며, 실물 NFC 태그에서 읽은 UID로 검증한 결과와 구분한다.
