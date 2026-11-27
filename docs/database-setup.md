# TagBack PostgreSQL 개발환경 설정

TagBack 백엔드 프로젝트의 로컬 PostgreSQL 데이터베이스 설정 방법입니다.

Spring Boot 실행 시 Flyway가 `backend/src/main/resources/db/migration/`의 미적용 SQL 파일을 버전 순서대로 실행합니다. 이 문서는 로컬 PostgreSQL 직접 실행 기준입니다. Docker Compose 환경은 [Compose 안내](../deploy/compose/README.md)를 참고하세요.

---

## 1. 개발 환경

- PostgreSQL: 17.x
- Java: 21
- Database: `tagback`
- Database User: `tagback_user`
- Spring Boot
- Spring Data JPA
- Flyway

> 직접 실행하는 경우 로컬 PostgreSQL에 `tagback` 데이터베이스를 생성합니다. 이미 존재하는 사용자와 DB는 새로 만들지 말고 설정을 확인하세요.

---

## 2. PostgreSQL 설치 확인

PowerShell에서 다음 명령어를 실행합니다.

```powershell
psql --version
```

정상적으로 설치되어 있다면 다음과 같이 PostgreSQL 버전이 출력됩니다.

```text
psql (PostgreSQL) 17.x
```

`psql` 명령어가 인식되지 않는 경우 PostgreSQL의 `bin` 경로가 환경변수 `Path`에 등록되어 있는지 확인합니다.

---

## 3. PostgreSQL 사용자 및 데이터베이스 생성

PostgreSQL 관리자 계정으로 접속합니다.

```powershell
psql -U postgres
```

접속 후 TagBack용 사용자를 생성합니다.

```sql
CREATE USER tagback_user WITH PASSWORD '본인이 사용할 비밀번호';
```

TagBack 데이터베이스를 생성하고 `tagback_user`를 소유자로 설정합니다.

```sql
CREATE DATABASE tagback
OWNER tagback_user;
```

완료 후 PostgreSQL에서 나옵니다.

```sql
\q
```

---

## 4. TagBack DB 접속 확인

다음 명령어로 생성한 데이터베이스에 접속합니다.

```powershell
psql -h localhost -U tagback_user -d tagback
```

비밀번호 입력 후 아래와 같은 프롬프트가 나타나면 정상적으로 접속된 상태입니다.

```text
tagback=>
```

접속 종료:

```sql
\q
```

---

## 5. DB 비밀번호 환경변수 설정

보안을 위해 실제 PostgreSQL 비밀번호는 Git에 저장하지 않습니다.

확인된 백엔드의 `application.properties`는 다음과 같이 환경변수를 사용합니다. 실제 실행 시에는 해당 코드의 설정도 확인하세요.

```properties
spring.datasource.url=jdbc:postgresql://localhost:5432/tagback
spring.datasource.username=tagback_user
spring.datasource.password=${TAGBACK_DB_PASSWORD}
spring.datasource.driver-class-name=org.postgresql.Driver

spring.jpa.hibernate.ddl-auto=validate
```

따라서 각 개발자는 자신의 컴퓨터에 `TAGBACK_DB_PASSWORD` 환경변수를 설정해야 합니다.

### Windows PowerShell - 현재 터미널에서만 설정

```powershell
$env:TAGBACK_DB_PASSWORD="본인의 DB 비밀번호"
```

### Windows - 환경변수 영구 등록

```powershell
setx TAGBACK_DB_PASSWORD "본인의 DB 비밀번호"
```

`setx`는 Windows 사용자 환경변수에 값을 저장합니다. 현재 실행 중인 IntelliJ와 PowerShell에는 바로 반영되지 않을 수 있으므로 프로그램을 다시 실행합니다. IntelliJ를 별도로 실행한다면 실행 환경에도 변수가 설정되어 있는지 확인하세요.

> 실제 비밀번호는 GitHub, README, `application.properties` 등에 작성하지 않습니다.

---

## 6. Flyway Migration

TagBack은 Flyway를 사용하여 데이터베이스 구조를 관리합니다.

Migration 파일 위치:

```text
backend/src/main/resources/db/migration/
```

마이그레이션에는 사용자·물품·태그·대여·점검 테이블과 인증·관리자·물품 상태·대여 및 반납 관련 스키마 변경이 포함됩니다. 실행하는 코드의 폴더에서 전체 파일과 최신 버전을 확인하세요.

기존 DB를 다른 버전의 코드에 연결하기 전에는 파일 버전과 DB의 적용 이력을 비교하세요. 동일한 버전에 서로 다른 내용이 있으면 Flyway checksum 검증이 실패할 수 있습니다. 충돌은 적용 이력과 마이그레이션 파일을 확인해 해결하고, DB나 Flyway 이력을 임의로 초기화하거나 수정하지 마세요.

저장소 루트에서 파일을 확인할 수 있습니다. 출력은 사전순일 수 있으며 Flyway는 숫자 버전 순서대로 적용합니다.

```powershell
Get-ChildItem backend/src/main/resources/db/migration -Filter 'V*.sql' | Sort-Object Name | Select-Object -ExpandProperty Name
```

---

## 7. Spring Boot 실행

환경변수와 PostgreSQL 설정이 완료되면 Spring Boot 애플리케이션을 실행합니다.

IntelliJ에서 애플리케이션을 실행하거나 저장소 루트에서 Windows PowerShell로 다음 명령어를 사용할 수 있습니다. 카카오톡 로그인, 관리자 인증과 NFC 연동에 필요한 설정은 실행하는 코드의 안내에 따라 별도로 준비합니다.

```powershell
.\backend\gradlew.bat -p backend bootRun
```

Spring Boot가 실행되면 Flyway가 아직 적용되지 않은 Migration을 자동으로 실행합니다.

따라서 테이블을 PostgreSQL에서 직접 `CREATE TABLE` 할 필요가 없습니다.

---

## 8. 테이블 생성 확인

Spring Boot 실행 후 PostgreSQL에 접속합니다.

```powershell
psql -h localhost -U tagback_user -d tagback
```

전체 테이블 확인:

```sql
\dt
```

정상적으로 설정되었다면 다음 주요 테이블들이 존재해야 합니다. 전체 목록은 실행한 브랜치의 마이그레이션에 따라 달라집니다.

```text
flyway_schema_history
users
item_types
items
nfc_tags
rentals
inspections
```

---

## 9. Flyway 적용 상태 확인

다음 SQL을 실행합니다.

```sql
SELECT installed_rank, version, description, success
FROM flyway_schema_history
ORDER BY installed_rank;
```

실행 중인 코드의 마이그레이션 파일과 적용된 버전·설명을 비교하고 적용 행의 `success` 값이 `t`인지 확인합니다. 최신 마이그레이션까지 적용되었는지도 파일 목록과 비교하세요.

---

## 10. 주요 테이블 관계

주요 물품·대여 테이블의 관계는 다음과 같습니다. 인증·관리자·상태 이력 등 모든 테이블을 나타낸 그림은 아닙니다.

```text
item_types
    │
    └── items
          ├── nfc_tags
          ├── rentals ─── users
          └── inspections
```

- `users`: 사용자 정보
- `item_types`: 물품 종류
- `items`: 실제 개별 물품
- `nfc_tags`: 개별 물품에 연결된 NFC 태그
- `rentals`: 사용자와 물품의 대여 및 반납 기록
- `inspections`: 물품 점검 및 손상 상태 기록

현재 구성은 대여소 1곳을 기준으로 하며 별도의 대여소 테이블은 사용하지 않습니다.

---

## 11. 개발 시 주의사항

### DB 비밀번호를 Git에 올리지 않기

다음과 같이 실제 비밀번호를 작성하면 안 됩니다.

```properties
spring.datasource.password=실제비밀번호
```

환경변수를 사용합니다.

```properties
spring.datasource.password=${TAGBACK_DB_PASSWORD}
```

### 이미 적용된 Flyway 파일 수정하지 않기

이미 공유되거나 DB에 적용된 Migration 파일은 수정하지 않고 새 버전을 추가합니다.

새 버전은 통합 대상 브랜치의 마이그레이션과 충돌하지 않도록 정합니다. 기존 파일을 변경하면 Flyway checksum 검증에 실패할 수 있습니다.

### 테이블을 직접 수정하지 않기

팀원들의 DB 구조를 동일하게 유지하기 위해 가능한 한 PostgreSQL에서 직접 테이블 구조를 변경하지 않고 Flyway Migration 파일을 통해 변경합니다.

---

## 12. 최종 확인

개발을 시작하기 전에 다음 항목을 확인합니다.

- PostgreSQL 17.x 설치
- `tagback_user` 생성
- `tagback` 데이터베이스 생성
- `TAGBACK_DB_PASSWORD` 환경변수 설정
- Spring Boot 실행 성공
- 현재 체크아웃의 Flyway Migration 전체 적용 성공
- `users`, `item_types`, `items`, `nfc_tags`, `rentals`, `inspections` 테이블 생성 확인

위 항목들은 기본 DB 연결과 스키마 적용을 확인합니다. 카카오 로그인, 관리자 인증, NFC 및 대여·반납 기능은 별도 설정과 검증이 필요합니다.
