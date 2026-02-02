import swaggerJsdoc from "swagger-jsdoc";
import { pkg } from "./appInfo.js";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "File Uploader API",
      version: pkg.version,
      description: `S3 파일 업로드 서버 API 문서

## 환경별 WebDAV 저장 경로

- **배포 환경**: \`/www\` 경로에 파일 저장

- **개발 환경**: \`/kikii_test\` 경로에 파일 저장

환경별 경로는 \`WEBDAV_ROOT_PATH\` 환경 변수로 관리됩니다.`,
      contact: {
        name: "myeongji kim",
        email: "myeongji.aud0725@kikii.com",
      },
    },
    servers: [
      {
        url: "https://file-server.kiki-bus.com",
        description: "Production server",
      },
      {
        url: `http://kikii.iptime.org:${process.env.PORT || 8000}`,
        description: "Development server",
      },
    ],
    components: {
      schemas: {
        FileUploadRequest: {
          type: "object",
          required: ["bucketName"],
          properties: {
            bucketName: {
              type: "string",
              description: "S3 버킷 이름",
            },
          },
        },
        MultipleFileUploadRequest: {
          type: "object",
          required: ["bucketName", "path"],
          properties: {
            bucketName: {
              type: "string",
              description: "S3 버킷 이름",
            },
            path: {
              type: "string",
              description: "업로드할 경로",
            },
          },
        },
        UploadResponse: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "응답 메시지",
            },
            status: {
              type: "integer",
              description: "HTTP 상태 코드",
            },
            object: {
              type: "object",
              description: "업로드 결과 객체",
            },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "에러 메시지",
            },
            status: {
              type: "integer",
              description: "HTTP 상태 코드",
            },
          },
        },
      },
    },
  },
  apis: ["./index.js", "./src/router/*.js"], // API 라우트 파일들
};

export const specs = swaggerJsdoc(options);
