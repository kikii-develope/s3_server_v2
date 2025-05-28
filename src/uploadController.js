import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { format } from 'date-fns';
import s3 from './s3_client.js';

const uploadToS3 = async (params) => {
    const {bucketName, file} = params;

    try {
        const fileName = `${format(new Date(), 'yyyyMMdd_HHmmss')}_${file.originalname}`;
        
        const command = new PutObjectCommand({
            Bucket: bucketName,
            Key: fileName,
            Body: file.buffer,
            ContentType: file.mimetype,
            ACL: 'public-read',
        });

        await s3.send(command);
        
        const url = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
        return {
            success: true,
            fileName,
            size: file.size,
            url: url
        };
    } catch (error) {
        console.error('S3 업로드 에러:', error);
        throw new Error('파일 업로드 중 오류가 발생했습니다.');
    }
};

const uploadMultipleToS3 = async (params) => {
    const {bucketName, files} = params;

    try {

        const uploadPromises = files.map(file => uploadToS3({
            bucketName: bucketName,
            file: file
        }));
        const results = await Promise.all(uploadPromises);
        
        return {
            success: true,
            files: results
        };
    } catch (error) {
        console.error('멀티 파일 업로드 에러:', error);
        throw new Error('파일 업로드 중 오류가 발생했습니다.');
    }
};

export { uploadToS3, uploadMultipleToS3 };