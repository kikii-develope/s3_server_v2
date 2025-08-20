import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'File Uploader API',
      version: '1.0.13',
      description: 'S3 파일 업로드 서버 API 문서',
      contact: {
        name: 'inseok lee',
        email: 'inseok.lee@example.com'
      }
    },
    servers: [
      {
        url: 'http://localhost:8989',
        description: 'Development server'
      }
    ],
    components: {
      schemas: {
        FileUploadRequest: {
          type: 'object',
          required: ['bucketName'],
          properties: {
            bucketName: {
              type: 'string',
              description: 'S3 버킷 이름'
            }
          }
        },
        MultipleFileUploadRequest: {
          type: 'object',
          required: ['bucketName', 'path'],
          properties: {
            bucketName: {
              type: 'string',
              description: 'S3 버킷 이름'
            },
            path: {
              type: 'string',
              description: '업로드할 경로'
            }
          }
        },
        UploadResponse: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: '응답 메시지'
            },
            status: {
              type: 'integer',
              description: 'HTTP 상태 코드'
            },
            object: {
              type: 'object',
              description: '업로드 결과 객체'
            }
          }
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: '에러 메시지'
            },
            status: {
              type: 'integer',
              description: 'HTTP 상태 코드'
            }
          }
        }
      }
    }
  },
  apis: ['./index.js', './src/router/*.js'] // API 라우트 파일들
};

export const specs = swaggerJsdoc(options); 