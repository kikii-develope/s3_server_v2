#!/bin/bash

# 온프레미스 환경용 Docker 이미지 빌드
# 포트: 8989

echo "====================================="
echo "Building On-Premise Docker Image"
echo "====================================="
echo "Environment: On-Premise"
echo "Port: 8989"
echo "Dockerfile: Dockerfile.onprem"
echo "====================================="

docker build -f Dockerfile.onprem -t file-server:onprem .

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Build successful!"
    echo ""
    echo "To run the container:"
    echo "  docker run -d -p 8989:8989 --name file-server-onprem file-server:onprem"
    echo ""
    echo "To run with custom environment variables:"
    echo "  docker run -d -p 8989:8989 \\"
    echo "    -e WEBDAV_ROOT_PATH=kikii_test \\"
    echo "    --env-file .env \\"
    echo "    --name file-server-onprem \\"
    echo "    file-server:onprem"
else
    echo ""
    echo "❌ Build failed!"
    exit 1
fi
