# develop · FE 통합 기록 — 2026-11-13

## 기준과 보존

- 원본 작업 폴더: `C:/Projects/tagback-user-web`, `codex/user-web-redesign`.
- 기존 UI·공통 키오스크 호스트·Windows 시험 앱·검증 변경을 `a301411`로 커밋했다. 원본 작업 폴더는 깨끗하게 보존했다.
- `git fetch origin`으로 최신 develop을 가져왔다. 기준 커밋은 `79f5191`이며 작업 중 `git ls-remote origin refs/heads/develop`으로 동일함을 재확인했다.
- 별도 작업 폴더 `C:/Projects/tagback-integration`, 브랜치 `codex/develop-fe-integration`을 최신 develop에서 만들고 FE 브랜치를 병합했다. develop/main 자체를 변경하거나 원격에 푸시하지 않았다.
- AdminApp 충돌은 리디자인 AdminWeb 진입점을 유지하고 새 서버 조회를 연결하는 방식으로 해결했다. 관리자 문서는 최신 설명을 추가하고 과거 mock 설명과 구분했다. develop의 태그 동시 등록 경합 수정과 관리자 반납 상태 조회를 보존했다.

## 실제 API 연결

- 사용자 웹: 인증 없이 공개 종류 카탈로그 검색·상세 조회, 종류별 전체/대여 가능 수량을 서버 집계로 표시한다. 공개 응답에 없는 개별 물품·UID는 생성하거나 공개하지 않는다. 물품 개체명 검색에 해당하는 종류도 표시한다.
- 관리자 웹: 물품명·종류명·활성 태그 UID 검색과 종류/상태 조건을 ADMIN 목록 API로 보낸다. 검색 변경 시 이전 요청을 취소하고 오래된 결과를 버린다. 연속 검색어/필터 변경으로 이전 조건이 복원되던 경쟁을 수정했다.
- 계정·SMS/PIN·이용 코드·본인 대여/이력, 관리자 CRUD/태그/상태 변경과 사용자/대여/연체 조회, Windows 대여·반납은 공통 서버를 사용한다.
- Windows는 0.1.2 시험 호스트를 새 작업 폴더에서 패키징해 실제 native transport로 검증한다. 원본 설치 파일 및 사용자 설치 앱은 바꾸지 않았다.

## 조회 및 운영 한계

관리자 현황은 전체 조회를 사용하며, 검색 결과는 서버에서 조건을 적용한 뒤 100개씩 수집하여 UI에서 20개씩 표시한다. 수집당 10,000건 한도가 있고 초과/중간 변경/불완전 응답은 실패 처리한다. 무제한 데이터 규모나 서버 페이지를 직접 이동하는 UI를 구현했다고 해석하지 않는다. 상위 카테고리·물품별 대여소·이미지 업로드·물품 종류 생성은 별도 서버 계약이 필요하다.

Android 앱은 사용자 요청대로 보류했다. 실제 SMS 발송, 실물 NFC 입력, 전원 장애/강제 종료 거래 복구, ADMIN 인증 종료·자동 실행·업데이트·서명·운영 배포는 이번 소프트웨어 통합 검증과 구분한다.

## 재현

Windows PowerShell 7에서 저장소 루트 기준:

```powershell
# frontend pnpm install, kiosk/windows npm ci 및 npm run package를 먼저 수행
pwsh -NoProfile -File backend/scripts/test-kiosk-live.ps1 -FullJourney -AllBackendTests
```

Docker PostgreSQL 17의 격리 DB를 사용한다. 전체 backend 테스트에 인증 DB(55439), 물품 DB(55442)를 제공하고 live DB는 별도로 만든다. API 18082, HTTPS 웹 5182를 사용한다. 임시 인증서는 자식 프로세스에서만 신뢰하며 OS 인증서 저장소를 수정하지 않는다. 테스트 데이터는 격리 DB에만 생성한다. 종료 시 서버와 DB를 중지하고 컨테이너/로그를 진단용으로 남긴다.

초기 통합 검사에서 과거 UI 문구/모의 응답 불일치, 새 테스트와 기존 테스트의 종류명 충돌을 수정했다. 실제 연속 필터 변경 결함은 소스 수정과 회귀 테스트로 보완했다.
## 최종 검증 결과

- backend 전체: 289개 통과, 실패/오류/skip 0. 실제 격리 PostgreSQL을 사용한 테스트와 단위/HTTP 경계 테스트를 포함한다.
- frontend: TypeScript·Vite build 통과, 단위 43개, HTTP fixture 화면 39개, browser NFC bridge 17개, 설치 번들/가상 host 10개 통과.
- Windows: 새 작업 폴더의 package 성공, native host 단위 9개 통과.
- 실제 통합: 공개 카탈로그·관리자 검색/권한/복구, 관리자 CRUD/태그/상태 이력, 본인 반납 확인, 대여·반납 응답 유실 중복 방지, 실제 Windows exe 정상/손상 대여·반납의 5개 시나리오 모두 통과.
- 최종 live 컨테이너(중지/보존): `tagback-kiosk-test-de7b044fd2dc4e9bae30e77d0aaaf086`.
- 로그: `C:/Users/clcl616/AppData/Local/Temp/tagback-kiosk-test-de7b044fd2dc4e9bae30e77d0aaaf086`.
- 화면 증거: `frontend/test-results/full-journey/` 아래 Windows 정상/손상 완료, 사용자 이력, 관리자 점검 상태. Windows 손상 완료 캡처를 시각적으로 확인했다.
- 실제 서버/DB·웹·Windows main/preload/transport를 사용하되 SMS는 sms-mock 수신함, NFC는 서명 이벤트 및 연결 상태 주입이다. 물리 리더기·실제 문자 발송 검증을 의미하지 않는다.
- `git diff --check`, 미해결 병합 항목 없음 확인. 원본 worktree는 `a301411`에서 clean이다.
