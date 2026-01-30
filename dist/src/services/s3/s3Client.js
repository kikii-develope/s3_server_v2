"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_s3_1 = require("@aws-sdk/client-s3");
require("dotenv/config.js");
console.log('AWS 환경 변수 확인:', {
    region: process.env.AWS_REGION,
    hasAccessKey: !!process.env.AWS_IAM_USER_KEY,
    hasSecretKey: !!process.env.AWS_IAM_USER_SECRET
});
const s3Client = new client_s3_1.S3Client({
    region: process.env.AWS_REGION || 'ap-northeast-2',
    credentials: {
        accessKeyId: process.env.AWS_IAM_USER_KEY || '',
        secretAccessKey: process.env.AWS_IAM_USER_SECRET || ''
    }
});
exports.default = s3Client;
