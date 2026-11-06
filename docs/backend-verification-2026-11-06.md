# 백엔드 전체 테스트 결과

- 실행일: 2026-11-06 (Asia/Seoul)
- 대상 커밋: `8841363aef27cb27ff78163f17db900e8268f212` (`feature/search-filter-query`)
- 테스트 실행 시 애플리케이션 코드 변경 없음. 이 문서와 실행 스크립트는 해당 커밋 이후 추가했다.

## 결과

| 실행 | 범위 | 전체 | 실패 | 건너뜀 |
|---|---|---:|---:|---:|
| `gradlew.bat test --rerun-tasks` | 기본 환경 | 247 | 0 | 113 |
| `test-all-postgres.ps1` 1차 | 전체 및 격리 PostgreSQL opt-in 테스트 | 247 | 1 | 0 |
| `test-all-postgres.ps1` 2차 | 동일 범위 재실행 | 247 | 0 | 0 |

기본 환경에서 건너뛴 113개는 DB 통합 테스트를 활성화하는 환경변수가 없기 때문이다. 인증 테스트는 `TAGBACK_AUTH_SCHEMA_TEST=true`, 물품·대여 및 일부 태그 테스트는 `TAGBACK_ITEM_DB_TEST=true`, 태그 생명주기·동시성 테스트는 비어 있지 않은 `TAGBACK_DB_PASSWORD`를 요구한다. 전체 DB 실행에서는 두 임시 PostgreSQL 클러스터를 만들고 필요한 변수와 테스트 DB 연결을 설정했다. 실제 개발 DB나 운영 DB는 사용하지 않았다.

## 발견된 동시성 실패

1차 실행에서 `TagRegistrationConcurrencyIntegrationTest.concurrentRetryOfSameItemAndUidCreatesOnlyOneTag`가 실패했다. 같은 물품과 UID를 동시에 등록할 때 두 요청 중 하나가 예상한 기존 연결 응답 대신 `TAG_ALREADY_REGISTERED`를 반환했다. 2차 실행에서는 통과했으므로 간헐적인 경합으로 보이며, 재실행 통과만으로 문제가 해결된 것은 아니다.

실패 스택은 `TagRegistrationService.register`의 UID 중복 확인에서 발생했다. 물품의 활성 태그 확인과 UID 확인 사이에 다른 요청이 등록을 완료하면 같은 물품인지 다시 확인하지 않은 채 충돌로 처리될 가능성이 있다. 이 설명은 코드와 실패 스택을 근거로 한 추정이며, 결정적인 동시성 재현 테스트로 확인하고 수정해야 한다. 이 검증에서는 애플리케이션 로직을 수정하지 않았다.

### 수정 후 추가 검증

이후 동일 브랜치의 작업 트리에서 UID 중복 확인 시 물품의 활성 태그를 재조회하도록 수정했다. 첫 물품 조회 이후 동일 연결이 등록되는 순서를 단위 테스트로 재현하고, 비활성 UID와 다른 물품의 UID는 충돌로 유지하는 테스트를 확인했다. 격리 PostgreSQL 전체 테스트는 **287개 실행, 실패 0개, 건너뜀 0개**로 통과했다. 두 동시 등록 시나리오는 각각 20회씩 실행했다. 이 결과는 위 커밋에 아직 포함되지 않은 수정본에 대한 것이며, 실물 리더기는 사용하지 않았다.

1차 XML 결과는 `backend/build/test-results/full-first`에 보존했고, 2차 결과는 `backend/build/test-results/test`에 있다. Gradle 빌드 산출물은 추후 실행·정리 시 바뀔 수 있다.

## 재실행

PostgreSQL 17과 Java 21이 설치된 환경에서 backend 디렉터리의 PowerShell:

```powershell
& ./scripts/test-all-postgres.ps1 -ItemPort 55449
```

인증 테스트는 코드에 고정된 55439 포트를 사용한다. 해당 포트와 지정한 물품 테스트 포트가 비어 있어야 한다. 스크립트는 고유한 임시 DB 클러스터 두 개를 사용하고 종료하며, 진단을 위해 클러스터 파일과 로그는 남긴다. Gradle 의존성은 이미 캐시되어 있어야 한다(`--offline`). PostgreSQL 설치 경로가 다르면 `-PostgresBin`을 지정한다.

이 결과는 자동화 테스트에 대한 것이다. 실제 SMS 공급자, 운영 인증, 실물 NFC 리더기의 통합 검증은 포함하지 않는다.
