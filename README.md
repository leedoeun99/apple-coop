# 사과게임 협동전

원작 Fruit Box(사과게임)를 그대로 옮기고, 친구와 같은 방에서 실시간으로 같은 판을 함께 지우는 게임입니다.
로그인 없이 주소와 방 코드만 있으면 누구나 들어올 수 있습니다.

- 17×10 사과판, 드래그한 사각형 안 숫자 합이 정확히 10이면 사라짐, 사과 1개당 1점, 제한 시간 2분
- 같은 방 코드로 들어온 사람은 같은 판을 보고, 지운 사과가 한 점수로 합산됨
- 상대가 드래그 중인 영역이 점선으로 보임, 방별 최고 기록 저장

## 내 컴퓨터에서 바로 실행

`start.bat` 을 더블클릭하면 서버가 켜지고, 가입 없이 쓸 수 있는 Cloudflare 임시 공개 주소가 출력됩니다.
`https://xxxx-yyyy.trycloudflare.com` 주소를 친구에게 보내면 됩니다. 창을 닫으면 주소도 사라지고, 다시 켜면 주소가 바뀝니다.

직접 실행하려면:

```bash
npm install
npm start
```

브라우저에서 http://localhost:3000 을 엽니다. 포트를 바꾸려면 `PORT=4000 npm start`.

## 계속 살아있는 주소가 필요하면 (Render 무료 배포)

빙고(duo-bingo)와 같은 방식입니다.

**1. GitHub에 올리기** — [github.com/new](https://github.com/new) 에서 빈 저장소를 만듭니다.
(README·.gitignore·license는 **체크하지 마세요.** 빈 저장소여야 합니다.)

```bash
git remote add origin https://github.com/<내계정>/apple-coop.git
git push -u origin main
```

**2. Render에 배포** — [render.com](https://render.com) 에서 **New → Web Service** → 방금 만든 저장소 선택.
`render.yaml`이 있어서 설정은 자동으로 잡힙니다. 혹시 안 잡히면:

| 항목 | 값 |
|---|---|
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `node server.js` |
| Plan | Free |

첫 배포는 1~2분이면 끝나고 `https://apple-coop.onrender.com` 같은 주소가 나옵니다. 이 주소는 안 없어집니다.

> 무료 플랜은 15분쯤 아무도 안 들어오면 잠들어서 첫 접속이 30~60초 걸립니다. 게임 중에는 연결이 유지됩니다.
> 최고 기록은 서버의 파일에 저장되는데, 무료 플랜은 재시작하면 파일이 초기화됩니다.

## 친구 초대

게임 아래의 **초대 링크 복사** 버튼은 `주소#방코드` 링크를 복사합니다. 친구가 그 링크를 열면 방 코드가 미리 채워집니다.

## 구조

```
apple-coop/
├─ server.js          HTTP 정적 서빙 + WebSocket 방 동기화 (판 생성·합 10 검증·타이머·기록)
├─ public/
│   ├─ index.html     게임 화면 (원작 720×470 스테이지, 사과 벡터 경로 그대로)
│   └─ game.js        클라이언트
├─ data/records.json  방별 최고 기록 (자동 생성)
├─ render.yaml        Render 배포 설정
├─ Dockerfile         컨테이너 배포용
├─ start.bat          더블클릭하면 서버 + 공개 주소를 한 번에 켬
└─ start.ps1          start.bat 이 실행하는 스크립트
```
