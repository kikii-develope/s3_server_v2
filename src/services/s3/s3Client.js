import { S3Client } from '@aws-sdk/client-s3';
import 'dotenv/config.js'

console.log('AWS 환경 변수 확인:', {
    region: process.env.AWS_REGION,
    hasAccessKey: !!process.env.AWS_IAM_USER_KEY,
    hasSecretKey: !!process.env.AWS_IAM_USER_SECRET
});

const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'ap-northeast-2',
    credentials: {
        accessKeyId: process.env.AWS_IAM_USER_KEY || '',
        secretAccessKey: process.env.AWS_IAM_USER_SECRET || ''
    }
});

export default s3Client;