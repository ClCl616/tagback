# TagBack Docker Compose 실행

웹(Nginx HTTPS), Spring Boot API, PostgreSQL 17을 `compose.yaml` 한 프로젝트로 실행한다. Java·Node·pnpm·Gradle은 Docker 빌드 단계 안에서 사용하므로 호스트에 별도로 설치하지 않아도 된다. Windows의 초기화·확인 스크립트에는 PowerShell이 필요하며 확인 스크립트는 PowerShell 7을 사용한다.

현재 구성은 **로컬 개발·통합 확인용**이다. 기존 서버의 가입·세션·대여·반납 API가 `sms-mock & !prod & !production` 프로필에 묶여 있다. 따라서 이번 구성도 `sms-mock`을 사용하고 HTTPS 포트는 `127.0.0.1`에만 공개한다. SMS 조회용 개발 API도 포함되므로 외부 운영 서비스로 공개하지 않는다. 프로필 이름만 production으로 바꾸면 기존 인증·대여 서비스가 활성화되지 않는다. 실제 운영 인증·SMS 전환은 별도 작업이다.

## 처음 실행

Docker Desktop의 Linux 컨테이너 엔진을 실행한다. 저장소 루트에서:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/compose/Initialize-Compose.ps1
pwsh -NoProfile -File deploy/compose/Set-AdminPassword.ps1
docker compose up -d --build --wait --wait-timeout 240
docker compose ps
```

처음에는 이미지·의존성을 다운로드하므로 인터넷과 시간이 필요하다. 초기화는 임의 비밀값 3개와 localhost용 자체 서명 인증서를 `deploy/compose/local/`에 만든다. 기존 비밀과 인증서는 덮어쓰지 않으며 Git·Docker 빌드 문맥에서 제외한다. OS 인증서 신뢰 저장소는 변경하지 않는다. 웹 브라우저에는 자체 서명 인증서 경고가 나타날 수 있다. 일상 개발에는 신뢰된 localhost 인증서/키를 같은 위치의 `server.crt`, `server.key`로 제공하는 방식을 사용한다. 앱의 인증서 검증을 전역 해제하지 않는다.

- 사용자 웹: https://localhost:8443/mobile
- 관리자 웹: https://localhost:8443/admin
- 브라우저 키오스크 확인: https://localhost:8443/kiosk

DB와 API는 호스트에 포트를 공개하지 않고 Compose 네트워크에서만 통신한다. DB healthcheck → API healthcheck → 웹 순서로 시작하며 Flyway가 빈 DB에 스키마를 적용한다. 기본 계정·물품·관리자 권한을 자동으로 만들지 않는다. NFC 실물 연결과 설치 앱은 각 장치에서 별도로 실행한다.

기존 Windows 개발 런처와 별도 구성이다. 런처의 파일·프로필·DB·프로세스를 수정하지 않는다. Compose 기본 웹 포트도 런처와 다른 8443이다. 다른 checkout에서 같은 Compose 프로젝트 이름을 쓰면 같은 자원을 가리키므로 독립 실행은 `docker compose -p 고유이름 ...`을 모든 명령에 일관되게 사용한다.

## 설정

관리자는 계정 없이 공통 비밀번호로 로그인한다. 위 설정 스크립트(PowerShell 7)는 비밀번호를 두 번 입력받아 해시만 저장한다. 미설정이면 관리자 접근이 차단된다. 물품은 웹에서 태그 등록 대기로 생성하고 리더기가 연결된 키오스크의 관리자 모드에서 태그를 연결한다. 비밀번호 교체·세션·태그 교체·검증 범위는 [공통 관리자와 키오스크 태그 등록](../../docs/shared-admin-kiosk-tags.md)을 참고한다.

기본값으로 실행할 수 있으며 필요한 항목만 셸 환경변수 또는 저장소 루트의 Git 제외 `.env`에 설정한다. 예시는 이 폴더의 `.env.example`에 있다.

| 변수 | 기본값 | 용도 |
|---|---|---|
| TAGBACK_HTTPS_PORT | 8443 | 호스트 HTTPS 포트 및 허용 localhost Origin |
| TAGBACK_TLS_DIR | ./deploy/compose/local/tls | server.crt와 server.key가 들어 있는 디렉터리 |
| NFC_BRIDGE_ID | kiosk-1 | 현재 서버가 신뢰할 브리지 식별자 |
| TAGBACK_API_IMAGE | tagback-api:local | API 이미지 이름·태그 |
| TAGBACK_WEB_IMAGE | tagback-web:local | 웹 이미지 이름·태그 |

`db-password`, `sms-hash-key`, `nfc-scan-secret`은 Compose secrets로 해당 서비스에만 마운트한다. 서버는 Spring config tree로 읽으며 이미지와 Compose 환경변수에 비밀 원문을 넣지 않는다. NFC 서명 비밀은 신뢰된 현장 리더기 설정과 일치해야 한다. 로컬 파일은 암호화된 비밀 저장소가 아니므로 파일 접근과 백업을 관리한다.

기존 DB 볼륨이 있으면 비밀번호 파일만 변경해 DB 비밀번호를 교체할 수 없다. PostgreSQL의 사용자 비밀번호 변경과 서버 비밀 갱신을 함께 수행해야 한다. 초기화 스크립트는 이를 자동으로 변경하지 않는다.

## 중지와 업데이트

```powershell
docker compose logs --tail 100 api
docker compose stop
docker compose up -d --wait
# 소스 변경 후 이미지 재빌드와 반영
docker compose up -d --build --wait
```

DB는 `postgres_data` 영구 볼륨에 저장된다. `stop`이나 일반 `down`으로 데이터를 지우지 않는다. **`down -v`는 DB 볼륨을 삭제하므로 일반 종료 명령으로 사용하지 않는다.** 단일 서버에서 컨테이너를 교체하면 잠시 서비스가 중단될 수 있으며 무중단 배포를 보장하지 않는다.

이미지 레지스트리를 결정하고 버전 이미지를 게시한 뒤에는 이미지 변수를 고정한 후 `docker compose pull api web`, `docker compose up -d --no-build --wait`로 교체할 수 있다. 이번 작업은 레지스트리 게시나 외부 서버 배포를 수행하지 않는다. 운영 공개 전에는 실제 SMS/인증, 도메인·인증서, 외부 포트, 백업, 이미지 고정 및 DB 마이그레이션/복구 정책을 확정해야 한다.

## 백업

저장소 루트에서 아래 명령은 컨테이너 안에 dump를 만든 뒤 호스트로 복사한다. PowerShell의 바이너리 리다이렉션에 의존하지 않는다. 대상 파일명은 기존 백업과 겹치지 않게 정한다.

```powershell
docker compose exec -T db pg_dump -U tagback_user -d tagback -Fc -f /tmp/tagback-backup.dump
docker compose cp db:/tmp/tagback-backup.dump ../tagback-backup.dump
```

백업은 Git 밖의 별도 보관 위치로 옮기고 실제 복원 검증을 별도로 수행한다. 볼륨 자체는 백업을 대신하지 않는다. 앱 이미지 롤백만으로 DB 마이그레이션까지 되돌아가지 않는다.

## 확인

```powershell
docker compose config --quiet
# 자체 서명 로컬 인증서에 한해 이번 검사 요청에서만 검증 생략
pwsh -NoProfile -File deploy/compose/Test-Compose.ps1 -SkipCertificateCheck
```

확인 스크립트는 실제 HTTPS 경로·빌드 JS·공개 카탈로그·미인증 접근 거부·Secure 쿠키·Origin 검사를 수행한다. 사용자·물품·대여 데이터를 생성하지 않는다. 이는 전체 업무 회귀나 실제 SMS·NFC 검증을 대신하지 않는다.

## 임시 인증코드 콘솔 확인 (2026-11-18)

카카오톡 챗봇 연동 전까지 `sms-mock`에서 인증 요청이 DB에 커밋되면 API 서버 콘솔에 인증코드를 출력한다. 웹에서 기존 인증번호 발송 버튼을 누른 뒤 아래 로그의 `code` 6자리를 입력한다. 실제 문자는 발송하지 않는다.

```powershell
# 변경 소스를 포함하는 이 작업 폴더에서 API 이미지를 다시 빌드한 뒤 확인
docker compose up -d --build --wait api
docker compose logs -f --tail 50 api
```

로그 예시: `[SMS-CONSOLE] phone=***5678 purpose=SIGNUP code=012345 expiresAt=2026-11-18T00:05:00Z requestId=...`

`phone`은 전화번호 끝 4자리, `purpose`는 가입(`SIGNUP`) 또는 PIN 재설정(`PIN_RESET`) 등 요청 용도다. `expiresAt`의 `Z`는 UTC를 뜻한다. 로컬에서 백엔드를 직접 실행하면 같은 로그가 실행 터미널에 표시된다. 재발송 시 최신 코드를 사용하며 기존 만료·재발송 제한·검증 규칙은 유지한다. 동일 요청 재시도는 새 로그/코드를 만들지 않는다.

콘솔 출력은 `MockSmsDelivery`의 커밋 후 발송 지점에 모아 두었다. 챗봇 도입 시 이 발송 경로를 교체하고 콘솔 코드 출력을 제거한다. 현재 로그에는 임시 인증코드가 포함되므로 공유하지 않는다. `prod`/`production`에서는 기존과 같이 mock 발송이 활성화되지 않으며 운영 인증 전환은 별도다. 새 worktree에는 Git 제외 비밀·TLS 설정이 자동 복사되지 않으므로 Compose 최초 설정은 위 초기화 안내를 따른다.

## 키오스크 배포 정책

2026-11-13 검증: 웹/API 이미지 빌드, 3개 서비스 healthy, 실제 PostgreSQL Flyway 20개, 위 HTTPS 확인 스크립트, DB 컨테이너 재생성 시 cluster ID 유지, API 재생성 후 재확인에 통과했다. 검증 프로젝트는 `tagback-compose-check`, 포트는 18443이며 종료 후 볼륨·이미지를 보존했다. 기본 `tagback` 프로젝트는 시작하지 않았다.

Windows 설치 파일과 향후 Android APK는 GitHub Releases에서 운영자가 수동 설치·업데이트한다. Compose는 공통 서버만 담당한다. 앱 자동 업데이트는 현재 범위에서 제외하며 Android 개발 보류를 유지한다.

## UI/UX 로컬 웹 교체 실행 (2026-11-19)

기존 tagback-compose 작업 폴더와 TLS 파일이 삭제되어, 실행 중인 tagback API/DB와 tagback_default 네트워크를 사용하는 웹 전용 구성을 추가했다. 기존 API/DB는 재생성하지 않았다. 이 구성은 새 환경 전체를 설치하는 용도가 아니다.

```powershell
docker compose -f deploy/compose/ui-preview.compose.yaml up -d --build --no-deps --wait web
```

실행 폴더: C:/Projects/tagback-ui-ux. 사용자 https://localhost:8443/mobile, 관리자 https://localhost:8443/admin/login, 브라우저 키오스크 https://localhost:8443/kiosk. 새 자체 서명 localhost 인증서를 deploy/compose/local/tls에 만들었으며 Git 제외 상태다. OS 신뢰 저장소는 변경하지 않았다. 설치 앱의 인증서 설정은 별도이며 이번에는 설치 앱을 업데이트하지 않았다.

이미지 tagback-web:uiux-20261119, 이전 웹 이미지 보존 태그 tagback-web:before-uiux-20261119. 웹 전용 Compose 실행 시 기존 api/db가 orphan으로 표시되지만 계속 사용하므로 --remove-orphans를 사용하지 않는다. 전체 compose.yaml 재시작에는 삭제된 API/DB 비밀 파일 등의 복구가 먼저 필요하다.

Docker 빌드 성공 및 3개 컨테이너 healthy 확인. 실제 HTTPS 로그인/공개 물품/관리자 로그인/키오스크 렌더·API health 200 및 브라우저 pageerror 0 확인. 관리자 인증 후 화면·실제 NFC 거래·SMS 발송은 수행하지 않았다.
