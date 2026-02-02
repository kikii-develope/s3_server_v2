# Docker Build Scripts

환경별 Docker 이미지 빌드 스크립트 모음

## 환경별 빌드

### 1. 개발 환경 (로컬)
```bash
./scripts/build-dev.sh
```
- 포트: **8000**
- Dockerfile: `Dockerfile.dev`
- 특징: nodemon, hot reload
- WebDAV 경로: `/kikii_test` (권장)

### 2. 온프레미스 환경
```bash
./scripts/build-onprem.sh
```
- 포트: **8989**
- Dockerfile: `Dockerfile.onprem`
- 특징: 프로덕션 빌드, 최적화
- WebDAV 경로: `/kikii_test` (권장)

### 3. 운영 환경 (클라우드)
```bash
./scripts/build-prod.sh
```
- 포트: **80**
- Dockerfile: `Dockerfile`
- 특징: GitHub Actions를 통한 자동 배포
- WebDAV 경로: `/www`

## 실행 예시

### 개발 환경 실행
```bash
docker run -d \
  -p 8000:8000 \
  --env-file .env \
  --name file-server-dev \
  file-server:dev
```

### 온프레미스 환경 실행
```bash
docker run -d \
  -p 8989:8989 \
  -e WEBDAV_ROOT_PATH=kikii_test \
  --env-file .env \
  --name file-server-onprem \
  file-server:onprem
```

### 운영 환경 실행
```bash
docker run -d \
  -p 80:80 \
  -e WEBDAV_ROOT_PATH=www \
  --env-file .env \
  --name file-server-prod \
  file-server:prod
```

## 환경 변수

각 환경별로 `.env` 파일의 `WEBDAV_ROOT_PATH`를 설정하세요:

```env
# 개발/온프레미스
WEBDAV_ROOT_PATH=kikii_test

# 운영
WEBDAV_ROOT_PATH=www
```

또는 `docker run` 시 `-e` 옵션으로 오버라이드할 수 있습니다.

## 컨테이너 관리

### 컨테이너 중지
```bash
docker stop file-server-dev
docker stop file-server-onprem
docker stop file-server-prod
```

### 컨테이너 삭제
```bash
docker rm file-server-dev
docker rm file-server-onprem
docker rm file-server-prod
```

### 로그 확인
```bash
docker logs -f file-server-dev
docker logs -f file-server-onprem
docker logs -f file-server-prod
```

## 포트 정리

| 환경 | 포트 | Dockerfile | WebDAV 경로 |
|------|------|------------|-------------|
| 개발 (로컬) | 8000 | Dockerfile.dev | /kikii_test |
| 온프레미스 | 8989 | Dockerfile.onprem | /kikii_test |
| 운영 (클라우드) | 80 | Dockerfile | /www |
