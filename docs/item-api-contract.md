# 물품 CRUD API 계약 초안

작성일: 2026-10-07. 대상: 6주차 물품 등록·수정·삭제·조회 API.
CRUD API 구현과 아래 범위의 검증은 완료했다. 권한·삭제·연동 정책의 팀 합의는 별도다.
기존 `items`, `item_types` 스키마를 사용한다. 상태 변경 API는 별도 작업이다.

## 등록 API 구현 현황

`POST /api/v1/items` 구현 완료: ADMIN 세션·Origin 검사, 요청 검증 및 알 수 없는 필드 거부,
종류 존재 확인, AVAILABLE 상태 저장, DB 등록일 재조회, 201 응답·Location 헤더 반환.
종류가 없으면 404 ITEM_TYPE_NOT_FOUND를 반환한다.
등록 컨트롤러·서비스와 DTO 검증 테스트 8개가 통과했다. 저장소·세션은 테스트에서 mock으로 대체했다.
실제 PostgreSQL 검증 결과는 아래 통합 검증 절을 참고한다.

## 조회 API 구현 현황

`GET /api/v1/items`, `GET /api/v1/items/{itemId}` 구현 완료.
로그인 사용자·관리자가 조회할 수 있으며, 목록은 종류·상태 필터와 페이지네이션,
itemId 내림차순 정렬을 지원한다. 물품 종류를 EntityGraph로 함께 읽어 목록의 개별 종류 조회를 피한다.
없는 물품은 404 ITEM_NOT_FOUND, 잘못된 ID·페이지·상태는 400 INVALID_INPUT이다.
JPA offset 한계로 page × size가 2,147,483,647을 초과하는 요청도 400으로 거부한다.
등록·조회·DTO 관련 테스트 총 16개가 통과했다. 이후 실제 PostgreSQL 쿼리 검증도 완료했다.
상태 변경 API는 아직 구현하지 않았다.

## 수정 API 구현 현황

`PATCH /api/v1/items/{itemId}` 구현 완료. ADMIN 세션·Origin 검사와 요청 검증을 적용했다.
이름·종류의 부분 수정에서 미전달 값과 상태·등록일을 유지한다.
빈 객체, 명시적 null, 공백 이름, 길이·ID 범위 오류 및 status 등 미정의 필드는 400이다.
실제로 종류를 변경할 때 대여·점검 기록이 있으면 409 ITEM_TYPE_CHANGE_CONFLICT다.
같은 종류 ID나 이름만 수정하는 경우에는 이력 유무와 관계없이 허용한다.
수정 트랜잭션은 물품 행에 쓰기 잠금을 획득한 후 이력을 확인하고 변경한다.
등록·조회·수정·DTO 테스트 총 24개가 통과했다. 이후 실제 PostgreSQL 수정·잠금 쿼리 실행도 확인했다.
여러 동시 요청에서 잠금의 순서·경합 검증은 별도다.

## 삭제 API 구현 현황

`DELETE /api/v1/items/{itemId}` 구현 완료. ADMIN 세션·Origin 검사와 ID 검증을 적용했다.
물품 행에 쓰기 잠금을 획득하고 NFC 태그·대여·점검 연결 기록을 확인한다.
연관 기록이 없으면 실제 삭제하고 flush 후 204를 반환한다. 연결 기록이 있으면 409 ITEM_DELETE_CONFLICT,
없는 물품·재삭제는 404 ITEM_NOT_FOUND다. 알려진 세 물품 외래 키의 위반(SQLSTATE 23503)도
409 ITEM_DELETE_CONFLICT로 변환하고, 다른 DB 오류는 삭제 충돌로 잘못 변환하지 않는다.
등록·조회·수정·삭제·DTO 테스트 총 32개가 통과했다. 이후 실제 DB의 삭제 제한과 CRUD 전체 흐름도 검증했다.
외래 키 위반 예외 변환은 mock 테스트로 확인했으며, 동시 요청 중 발생하는 제약 위반 재현은 별도다.

## 필드와 검증

| 필드 | 요청 | 응답 | 규칙 |
|---|---|---|---|
| itemId | 경로에 사용 | 문자열 | 양의 BIGINT를 나타내는 10진 문자열. 인증 API처럼 ID를 문자열로 전달한다. |
| itemName | 등록 필수, 수정 선택 | 문자열 | 앞뒤 공백 제거 후 1~100자. 공백만 있는 값과 null은 거부한다. |
| itemTypeId | 등록 필수, 수정 선택 | 문자열 | 양의 BIGINT 문자열이며 존재하는 물품 종류여야 한다. |
| itemTypeName | 없음 | 문자열 | 연결된 물품 종류 이름. |
| status | CRUD 요청에서 받지 않음 | 문자열 | AVAILABLE / RENTED / INSPECTION / REPAIR. 신규 등록은 AVAILABLE. |
| createdAt | 없음 | ISO 8601 문자열 | DB가 생성한 등록 시각. UTC 또는 오프셋을 포함한다. |

물품명 중복은 현재 DB 제약이 없으므로 허용한다. 물품 종류 이름의 중복 금지와 구분한다.
이미지, 물품별 설명, 등록자, 수정일, 대여소는 현재 items 테이블에 없으며 이번 CRUD에 추가하지 않는다.
요청에 정의되지 않은 필드는 400 INVALID_INPUT으로 거부한다. 특히 status를 보내 CRUD로 상태를 바꾸지 못하게 한다.
물품명·종류 ID는 JSON 문자열만 허용한다. 숫자·불리언의 문자열 자동 변환은 거부한다.

## 경로와 권한

기본 경로: `/api/v1/items`. 본문이 있는 요청은 `Content-Type: application/json`.

| 기능 | 메서드·경로 | 권한 초안 | 성공 |
|---|---|---|---|
| 등록 | POST /api/v1/items | ADMIN | 201, 물품 응답 및 Location 헤더 |
| 목록 | GET /api/v1/items | 로그인 사용자 | 200, 목록 응답 |
| 상세 | GET /api/v1/items/{itemId} | 로그인 사용자 | 200, 물품 응답 |
| 수정 | PATCH /api/v1/items/{itemId} | ADMIN | 200, 수정된 물품 응답 |
| 삭제 | DELETE /api/v1/items/{itemId} | ADMIN | 204, 본문 없음 |

기존 세션 쿠키 인증과 @AdminOnly를 사용하고 변경 요청에는 기존 Origin 검사를 적용한다.
현재 SessionService는 sms-mock 프로필에 제한되어 있으므로 운영 인증이 연결되었다고 취급하지 않는다.
비로그인 모바일 카탈로그와 키오스크 조회는 이 CRUD 조회의 공개 접근으로 자동 확장하지 않는다. 별도 조회 계약과 권한 합의가 필요하다.

## 등록·수정

등록 요청 예시:

```json
{ "itemName": "우산 01", "itemTypeId": "1" }
```

등록·상세·수정 공통 응답 예시:

```json
{
  "itemId": "10",
  "itemName": "우산 01",
  "itemTypeId": "1",
  "itemTypeName": "우산",
  "status": "AVAILABLE",
  "createdAt": "2026-10-07T01:00:00Z"
}
```

등록 응답의 Location 예시: `/api/v1/items/10`.
물품 종류는 기존 item_types 데이터를 참조한다. 종류 생성·수정 API는 이번 범위에 포함하지 않는다.
환경에 종류 데이터가 없으면 먼저 준비해야 한다. 선택 UI용 종류 목록 API는 별도 협의한다.

수정 요청 예시:

```json
{ "itemName": "우산 02" }
```

수정에서는 itemName과 itemTypeId 중 적어도 하나를 전달한다. 미전달 필드는 유지하고 명시적 null, 빈 객체는 거부한다.
대여·점검 이력의 물품 종류가 바뀌는 것을 막기 위해 itemTypeId가 실제로 달라지는 경우,
대여 또는 점검 기록이 있으면 409 ITEM_TYPE_CHANGE_CONFLICT로 거부하는 정책을 제안한다.
동일한 종류 ID를 다시 전달하거나 이름만 바꾸는 요청은 허용한다.

## 목록

예시: `GET /api/v1/items?page=0&size=20&itemTypeId=1&status=AVAILABLE`.

- page: 0부터 시작, 기본 0, 음수 또는 정수 범위 초과는 400.
- size: 기본 20, 허용 범위 1~100.
- itemTypeId: 선택, 양의 BIGINT 문자열. 조건에 맞는 데이터가 없으면 빈 목록.
- status: 선택, DB 상태 이름과 동일한 대문자 값. 잘못된 값은 400.
- 정렬: itemId 내림차순으로 고정. 이름 검색과 임의 정렬은 이번 최소 범위에서 제외한다.

```json
{
  "items": [
    {
      "itemId": "10",
      "itemName": "우산 01",
      "itemTypeId": "1",
      "itemTypeName": "우산",
      "status": "AVAILABLE",
      "createdAt": "2026-10-07T01:00:00Z"
    }
  ],
  "page": 0,
  "size": 20,
  "totalElements": 1,
  "totalPages": 1
}
```

결과가 없으면 items는 [], totalElements와 totalPages는 0이다.

## 삭제 정책 초안

현재 스키마에 삭제 표시 필드가 없으므로 연관 기록이 없는 물품만 실제 삭제한다.
NFC 태그, 대여 기록(반납 완료 포함), 점검 기록 중 하나라도 연결되어 있으면
409 ITEM_DELETE_CONFLICT를 반환한다. 태그나 이용 이력을 연쇄 삭제하지 않는다.
사전 확인과 함께 DB 외래 키를 최종 방어로 유지하고, 확인 이후 연관 기록이 추가되어
삭제가 실패한 경우에도 해당 제약 위반을 같은 409로 변환한다.
존재하지 않거나 이미 삭제된 ID는 404 ITEM_NOT_FOUND를 반환한다.
이력이 있는 물품의 운영상 사용 중지는 별도 비활성화 정책으로 협의한다.

## 오류

기존 ApiErrorResponse 형식을 따른다. retryAt은 아래 오류에서는 null이다.

```json
{
  "error": {
    "code": "ITEM_NOT_FOUND",
    "message": "물품을 찾을 수 없습니다.",
    "retryAt": null
  }
}
```

| HTTP | 코드 | 조건 |
|---|---|---|
| 400 | INVALID_INPUT | 필수값 누락, 형식·길이·페이지 범위 오류, 허용하지 않는 필드 |
| 401 | 기존 세션 오류 코드 | 세션 없음·만료 등. 인증 API의 기존 코드를 유지한다. |
| 403 | FORBIDDEN | 관리자 권한 없음 또는 기존 Origin 검사 실패 |
| 404 | ITEM_NOT_FOUND | 대상 물품 없음 |
| 404 | ITEM_TYPE_NOT_FOUND | 등록·수정 시 지정한 물품 종류 없음 |
| 409 | ITEM_DELETE_CONFLICT | 연결된 태그·대여·점검 기록 때문에 삭제 불가 |
| 409 | ITEM_TYPE_CHANGE_CONFLICT | 대여·점검 기록이 있는 물품의 종류 변경 |
| 405 | METHOD_NOT_ALLOWED | 지원하지 않는 메서드. Allow 헤더 포함 |
| 415 | UNSUPPORTED_MEDIA_TYPE | 지원하지 않는 요청 본문 형식 |
| 500 | INTERNAL_ERROR | 예상하지 못한 물품 API 내부 오류. 내부 세부 정보는 응답에 포함하지 않음 |

ITEM_* 코드는 신규 구현 대상이다. 오류 응답에는 SQL, 내부 예외, 요청 원문을 노출하지 않는다.

## 프론트엔드 연동 경계

현재 frontend/src/shared/types.ts의 mock Item과 직접 호환되지 않는다.
HTTP 어댑터에서 itemId → id, itemName → label, itemTypeId → kindId로 변환하고
대문자 상태를 화면 모델에 매핑해야 한다. 화면 모델에는 repair 상태가 없어 확장이 필요하다.
stationId, tag, active는 이 CRUD 응답에 없으며 임의 값으로 성공 연동을 가장하지 않는다.
단일 대여소 ID 매핑, 태그 API, 활성화 정책과 기존 catalog 구조는 후속 연동에서 합의한다.

## 입력·권한·예외 처리 검증 결과

물품 테스트 39개와 기존 인증 오류·세션 인증·권한 테스트 16개, 총 55개가 통과했다.
숫자·불리언 JSON 필드, 잘못된 JSON, 빈 필터, 만료·폐기 세션, 중복 세션 쿠키,
클라이언트 역할 위조, cross-site 변경 요청, 405·415 및 안전한 500 응답을 추가 확인했다.
예상하지 못한 내부 오류 처리는 물품 컨트롤러에만 적용하며 기존 공통 입력·도메인 오류 처리를 우선한다.
이후 실제 DB 세션 검증을 사용하는 MockMvc 통합 테스트도 완료했다. HTTP 로그인 흐름과 운영 인증 연결은 별도다.

## PostgreSQL 통합 검증

PostgreSQL 17을 임시 디렉터리·별도 포트에서 실행하고 전용 tagback_items_test DB에
Flyway V1~V9를 적용했다. 실제 JPA·SQL·세션 인증 인터셉터를 사용하고 저장소·세션 mock은 사용하지 않았다.
각 테스트 데이터는 트랜잭션 롤백으로 정리한다. 테스트 종료 후 전용 서버를 중지한다.

- 등록 → 상세 조회 → 이름 수정 → 재조회 → 종류 수정 → 삭제 → 재조회·재삭제 404
- 목록의 종류·상태 필터, ID 내림차순, 페이지네이션, 빈 결과
- 태그·반납 완료 대여 기록·점검 기록의 삭제 제한 및 대여·점검 기록의 종류 변경 제한
- 실제 DB 세션의 일반 사용자·미인증 삭제 차단 및 관리자 권한 회수 즉시 반영

물품 테스트 총 43개(기존 39개 + PostgreSQL 통합 4개)가 모두 통과했다.
MockMvc 요청은 테스트 트랜잭션 안에서 실행된다. 실제 HTTP 서버·로그인 요청, 커밋 후 다른 연결의 가시성,
동시 요청의 잠금 경합은 이번 검증 범위에 포함하지 않는다.

재실행 (backend 디렉터리의 PowerShell):

```powershell
& ./scripts/test-item-postgres.ps1
# 기본 포트가 사용 중인 경우
& ./scripts/test-item-postgres.ps1 -Port 55441
```

PostgreSQL 설치 경로가 다르면 -PostgresBin으로 bin 디렉터리를 전달한다.
스크립트는 기존 개발 DB를 사용하지 않으며, 진단용 임시 클러스터 경로를 출력하고 파일은 남긴다.

## 구현 확인 항목

- [x] 요청·응답 DTO와 입력 검증 구현
- [x] Item 수정 메서드 및 createdAt 접근 방법 추가
- [x] ItemService·ItemController 구현
- [x] 물품 예외와 공통 오류 처리 연결
- [x] 등록 → 조회 → 수정 → 삭제 및 빈 목록 검증 (PostgreSQL·MockMvc)
- [x] 잘못된 입력·미인증·일반 사용자 변경 요청 검증 (MockMvc)
- [x] 연관 기록이 있는 삭제·종류 변경 충돌 검증 (mock 및 실제 PostgreSQL)
- [ ] 프론트엔드·NFC 담당자와 권한·삭제 정책·필드 매핑 협의
