#!/bin/bash

# 로컬 개발 환경용 Docker 이미지 빌드
# 포트: 8000

echo "=================================="
echo "Building Development Docker Image"
echo "=================================="
echo "Environment: Development"
echo "Port: 8000"
echo "Dockerfile: Dockerfile.dev"
echo "=================================="

docker build -f Dockerfile.dev -t file-server:dev .

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Build successful!"
    echo ""
    echo "To run the container:"
    echo "  docker run -d -p 8000:8000 --name file-server-dev file-server:dev"
    echo ""
    echo "To run with custom .env:"
    echo "  docker run -d -p 8000:8000 --env-file .env --name file-server-dev file-server:dev"
else
    echo ""
    echo "❌ Build failed!"
    exit 1
fi
