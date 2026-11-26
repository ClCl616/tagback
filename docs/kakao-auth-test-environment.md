# 카카오 인증 스킬 시험 환경

2026-11-19 별도 Compose 프로젝트 `tagback-kakao-auth-test`의 빈 PostgreSQL에 Flyway V1~V23을 적용하고 V21~V23의 성공을 확인했다. 기존 프로젝트 DB는 사용하거나 변경하지 않았다. `kakao-auth` 개발 프로필과 임시 Cloudflare Quick Tunnel을 사용하며 운영 환경이 아니다.

프록시는 `POST /api/v1/auth/kakao/skill`만 공개하고 접근 로그를 끈다. 공개 HTTPS에서 비밀 헤더 누락 403, 올바른 헤더와 빈 JSON 요청의 카카오 형식 실패 응답 200, 다른 경로 404를 확인했다. 이는 실제 카카오 대화와 인증 성공을 검증한 결과가 아니다.

스킬 URL은 터널 로그에서 확인한다. 터널을 다시 만들면 주소가 바뀔 수 있다.

```powershell
docker compose -f deploy/compose/kakao-auth-test.yaml logs tunnel
```

표시된 `https://…trycloudflare.com` 뒤에 `/api/v1/auth/kakao/skill`을 붙인다. 스킬의 운영 및 테스트 요청 헤더 `X-Tagback-Skill-Secret`에는 `deploy/compose/local/kakao-auth-test/skill-secret`의 값을 설정한다. 비밀은 대화, 저장소, 로그에 기록하지 않는다. 해당 로컬 디렉터리는 Git 제외 대상이지만 암호화 저장소는 아니다.

2026-11-19 전달받은 실제 봇 ID를 Git 제외 파일 `deploy/compose/local/kakao-auth-test/bot.env`에 설정하고 시험 API를 재생성했다. TagBack 운영 채널을 챗봇에 연결하고 채널 공개·검색 및 채팅을 켰다. `TagBack 인증` 스킬의 URL과 운영·시험 헤더를 저장하고 카카오 관리자센터에서 정상 스킬 응답을 확인했다. 폴백 블록에 스킬과 스킬데이터 응답을 연결해 저장했으며, 봇 테스트에서 임의의 10자리 입력이 해당 스킬로 전달되어 인증 요청 확인 실패 안내를 반환함을 확인했다. 인식되지 않은 다른 발화도 폴백에서 이 인증 스킬을 사용한다. 17:05에 전체 배포 v1.1 완료를 확인했다.

사용자 웹과 챌린지 발급 경로는 공개 프록시에 포함되어 있지 않다. 2026-11-19 같은 격리 DB와 API에 연결된 사용자 웹을 `https://localhost:8443/mobile`에 실행했고, 시험용 자체 서명 인증서로 HTTPS 200을 확인했다. 웹은 이 PC에서만 접근할 수 있다. 웹 이미지와 Git 제외 로컬 설정에 채널 URL을 반영했다. 브라우저에서는 자체 서명 인증서 경고가 나타날 수 있다.

같은 날 실제 카카오톡의 TagBack 채널과 로컬 웹으로 시험용 사용자 가입, PIN 재설정, 재설정으로 브라우저 등록이 폐기된 뒤 카카오 인증과 새 PIN으로 로그인까지 확인했다. 별도 물리 브라우저나 기기는 사용하지 않았다. 취소·만료·재시도, 채널 이동 버튼, 실제 키오스크와 운영 환경 시험은 별도로 남아 있다. 시험 계정과 카카오 식별값의 연결은 격리 DB에 남아 있다.

```powershell
docker compose --env-file deploy/compose/local/kakao-auth-test/bot.env -f deploy/compose/kakao-auth-test.yaml up -d api
```

초기 비밀 생성은 `powershell -NoProfile -ExecutionPolicy Bypass -File deploy/compose/Initialize-KakaoAuthTest.ps1`로 수행하며 기존 비밀 파일을 덮어쓰지 않는다. 시험이 끝나면 `docker compose -f deploy/compose/kakao-auth-test.yaml stop`으로 중지한다. 볼륨은 유지된다. 시험 데이터를 실사용에 사용하지 않는다.
