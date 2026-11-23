# 카카오 인증 프로필 전환 준비

상태: 격리 PostgreSQL에서 개발·운영 프로필의 인증·대여·반납 회귀 테스트를 통과했다. 이 문서는 실제 서버 설정이나 배포를 수행하지 않는다. 실제 카카오 대화, 공개 HTTPS, 서버·프록시의 비밀 로그, 응답 시간과 운영 부하 검증도 완료되지 않았다.

## 프로필

- SMS mock 인증 API와 서비스는 제거했다. 이전 `sms-mock` 프로필은 인증 기능을 활성화하지 않는다.
- `kakao-auth`: 카카오 인증과 공통 인증·대여 기능을 검증하기 위한 개발용 구성이다. `prod` 또는 `production`과 함께 활성화해도 이 개발 프로필 자체는 운영 기능을 활성화하지 않는다.
- `kakao-live`와 `prod` 또는 `production`: 카카오 인증과 공통 인증·대여 기능을 활성화하는 명시적 운영 구성이다. `prod` 또는 `production`만으로는 인증 기능을 활성화하지 않는다. 운영 환경에서는 SMS mock 및 카카오 probe 구성요소를 활성화하지 않는다.

운영 구성에는 서로 다른 32자 이상의 비밀 `tagback.auth.common-hash-key`, `tagback.kakao.hmac-key`, `tagback.kakao.skill-secret`, `tagback.nfc.scan-secret`, `tagback.kakao.bot-id`, `tagback.nfc.bridge-id`, 그리고 명시적인 HTTPS Origin 목록 `tagback.auth.allowed-origins`가 필요하다. 실제 값은 운영 환경의 비밀 저장소와 설정에서 제공한다. 값이 없거나 짧거나 비밀이 서로 같거나 Origin이 유효한 HTTPS Origin이 아니면 시작을 거부한다. Origin은 쉼표로 구분하고 경로를 포함하지 않는다.

공통 해시 키가 바뀌면 기존 발급 코드와 멱등성 재시도에 영향을 줄 수 있다. 환경 전환 전 사용 중인 요청과 코드의 만료·키 교체 방식을 별도로 확인한다. 기존 개발 DB와 SMS 데이터는 앞서 정한 방침에 따라 전환 검증이 끝날 때까지 보존한다.

최종 사용자 인증은 카카오 챗봇과 PIN을 사용한다. SMS mock 인증 코드와 화면은 제거했으며 기존 Flyway 이력과 DB 데이터는 이미 적용된 DB와의 호환성 및 기존 데이터 보존 방침에 따라 유지한다.
