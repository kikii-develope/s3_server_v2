#!/bin/bash

# 운영 환경용 Docker 이미지 빌드
# 포트: 80

echo "=================================="
echo "Building Production Docker Image"
echo "=================================="
echo "Environment: Production"
echo "Port: 80"
echo "Dockerfile: Dockerfile"
echo "=================================="

docker build -f Dockerfile -t file-server:prod .

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Build successful!"
    echo ""
    echo "To run the container:"
    echo "  docker run -d -p 80:80 --name file-server-prod file-server:prod"
    echo ""
    echo "To run with custom .env:"
    echo "  docker run -d -p 80:80 --env-file .env --name file-server-prod file-server:prod"
    echo ""
    echo "Note: This image is typically deployed via GitHub Actions to AWS ECS"
else
    echo ""
    echo "❌ Build failed!"
    exit 1
fi
