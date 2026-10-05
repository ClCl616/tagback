# TagBack PostgreSQL 개발환경 설정

TagBack 백엔드 프로젝트의 로컬 PostgreSQL 데이터베이스 설정 방법입니다.

Spring Boot 실행 시 Flyway가 `db/migration` 폴더의 SQL 파일을 순서대로 실행하여 필요한 테이블을 자동으로 생성합니다.

---

## 1. 개발 환경

- PostgreSQL: 17.x
- Database: `tagback`
- Database User: `tagback_user`
- Spring Boot
- Spring Data JPA
- Flyway

> 각 개발자는 자신의 로컬 PostgreSQL에 `tagback` 데이터베이스를 생성해야 합니다.

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
psql -U tagback_user -d tagback
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

프로젝트의 `application.properties`는 다음과 같이 환경변수를 사용합니다.

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

`setx`로 등록한 경우 현재 실행 중인 IntelliJ와 PowerShell에는 바로 반영되지 않을 수 있으므로 프로그램을 다시 실행합니다.

> 실제 비밀번호는 GitHub, README, `application.properties` 등에 작성하지 않습니다.

---

## 6. Flyway Migration

TagBack은 Flyway를 사용하여 데이터베이스 구조를 관리합니다.

Migration 파일 위치:

```text
src/main/resources/db/migration/
```

현재 파일 구성:

```text
V1__create_users_table.sql
V2__create_item_types_table.sql
V3__create_items_table.sql
V4__create_nfc_tags_table.sql
V5__create_rentals_table.sql
V6__create_inspections_table.sql
V7__add_active_rental_unique_index.sql
```

각 Migration의 역할:

| Version | 내용 |
|---|---|
| V1 | 회원 `users` 테이블 생성 |
| V2 | 물품 종류 `item_types` 테이블 생성 |
| V3 | 개별 물품 `items` 테이블 생성 |
| V4 | NFC 태그 `nfc_tags` 테이블 생성 |
| V5 | 대여/반납 `rentals` 테이블 생성 |
| V6 | 점검 `inspections` 테이블 생성 |
| V7 | 동일 물품 중복 대여 방지 인덱스 생성 |

---

## 7. Spring Boot 실행

환경변수와 PostgreSQL 설정이 완료되면 Spring Boot 애플리케이션을 실행합니다.

IntelliJ에서 애플리케이션을 실행하거나 Windows PowerShell에서 다음 명령어를 사용할 수 있습니다.

```powershell
.\gradlew.bat bootRun
```

Spring Boot가 실행되면 Flyway가 아직 적용되지 않은 Migration을 자동으로 실행합니다.

따라서 테이블을 PostgreSQL에서 직접 `CREATE TABLE` 할 필요가 없습니다.

---

## 8. 테이블 생성 확인

Spring Boot 실행 후 PostgreSQL에 접속합니다.

```powershell
psql -U tagback_user -d tagback
```

전체 테이블 확인:

```sql
\dt
```

정상적으로 설정되었다면 다음 테이블들이 존재해야 합니다.

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

정상적인 경우 V1부터 V7까지 존재하며 모든 `success` 값이 `t`로 표시되어야 합니다.

예시:

```text
1 | 1 | create users table             | t
2 | 2 | create item types table        | t
3 | 3 | create items table             | t
4 | 4 | create nfc tags table          | t
5 | 5 | create rentals table           | t
6 | 6 | create inspections table       | t
7 | 7 | add active rental unique index | t
```

---

## 10. 주요 테이블 관계

현재 TagBack MVP의 데이터베이스 관계는 다음과 같습니다.

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

현재 MVP는 대여소 1곳을 기준으로 개발하므로 별도의 대여소 테이블은 사용하지 않습니다.

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

한 번 DB에 적용된 Migration 파일은 가급적 수정하지 않습니다.

예를 들어 V1~V7이 적용된 상태에서 DB 구조를 추가로 변경해야 한다면 기존 파일을 수정하지 않고 새로운 Migration을 추가합니다.

```text
V8__xxxxx.sql
V9__xxxxx.sql
```

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
- Flyway V1~V7 적용 성공
- `users`, `item_types`, `items`, `nfc_tags`, `rentals`, `inspections` 테이블 생성 확인

위 항목이 모두 정상이라면 TagBack 백엔드 DB 개발환경 설정이 완료된 것입니다.