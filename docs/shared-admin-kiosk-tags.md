# 공통 관리자 로그인과 키오스크 태그 등록

2026-11-19 구현. 작업 위치 `C:/Projects/tagback-admin-password`, 브랜치 `codex/admin-password-kiosk-tags`, 기준 커밋 `cfdd5f7`. 초기 구현 당시에는 Compose에 배포하지 않았으며, 이후 같은 날 기존 Compose 반영을 완료했다(아래 최신 반영 기록 참고). 기존 콘솔 인증코드 출력 변경도 이 작업 폴더에 포함했다.

## 이용 절차

1. 어느 기기에서든 `/admin`에 접속해 공통 관리자 비밀번호로 로그인한다. 회원 가입·전화번호·PIN·계정 ADMIN 권한은 필요하지 않다.
2. 물품명과 종류를 입력해 물품을 등록한다. 상태는 `TAG_PENDING`(태그 등록 대기)이며 대여할 수 없다. 물품 종류는 기존 데이터에 먼저 등록되어 있어야 한다.
3. NFC 리더기가 연결된 키오스크의 시작 화면에서 **관리자 태그 등록**을 선택하고 같은 비밀번호로 인증한다.
4. 대기 물품을 선택하고 실물 태그를 리더기에 댄다. 물품명·ID·UID를 확인해 **태그 연결 확정**을 누른다. 성공하면 `AVAILABLE`로 전환된다.
5. **관리자 종료**로 대여·반납 화면으로 돌아간다. 관리자 모드에서는 일반 대여·반납을 동시에 진행하지 않는다.

물품명·종류 수정은 관리자 웹에서 계속 진행한다. 태그 교체는 키오스크에서 ‘태그 등록 대기만’을 해제한 뒤 검색하여 진행한다. 대여 중인 물품은 교체할 수 없다. 점검·수리 상태는 태그를 교체해도 유지된다. 중복 UID, 다른 관리자가 먼저 변경한 태그, 위조·재사용된 스캔은 거부한다. 기존 연결된 태그와 일반 사용자의 가입·로그인·대여·반납 데이터는 유지한다.

## 비밀번호 설정

실제 공통 비밀번호는 코드에 넣거나 기본값을 제공하지 않는다. 배포할 checkout의 루트에서 PowerShell 7로 실행한다.

```powershell
pwsh -NoProfile -File deploy/compose/Initialize-Compose.ps1
pwsh -NoProfile -File deploy/compose/Set-AdminPassword.ps1
docker compose up -d --build --wait --wait-timeout 240
```

비밀번호는 화면에 표시되지 않는 입력으로 두 번 받는다(12~128자). PBKDF2-SHA256 600,000회·임의 salt로 해시만 `deploy/compose/local/admin-password-hash`에 저장한다. 이 경로는 Git 및 Docker 빌드 문맥 제외 대상이다. Compose secret을 Spring `tagback.admin.password-hash`로 전달한다. 초기화는 기존 비밀번호를 덮어쓰지 않으며 미설정이면 관리자 로그인이 503으로 차단된다. 별도 Spring 실행 환경도 같은 설정 키에 동일 형식의 해시를 제공해야 한다.

교체할 때는 설정 스크립트를 다시 실행하고 `docker compose up -d --build --force-recreate --wait api`를 실행한다. 새 설정으로 API가 시작되면 이전 관리자 세션을 사용할 수 없다. 이 작업 폴더를 시험 실행할 때 기존 서비스와 같은 Compose 프로젝트 이름을 사용하지 않는다.

## 인증·저장 정책

- 웹 관리자: 별도 Secure/HttpOnly/SameSite=Strict 쿠키, 30분 절대 만료. HTTPS로 사용한다.
- 키오스크 관리자: 10분 절대 만료, 조작 없이 5분이면 종료한다. 저장 결과 확인 중에는 요청을 보존하고 필요 시 다시 인증한다.
- 설치형 Windows 호스트는 관리자 토큰을 메인 프로세스 메모리에 보관하고 UI에는 임의 핸들만 전달한다. 비밀번호·토큰을 로컬 스토리지에 저장하지 않는다.
- 공통 비밀번호 로그인은 서버 전체에서 분당 10회로 제한한다. 성공 시도도 포함하며 실패 횟수는 DB에 기록한다.
- 기존 계정의 `ADMIN` 역할은 새 관리자 API 접근을 허용하지 않는다. 계정과 과거 기록은 삭제하지 않는다.
- 기존 `/api/items/{id}/tag`의 UID 직접 입력 POST/PUT/DELETE는 403으로 차단한다. 등록·교체는 관리자 키오스크 세션과 신뢰된 리더기의 서명된 스캔을 요구한다.
- 태그 연결·상태 변경·감사 기록·멱등 응답을 한 트랜잭션으로 저장한다. 응답이 유실되면 같은 operationId/물품/기존 UID/스캔으로 재확인하며 다른 작업을 막는다. 미처리 스캔이 만료됐다면 `NOT_APPLIED`를 확정해 다시 인식할 수 있게 한다.
- V21 마이그레이션이 관리자 세션·로그인 횟수·감사·태그 작업 테이블과 상태 이력의 관리자 세션 참조를 추가한다. 공통 비밀번호 방식이므로 행위자를 개인으로 식별하지 못하며 세션·시각·리더기·물품·변경 UID를 기록한다.

## 검증 기록

- 백엔드 전체 실행: 255개 중 142개 실행 통과, 별도 환경이 필요한 기존 DB 테스트 등 113개 제외. 전체 검증 완료로 해석하지 않는다.
- 새 실제 PostgreSQL 통합 테스트 8개 통과. 인증 채널 분리·만료·로그아웃·비밀번호 버전, 로그인 제한, 등록 대기·수정, 서명 등록·중복·재사용·교체·대여 상태·멱등 재시도·만료 취소를 확인했다. 마지막 대여 상태 차단 보강 뒤 해당 8개 재실행 통과.
- 프론트엔드 단위 테스트 43개, HTTP 화면 fixture 39개, 설치형 호스트 화면 fixture 13개, 기존 브라우저 리더기 대여·반납 fixture 17개 통과.
- Windows 호스트 단위 테스트 12개 통과. 웹 및 키오스크 production build 통과. 키오스크 관리자 화면 캡처를 시각 검토했다.
- Windows 0.1.3 설치 파일 생성 및 패키지 smoke 시험 통과: 별도 프로필의 암호화 키 보관, 전체 화면·단축키, 로컬 UI·렌더러 격리·임의 요청 차단, 번들 Java IPC 연결 해제/종료. 산출물은 `kiosk/windows/out/make/squirrel.windows/x64/TagBackKiosk-0.1.3-trial-Setup.exe`이며 설치는 하지 않았다.
- 실제 NFC 리더기·실물 태그와 운영 데이터로 수행하는 최종 검증은 아직 하지 않았다. UI fixture 시험은 실제 서버와 장치를 함께 연결한 종단간 검증이 아니다.

PostgreSQL 통합 시험은 별도 `tagback-admin-auth-test` 컨테이너의 `tagback_admin_test` DB(127.0.0.1:55461)에서 수행했다. 기존 Compose DB를 사용하지 않았다. 재실행은 해당 시험 DB를 준비한 뒤 `TAGBACK_ADMIN_TEST=true`로 `backend/gradlew.bat test --tests com.tagback.SharedAdminIntegrationTest`를 실행한다. 시험은 전용 DB의 테이블 데이터를 초기화한다.

## 2026-11-19 공통 관리자·키오스크 태그 기능 Compose 반영 완료

C:/Projects/tagback-compose, codex/docker-compose (HEAD 9cbc985)에 codex/admin-password-kiosk-tags의 로컬 구현을 반영했다. 기존 모바일 화면 개선과 SMS 콘솔 변경을 보존했고 API·웹 이미지를 재빌드하여 기본 tagback 프로젝트에서 실행했다. DB는 기존 볼륨을 유지하고 V21(shared admin sessions) 마이그레이션 성공을 확인했다. 변경 전 DB dump와 소스 백업은 deploy/compose/local에 보관했다.

임의 생성한 공통 관리자 비밀번호를 PBKDF2 해시로 설정했다. 전달용 원문은 Git/Docker 문맥 제외 파일 deploy/compose/local/admin-password.txt에 있으며 서버에는 해시만 마운트한다. 원문은 비밀번호 관리자에 옮겨 보관한 뒤 필요 없으면 삭제할 수 있다. 삭제해도 서버 로그인에는 영향이 없다.

검증: API·웹·DB healthy, Test-Compose.ps1 통과, 실제 HTTPS 웹/키오스크 비밀번호 로그인·보호 목록 조회·로그아웃/폐기 확인, 실제 브라우저 관리자 로그인·태그 없는 등록 폼·키오스크 관리자 로그인/종료 확인. 기존 모바일 변경을 포함한 HTTP fixture 42개 전체 통과. 시험 물품/사용자/대여는 생성하지 않았다. 실물 NFC 등록/교체 검증과 Windows 설치 업데이트는 수행하지 않았다. 서비스는 실행 중이며 변경은 로컬 미커밋 상태, 원격 푸시/병합은 하지 않았다.

## 2026-11-19 chi-server 공통 관리자 배포 및 비밀번호 고정

사용자가 지정한 공통 비밀번호를 로컬 Compose와 chi-server의 tagback-home에 PBKDF2-SHA256 해시로 설정했다. 사용자 지정값은 기본 설정 도구의 12자 최소 길이보다 짧아 이번 설정에 한해 직접 해시를 생성했으며 일반 설정 도구의 제한은 유지했다. 비밀번호 원문은 이 문서에 기록하지 않는다.

원격 C:/Services/tagback/compose.home.yaml에 admin_password_hash secret을 연결하고 공통 관리자/키오스크 구현 31개 파일을 반영했다. 기존 모바일 변경, 운영 도메인/Origin, DB 소유자 분리, 개발용 API 차단, 로깅/네트워크 설정을 보존했다. 원격에는 해당 기능이 없었으므로 API·웹을 home-admin-20261119-02 이미지로 재빌드해 실행했다. V21 마이그레이션 성공 및 세 서비스 healthy 확인. 원격 소스/DB 백업: C:/Services/tagback-before-shared-admin-20261119.tar.gz, .dump. 원격은 Git checkout이 아닌 배포 폴더다.

SSH의 Docker Desktop credential helper 오류는 기존 사용자 설정을 수정하지 않고 deploy/home/docker-build-config의 공개 이미지용 별도 설정으로 해결했다. 실제 https://tagback.chiro1.cloud에서 새 비밀번호 웹·키오스크 로그인, 보호 목록 조회, 로그아웃/웹 세션 무효화, 개발용 API 404 확인. 로컬 비밀번호 로그인/로그아웃도 확인. 업무 데이터 생성 및 실물 NFC 검증은 수행하지 않았다. Windows 설치 앱은 업데이트하지 않았다.
