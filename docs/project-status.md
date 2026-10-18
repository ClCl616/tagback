# 구현·검증 현황

기준일: 2026-10-18 (한국 시간). 확인 기준: `develop`의 `600f17a` 및 PR #1~#20. 문서 최신화이며 이번 작업에서 기능 테스트를 재실행하지 않았다. 아래 검증은 기존 PR·계약 문서에 기록된 결과다. 주차별 작성 범위·시간은 변경하지 않는다.

## 현재 구조

모바일은 조회·인증·대여 코드, 키오스크와 외장 NFC 리더기는 현장 식별·확정을 담당한다. 스마트폰 직접 NFC는 초기 계획이다. 태그 인식만으로 대여하지 않으며 사용자 확정과 서버 저장 성공을 분리한다. 예약·AI 손상 판정은 현재 MVP에서 제외한다.

## 기능별 상태

| 영역 | develop에 반영된 결과 | 남은 작업·검증 경계 | 근거 |
|---|---|---|---|
| 사용자·키오스크 화면 | 물품 조회·모의 대여/반납·내 대여·오류 흐름 | 물품·대여 화면 실제 API 연결, 실물 검증 | [#1](https://github.com/ClCl616/tagback/pull/1), [#8](https://github.com/ClCl616/tagback/pull/8) |
| 관리자 화면 | DEV mock CRUD·검색·필터·태그 연결·실패 복구 | 운영 관리자 화면·실제 CRUD 연결; mock/server 상태 차이 해소 | [#12](https://github.com/ClCl616/tagback/pull/12), [#16](https://github.com/ClCl616/tagback/pull/16) |
| 인증·권한 | sms-mock 서버 가입·PIN 로그인·재설정·세션·권한 검사, 인증 HTTP 어댑터 | 실제 서버·DB·브라우저 통합 검증, 운영 인증·SMS·전화번호 변경 | [#6](https://github.com/ClCl616/tagback/pull/6), [#9](https://github.com/ClCl616/tagback/pull/9), [#11](https://github.com/ClCl616/tagback/pull/11), [#17](https://github.com/ClCl616/tagback/pull/17) |
| 물품 API | CRUD·관리자 상태 변경·상태 이력·DB 검증 | FE 필드·상태 매핑 및 화면 연결 | [#14](https://github.com/ClCl616/tagback/pull/14), [계약](item-api-contract.md) |
| 태그 API | 등록·교체·해제·조회, expectedUid 충돌 방지, 대여 중 변경 차단 | 실물 리더기와 전체 연동 | [#10](https://github.com/ClCl616/tagback/pull/10), [#15](https://github.com/ClCl616/tagback/pull/15) |
| 반출 API | 대여 코드·반출 토큰·반출 저장·상태/이력·멱등 재시도·동시 요청 검증 | 키오스크 연결은 PR #20, 실물 검증·반납 API는 남음 | [#18](https://github.com/ClCl616/tagback/pull/18) |
| 본인 대여 조회 | 진행/지난 대여·예정일·조회 시 연체 판정·본인 데이터 제한 | 모바일 HTTP 연결, 반납 API; 지난 대여 테스트는 DB 반납 시각 설정 | [#19](https://github.com/ClCl616/tagback/pull/19) |
| 리더기·키오스크 연결 | develop에는 아직 연결 코드 미통합 | [#20](https://github.com/ClCl616/tagback/pull/20)에서 Java PC/SC·SSE·코드 인증·태그 조회·반출 연결 구현, 모의 UID 검증. PR 열림, 실물 ACR1552U 검증 전 | PR #20 기준 2026-10-18 확인 |

리더기 단독 인식은 담당자 Notion 활동 기록에 완료로 기재되어 있다. 이것을 PR #20의 실물 브리지·서버·키오스크 통합 성공으로 해석하지 않는다. 프론트 기본 mock, 수동/모의 UID, 격리 PostgreSQL, 실물 장비 검증은 서로 구분한다.

## 현재 계약

- 가입: 이름·직업 → 전화번호 → SMS → 6자리 PIN. 기존 회원은 전화번호+PIN이며 등록 브라우저 PIN 로그인도 지원한다. 구형 새 브라우저 SMS 로그인 API는 현재 화면에 연결하지 않는다.
- SMS: 개발용 mock, 코드 5분·재발송 기본 30초. 화면은 서버의 만료·재시도 시각을 따른다.
- 키오스크 대여 코드: 6자리·3분. 반출 예정일: 서버 반출 시각부터 72시간. 구현 기본값과 운영 정책 확정은 구분한다.
- 태그 UID: 공백·콜론·하이픈 제거, 대문자 16진수 8/14/20자리. POST 동일 연결 재요청은 200, 최초는 201.
- PUT/DELETE는 expectedUid를 검증한다. 불일치는 TAG_CHANGED, 대여 중 변경은 ITEM_RENTED. 성공한 DELETE를 옛 UID로 재시도하면 409다.
- 마이그레이션: V13 태그 교체·비활성화, V14 AVAILABLE의 활성 태그 보장, V15 대여 인증.
- FE 관리자 mock은 태그 없는 물품을 점검 중으로 두고 연결 후 수동 변경한다. 서버는 TAG_PENDING으로 생성하고 연결 시 AVAILABLE로 전환한다. 아직 실제 구현 차이가 있으므로 연동 시 수정해야 한다.

## 문서 운영

- 현재 계약과 현황을 우선하고 초기 기획·과거 검증 기록은 날짜와 적용 범위를 표시해 보존한다.
- `develop → 작업 브랜치 → PR → CI·팀장 검토 → develop` 흐름을 사용한다. 팀장(치우)이 직접 승인·병합하며 검증된 버전만 별도로 main에 반영한다.
- [2026-10-06 감사](weeks-01-06-audit.md)는 당시 상태다. 완료 항목을 그 문서의 미반영 목록만으로 다시 미완료 처리하지 않는다.
- 테스트 개수는 실행일·커밋·범위·건너뜀 수와 함께 기록하며 서로 다른 실행의 수를 하나로 합치지 않는다.
