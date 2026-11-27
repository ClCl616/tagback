# TagBack Docker Compose 실행

Docker Compose를 사용해 TagBack의 웹, API, 데이터베이스를 로컬에서 함께 실행합니다.

| 서비스 | 구성 | 역할 |
|---|---|---|
| `web` | Nginx | HTTPS 웹 제공 및 API 요청 전달 |
| `api` | Spring Boot | 인증·물품·대여·반납·태그 API |
| `db` | PostgreSQL 17 | 사용자·물품·대여 등의 데이터 저장 |

이 구성은 **로컬 개발과 통합 확인용**입니다. Windows 키오스크 앱과 NFC 리더기는 각각의 장치에서 별도로 실행합니다.

---

## 준비 사항

- Docker Desktop 및 Linux 컨테이너 엔진
- PowerShell
- PowerShell 7 (`pwsh`)
- 최초 이미지와 의존성을 내려받을 인터넷 연결

Java, Node.js, pnpm과 Gradle은 Docker 이미지 빌드 단계에서 사용하므로 Compose 실행을 위해 호스트에 별도로 설치할 필요가 없습니다.

---

## 최초 실행

Docker Desktop을 실행한 뒤 저장소 루트에서 다음 명령을 실행합니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/compose/Initialize-Compose.ps1

pwsh -NoProfile -File deploy/compose/Set-AdminPassword.ps1

docker compose up -d --build --wait --wait-timeout 240
docker compose ps
```

최초 실행 시 이미지와 의존성을 내려받으므로 시간이 걸릴 수 있습니다.

초기화 스크립트는 로컬 실행에 필요한 비밀값과 localhost용 자체 서명 인증서를 `deploy/compose/local/`에 생성합니다. 기존 비밀값과 인증서는 덮어쓰지 않습니다.

관리자 비밀번호 설정 스크립트는 비밀번호를 두 번 입력받아 해시를 저장합니다. 공통 관리자 비밀번호를 설정하지 않으면 관리자 로그인이 차단됩니다.

---

## 접속 주소

기본 HTTPS 포트는 `8443`입니다.

| 화면 | 주소 |
|---|---|
| 사용자 웹 | `https://localhost:8443/mobile` |
| 관리자 웹 | `https://localhost:8443/admin` |
| 브라우저 키오스크 | `https://localhost:8443/kiosk` |

초기화 스크립트가 생성한 인증서는 자체 서명 인증서이므로 브라우저에 인증서 경고가 표시될 수 있습니다.

스크립트는 인증서를 운영체제의 신뢰 저장소에 자동으로 등록하지 않습니다. 로컬 개발에 신뢰된 localhost 인증서를 사용하는 경우 인증서와 키를 설정된 TLS 디렉터리에 제공합니다.

인증서 검증을 전역적으로 해제하지 않습니다.

---

## 서비스 구성

Compose는 다음 순서로 서비스를 시작합니다.

1. PostgreSQL 준비
2. Spring Boot API 시작
3. Nginx 웹 시작

DB와 API는 Compose 네트워크에서 통신합니다. 기본 구성에서 DB와 API 포트는 호스트에 직접 공개하지 않으며, 웹 HTTPS 포트도 `127.0.0.1`에만 연결됩니다.

Spring Boot가 시작되면 Flyway가 적용되지 않은 DB 마이그레이션을 실행합니다.

기본 물품이나 일반 사용자 계정은 자동으로 생성하지 않습니다.

---

## 사용자 및 관리자 인증

사용자는 카카오톡 로그인으로 가입하고 로그인합니다. 카카오톡 로그인에 필요한 설정과 콜백 주소는 최종 인증 구현의 실행 환경에 맞게 준비해야 합니다.

관리자는 사용자 계정과 분리된 공통 비밀번호로 로그인합니다.

관리자는 웹에서 물품을 태그 등록 대기 상태로 생성하고, NFC 리더기가 연결된 키오스크 관리자 모드에서 태그를 연결하거나 교체합니다.

관리자 비밀번호와 태그 등록 방법은 [공통 관리자와 키오스크 태그 등록](../../docs/shared-admin-kiosk-tags.md)을 참고하세요.

> 현재 원격 `develop`에서 확인한 Compose 구성은 이전 `sms-mock` 프로필을 사용합니다. 최종 카카오톡 로그인 구현의 프로필·환경변수·비밀값·콜백 설정이 Compose에 반영되었는지 확인한 뒤 사용자 로그인 흐름을 실행해야 합니다.

---

## 환경 설정

필요한 설정은 셸 환경변수 또는 저장소 루트의 Git 제외 `.env` 파일에 지정할 수 있습니다. 설정 예시는 `deploy/compose/.env.example`을 참고하세요.

| 변수 | 기본값 | 용도 |
|---|---|---|
| `TAGBACK_HTTPS_PORT` | `8443` | 호스트 HTTPS 포트 및 허용 localhost Origin |
| `TAGBACK_TLS_DIR` | `./deploy/compose/local/tls` | `server.crt`와 `server.key`가 있는 디렉터리 |
| `NFC_BRIDGE_ID` | `kiosk-1` | 서버가 신뢰할 NFC 브리지 식별자 |
| `TAGBACK_API_IMAGE` | `tagback-api:local` | API 이미지 이름과 태그 |
| `TAGBACK_WEB_IMAGE` | `tagback-web:local` | 웹 이미지 이름과 태그 |

NFC 브리지 식별자와 서명 비밀은 실제 연결할 리더기 설정과 일치해야 합니다.

카카오톡 로그인 관련 설정의 이름과 필수 값은 최종 구현에 포함된 설정을 기준으로 확인합니다.

---

## 비밀값 관리

현재 확인된 Compose 구성은 DB 비밀번호, 관리자 비밀번호 해시, 인증 관련 비밀값과 NFC 서명 비밀을 Compose secrets로 전달합니다.

초기화된 파일은 `deploy/compose/local/` 아래에 저장되며 Git과 Docker 빌드 문맥에서 제외됩니다. 실제 비밀번호와 키는 코드, 문서, 이미지 또는 공개 로그에 기록하지 않습니다.

로컬 비밀 파일 자체가 암호화된 비밀 저장소는 아니므로 파일 접근 권한과 백업을 관리해야 합니다.

### DB 비밀번호 변경

기존 DB 볼륨이 있는 상태에서는 비밀번호 파일만 바꿔 PostgreSQL 사용자 비밀번호를 변경할 수 없습니다.

PostgreSQL 사용자의 비밀번호와 API가 사용하는 비밀값을 함께 갱신해야 합니다. 초기화 스크립트는 기존 DB 사용자의 비밀번호를 자동으로 바꾸지 않습니다.

---

## 서비스 상태 확인

저장소 루트에서 실행합니다.

```powershell
docker compose ps
docker compose logs --tail 100 api
```

Compose 설정을 확인하려면 다음 명령을 사용합니다.

```powershell
docker compose config --quiet
```

제공된 확인 스크립트는 HTTPS 경로, 공개 카탈로그, 미인증 접근 거부, 쿠키와 Origin 관련 동작 등을 확인합니다.

```powershell
pwsh -NoProfile -File deploy/compose/Test-Compose.ps1
```

로컬 자체 서명 인증서로 시험하는 경우에는 해당 검사 요청에 한해 인증서 검사를 생략할 수 있습니다.

```powershell
pwsh -NoProfile -File deploy/compose/Test-Compose.ps1 -SkipCertificateCheck
```

이 확인은 전체 업무 회귀, 실제 카카오톡 로그인 또는 실물 NFC 리더기 검증을 대신하지 않습니다. 최종 인증 구현에 맞게 스크립트가 갱신되었는지도 확인해야 합니다.

---

## 중지와 재시작

```powershell
docker compose stop
docker compose up -d --wait
```

소스 변경을 반영하려면 이미지를 다시 빌드합니다.

```powershell
docker compose up -d --build --wait
```

DB 데이터는 `postgres_data` 영구 볼륨에 저장됩니다. 일반적인 `stop` 또는 `down`은 해당 볼륨을 삭제하지 않습니다.

> `docker compose down -v`는 DB 볼륨을 삭제하므로 일반적인 종료 명령으로 사용하지 않습니다.

단일 서버에서 컨테이너를 교체하면 잠시 서비스가 중단될 수 있습니다. 이 구성은 무중단 배포를 보장하지 않습니다.

---

## 여러 작업 폴더에서 실행

서로 다른 작업 폴더에서 같은 Compose 프로젝트 이름을 사용하면 같은 Compose 자원을 가리킬 수 있습니다.

독립된 시험 환경이 필요하면 고유 프로젝트 이름을 지정하고, 시작·상태 확인·종료 등 모든 Compose 명령에 같은 이름을 사용합니다.

```powershell
docker compose -p tagback-test up -d --build --wait
docker compose -p tagback-test ps
docker compose -p tagback-test stop
```

동시에 실행할 경우 HTTPS 포트도 서로 다르게 설정해야 합니다.

---

## DB 백업

다음 명령은 컨테이너 안에 PostgreSQL 백업 파일을 만든 뒤 호스트로 복사합니다.

저장소 루트에서 실행하며, 기존 백업과 겹치지 않는 파일명을 사용합니다.

```powershell
docker compose exec -T db pg_dump -U tagback_user -d tagback -Fc -f /tmp/tagback-backup.dump

docker compose cp db:/tmp/tagback-backup.dump ../tagback-backup.dump
```

백업은 Git 외부의 별도 위치에 안전하게 보관하고, 실제 복원 가능 여부를 별도로 검증합니다.

DB 영구 볼륨은 백업을 대신하지 않습니다. 앱 이미지를 이전 버전으로 되돌려도 DB 마이그레이션은 자동으로 되돌아가지 않습니다.

---

## 운영 환경 적용

저장소의 기본 Compose 구성은 로컬 시험용입니다. 외부 운영 환경에 적용하기 전에는 별도의 운영 설정을 준비해야 합니다.

- 운영 도메인과 유효한 HTTPS 인증서
- 카카오톡 로그인에 필요한 운영 설정과 콜백 주소
- DB 사용자와 권한
- 개발용 API 차단
- 외부 포트 및 네트워크 접근 범위
- 이미지 버전 관리
- DB 백업·복원 및 마이그레이션 계획
- 비밀값 보관 및 교체 절차

현재 구성은 로컬 주소에 바인딩되어 있으므로 이를 그대로 외부 서비스 구성으로 간주하지 않습니다.

---

## 키오스크 앱

Docker Compose는 웹, API, DB 등 공통 서버를 실행합니다.

Windows 키오스크 설치 앱과 NFC 리더기는 키오스크 장치에서 별도로 설정하고 실행합니다. 자동 업데이트는 현재 범위에 포함되지 않으며, Android 구현은 보류 중입니다.

자세한 내용은 [Windows 키오스크 안내](../../kiosk/windows/README.md)를 참고하세요.
