# 사용자 웹 → Windows 키오스크 → 관리자 웹 통합 검증

2026-11-13, Android 앱 구현은 사용자 요청으로 보류한다. Windows 0.1.2 패키지를 사용한 소프트웨어 통합 검증이 통과했다. 실물 NFC와 실제 SMS 발송 검증은 포함하지 않는다.

## 실행 환경과 구분

- 작업 폴더 `C:/Projects/tagback-user-web`, 브랜치 `codex/user-web-redesign`, 기준 HEAD `54cca26` 및 로컬 미커밋 변경. 원격 fetch·커밋·푸시·병합·배포 없음.
- 실제 Spring Boot 서버, Flyway 스키마, 격리 PostgreSQL 17, HTTPS 사용자/관리자 웹, 실제 패키지 `TagBackKiosk.exe`를 사용했다. API 응답과 DB 저장을 fixture로 대체하지 않았다.
- Windows main/preload, grant 보관, 명령 검증, HTTPS 요청, 영수증 검증은 실제 구현을 실행했다. 생성한 시험 인증서를 해당 자식 프로세스의 `NODE_EXTRA_CA_CERTS`로만 신뢰시켰다. OS 인증서 저장소를 변경하거나 네이티브 TLS 검사를 끄지 않았다. 브라우저 테스트 컨텍스트에만 로컬 인증서 예외를 사용했다.
- SMS는 `sms-mock` 프로필의 테스트 수신함을 사용했다. 회원가입 화면의 요청·인증·PIN 설정과 서버 인증 처리는 실제다. 통신사 발송·휴대폰 수신은 미검증이다.
- NFC 장치 경계의 연결 상태/스캔 이벤트만 자동화 도구에서 주입했다. 서버가 검증하는 시험 HMAC proof를 생성했다. 실제 리더기·USB·PC/SC 인식 성공을 의미하지 않는다. 실행 패키지에 mock 모드나 테스트 키를 추가하지 않았다.
- 최초 관리자 권한과 물품 종류는 격리 DB에서 테스트 준비로 설정했다. 물품 등록·태그 연결은 관리자 웹 UI로 수행했다. 실제 운영 계정/DB는 사용하지 않았다.

## 결과

| 검사 | 확인한 결과 |
|---|---|
| 사용자 웹 가입 | 실제 API로 SMS 요청/검증, PIN 설정, 회원 생성 및 세션 발급 |
| ADMIN 접근 | 일반 USER의 관리자 API 거부, ADMIN 세션의 관리자 화면 접근 |
| 관리자 물품·태그 | 등록, 수정, 태그 연결/재시도, 상태 변경 사유, 삭제 가능/불가, 생성 응답 유실 시 중복 방지 |
| 사용자 재고·코드 | 관리자 등록 물품 종류 표시, 사용자 버튼으로 실제 이용 코드 발급 |
| Windows 대여 | 네이티브 transport로 서버 대여 확정, DB RENTED, 사용자 본인 대여와 관리자 대여 조회에 동일 물품 표시 |
| 정상 반납 | Windows 화면에서 정상 상태/본인 코드로 확정, DB RETURNED·AVAILABLE, 사용자/관리자 이력 표시 |
| 손상 반납 | 같은 물품을 다시 대여한 뒤 손상 반납, DB RETURNED·DAMAGED·INSPECTION, 관리자 상세에 점검 상태 표시 |
| 중복 저장 | Windows 정상/손상 각 대여·반납 1건씩, 손상 상태 이력 1건을 SQL로 확인 |
| 타인 반납 차단 | 기존 브라우저 키오스크 실연동 테스트에서 타인 코드 거부, 본인 코드로만 완료 |
| 응답 유실 | 기존 브라우저 키오스크 경로에서 서버 저장 후 응답을 버리고 동일 요청 재시도, 대여/반납 중복 저장 없음 |

최종 실행: live 테스트 **4개 통과**(관리자 1, 브라우저 키오스크 2, 사용자→Windows→관리자 전체 흐름 1). Windows 전체 흐름 하나 안에서 정상/손상 두 번의 대여·반납을 검증했다. 관련 백엔드 검사 **65개** 통과(단위·경계·실제 PostgreSQL 통합 검사를 포함한 합계), Windows 호스트 단위 **9개**, 패키지 smoke 통과. 65개를 모두 실물 또는 DB 테스트라고 해석하지 않는다.

## 발견 및 수정

Windows 호스트가 health 응답도 무조건 JSON으로 파싱했다. 실제 `KioskHealthController`는 DB `select 1` 성공 후 본문 없는 HTTP 200을 반환하므로 정상 연결을 실패로 표시했다. `transport.cjs`에서 health의 빈 본문만 허용하고, 업무 응답의 JSON/영수증 검증은 유지했다. 빈 200/503 health 및 빈 업무 응답 거부 회귀 검사를 추가했다. 수정본은 **Windows 0.1.2**다.

시험 DB의 초기 임시 서버가 소켓 준비 완료를 반환한 직후 재시작하는 경쟁 조건도 발견했다. 준비 확인을 TCP로 변경했다. 중간 실패 후 새 격리 DB에서 재실행했으며 마지막 4개 검사가 모두 통과했다. 테스트의 관리자 행 선택은 숨김 '상세 보기' 문구를 포함한 접근성 버튼 이름으로 수정했다.

## 재현과 산출물

```powershell
cd C:/Projects/tagback-user-web/kiosk/windows
npm ci
npm run package
cd ../..
./backend/scripts/test-kiosk-live.ps1 -FullJourney
```

Docker Desktop이 실행 중이어야 한다. 시험 포트 55442/18082/5182를 사용하며 점유 중이면 중단한다. backend 변경 없이 웹/호스트 검사를 반복할 때만 `-SkipBackendTests`를 추가한다. 일반 `-FullJourney` 실행은 백엔드 검사도 다시 수행한다.

- 코드: `frontend/tests/live-e2e/windows-journey.spec.ts`, `frontend/playwright.live-journey.config.ts`, `backend/scripts/test-kiosk-live.ps1`.
- 화면 증거: `frontend/test-results/full-journey/` 아래 Windows 정상/손상 완료, 관리자 점검 상세, 사용자 이력 PNG.
- 최종 시험 컨테이너: `tagback-kiosk-test-f94ed48f0e5942b9bac603be6cf693a7` (중지 후 보존).
- 서버/DB 로그: `C:/Users/clcl616/AppData/Local/Temp/tagback-kiosk-test-f94ed48f0e5942b9bac603be6cf693a7`.
- 수정 설치 파일: `kiosk/windows/out/make/squirrel.windows/x64/TagBackKiosk-0.1.2-trial-Setup.exe`. 서명하지 않은 시험 패키지이며 에이전트가 설치/업그레이드하지 않았다.

테스트 서버·웹 프로세스와 시험 DB는 종료했다. 중간 실패의 컨테이너/로그도 진단용으로 보존했다. 테스트 결과·프로필·생성 인증서·설치 산출물은 Git에 포함하지 않는다.

## 남은 검증

실제 SMS·NFC, Windows exe에서 실제 네트워크 단절/서버 커밋 직후 응답 유실, 강제 종료/전원 장애 복구, 다른 PC 설치/업그레이드, 운영 주소·TLS·계정 설정, ADMIN 운영 기능 및 자동 실행/업데이트는 별도다. 사용자 웹의 PIN 복구 등 모든 화면을 실서버로 완전 재검증한 결과도 아니다. 이번 결과는 위 표의 검증 범위이며 무인 운영 완료를 뜻하지 않는다. Android 앱은 보류한다.
