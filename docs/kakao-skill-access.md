# 카카오 스킬 연결 확인 준비

이 문서는 개발용 연결 확인 기록이다. 이후 개발용 인증 스킬과 회원가입 API가 추가됐으며 운영용 종단 검증은 아직 진행하지 않았다.

## 2026-11-17 실제 카카오톡 식별값 시험

- 실제 카카오톡 계정에서 같은 채널과 봇에 두 번 발화한 결과, 두 요청 모두 `user.type=botUserKey`, `user.id` 및 `properties.botUserKey`, `properties.plusfriendUserKey`가 있었고 `appUserId`는 없었다. 두 번째 `user.id`는 첫 요청과 일치했다. 다른 계정, 장기간, 채널·봇 교체, 차단 및 재추가 등의 경우는 검증하지 않았다.
- 시험 API는 식별값 원문과 발화를 기록하거나 반환하지 않는다. 첫 `user.id`의 비교용 HMAC과 무작위 키는 서버 메모리에만 유지되고 서버 종료 시 사라진다. 다른 식별값은 존재 여부만 확인하므로 두 요청 사이 값의 일치 여부는 검증하지 않았다.
- 사용자 승인으로 임시 블록을 운영 채널에 배포하고 잠시 채널을 공개해 시험했다. 시험 후 카카오가 챗봇 사용 중 비공개 전환을 막아 사용자 승인으로 운영 채널과 챗봇의 연결을 해제하고 채널 공개와 검색 허용을 모두 껐다. 테스트 서버와 터널도 종료했다. 카카오 관리자센터에 임시 스킬·블록과 배포 이력은 남아 있으며, 스킬 URL은 임시 주소이므로 현재 동작하지 않는다. 재사용 전 새 주소 및 비밀 설정과 채널 재연결을 점검한다.
- [카카오 스킬 요청 형식](https://kakaobusiness.gitbook.io/main/tool/chatbot/skill_guide/answer_json_format)에 따르면 `user.id`는 봇마다 다르고 `appUserId`는 앱키 설정 시 제공된다. 이 시험 결과만으로 식별값의 영구성이나 사용자당 계정 하나를 보장할 수 없다.

## 2026-11-17 연결 시험 결과

- Docker Desktop과 격리된 테스트 DB·백엔드·프록시·Quick Tunnel을 실행했다. Compose 설정 검사와 백엔드 이미지 빌드가 성공했다.
- 임시 공개 HTTPS 주소에서 비밀 헤더가 없는 요청은 403, 올바른 헤더를 보낸 요청은 카카오 형식의 고정 응답과 함께 200, 다른 API 경로는 404를 반환했다.
- 카카오 챗봇 관리자센터의 스킬 테스트에서 서버로 요청을 보내고 ‘올바른 스킬 서버 응답입니다’와 고정 응답을 확인했다. 공개 네트워크에서 지속적인 성능이나 시간 제한 충족을 보증하는 측정은 아니다.
- 터널을 재시작한 후 카카오 관리자센터에서 재시험해 정상 응답을 확인했다. 화면 로그에 요청 14:00:18, 결과 14:00:22가 표시됐지만 이는 초 단위 UI 로그이며 카카오 서버의 정확한 응답 시간은 아니다. 별도로 이 PC에서 공개 HTTPS 주소에 보낸 다섯 요청은 모두 200이었고 전체 소요 시간은 3,296ms, 93ms, 63ms, 80ms, 53ms였다. 단발성 연결 시험이므로 실제 카카오톡 대화 및 운영 부하에서의 5초 제한 충족은 별도 확인한다.
- 시험 후 컨테이너와 터널을 중지했다. 해당 임시 주소는 더 이상 유효하지 않으며 재시작하면 바뀔 수 있다. 스킬은 테스트 화면에서 저장하거나 운영 배포하지 않았다.

## 확인용 API

- `POST /api/v1/dev/kakao/skill-probe`는 `kakao-skill-probe` 프로필에서만 활성화되며 `prod`, `production`에서는 해당 프로필을 함께 지정해도 비활성화된다.
- `TAGBACK_KAKAO_SKILL_SECRET` 환경변수 또는 비밀 저장소 설정에 32자 이상의 임의 값을 설정한다. 비어 있거나 짧으면 503을 반환한다. 저장소, 명령 이력, 화면 캡처와 로그에 실제 비밀을 남기지 않는다.
- 카카오 스킬의 운영 및 테스트 요청 헤더에 `X-Tagback-Skill-Secret`을 같은 값으로 각각 설정한다. 누락·불일치·중복 헤더는 403이다. 비밀 헤더는 공유 비밀을 아는 요청을 구분하는 수단이며 카카오 자체의 서명 검증이나 재생 공격 방지가 아니다.
- JSON 객체에 `userRequest` 객체가 있으면 카카오 `version: 2.0`과 `template.outputs[].simpleText` 형태로 고정 응답을 반환한다. 입력한 발화, 인증 코드, 사용자 식별값을 사용하거나 저장하지 않는다. 이 성공 응답은 연결 확인일 뿐 사용자의 인증 성공을 의미하지 않는다.
- 개발용 인증 스킬 경로는 `POST /api/v1/auth/kakao/skill`이다. 확인용 probe 경로를 인증 API로 사용하지 않는다.

## 공개 연결 전제

현재 루트 Compose는 SMS mock 조회 API를 포함하므로 전체 웹 또는 API 서버를 터널로 공개하지 않는다. `localhost` 자체 서명 인증서도 카카오에서 접근 가능한 공개 HTTPS 주소가 아니다. `deploy/compose/kakao-probe.yaml`은 별도의 테스트 DB와 백엔드, 경로 제한 프록시, Cloudflare Quick Tunnel 구성이다. SMS mock을 활성화하지 않고 기존 DB와 프로젝트를 사용하지 않는다. 프록시는 두 시험용 probe POST 경로만 허용하고 나머지는 차단하며 요청 크기·속도를 제한하고 헤더 및 본문을 기록하지 않는다.

## Docker 테스트 실행

Docker Desktop의 Linux 컨테이너 엔진이 필요하다. 저장소 루트에서 다음 명령은 별도의 테스트 프로젝트를 시작하고 임시 공개 주소를 만든다. 실제 운영이나 사용자 데이터를 넣지 않는다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/compose/Initialize-KakaoProbe.ps1
docker compose -f deploy/compose/kakao-probe.yaml config --quiet
docker compose -f deploy/compose/kakao-probe.yaml up -d --build
docker compose -f deploy/compose/kakao-probe.yaml logs tunnel
```

로그에 표시되는 `https://...trycloudflare.com` 주소 뒤에 `/api/v1/dev/kakao/skill-probe`를 붙여 스킬 URL을 설정한다. 비밀 헤더 값은 Git에서 제외된 `deploy/compose/local/kakao-probe/skill-secret` 파일에서 관리자 본인이 확인해 카카오의 운영·테스트 헤더에 각각 입력한다. 값을 채팅, 터미널 로그, 저장소에 공유하지 않는다. 로컬 비밀 파일은 암호화된 비밀 저장소가 아니며 접근 권한을 관리해야 한다.

터널이 실행되는 동안만 주소가 유효하고 재시작 시 바뀔 수 있다. 테스트 후에는 `docker compose -f deploy/compose/kakao-probe.yaml stop`으로 중지한다. 볼륨 삭제는 별도 결정이며 이 명령은 데이터를 지우지 않는다. Quick Tunnel은 테스트 전용이다.

공개 주소 준비 이후 카카오 관리자센터에서 스킬 URL과 테스트용 헤더를 등록하고, 스킬 테스트로 응답 JSON과 소요 시간을 확인한다. 그 다음 실제 채널 연동 테스트에서는 사용자 식별값을 안전하게 수신할 수 있는지 별도로 검증한다. 카카오는 스킬 서버의 5초 내 응답을 안내한다. 이 프로젝트의 자동 테스트는 로컬 MockMvc이므로 공개 네트워크의 응답 시간이나 카카오 연동을 보장하지 않는다.

참고: [스킬 만들기](https://kakaobusiness.gitbook.io/main/tool/chatbot/skill_guide/make_skill), [스킬 요청과 응답 형식](https://kakaobusiness.gitbook.io/main/tool/chatbot/skill_guide/answer_json_format).
