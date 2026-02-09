import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { format } from 'date-fns';
import s3 from '../services/s3/s3Client.js';
import iconv from 'iconv-lite';
import fs from 'fs';

const uploadToS3 = async (params) => {
    const { bucketName, path, file } = params;

    try {
        const decodedName = iconv.decode(Buffer.from(file.originalname, 'latin1'), 'utf-8');

        const fileName = `${format(new Date(), 'yyyyMMdd_HHmmss')}_${decodedName}`;

        // Disk Storage: file.path에서 스트림 생성
        const fileStream = fs.createReadStream(file.path);

        const command = new PutObjectCommand({
            Bucket: bucketName,
            Key: `${path}/${fileName}`,
            Body: fileStream,
            ContentType: file.mimetype,
            ACL: 'public-read',
        });

        await s3.send(command);

        // 업로드 완료 후 로컬 임시 파일 삭제
        try {
            await fs.promises.unlink(file.path);
            console.log(`[S3] 로컬 임시 파일 삭제: ${file.path}`);
        } catch (err) {
            console.warn(`[S3] 임시 파일 삭제 실패 (무시): ${err.message}`);
        }

        const url = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${path}/${fileName}`;
        return {
            success: true,
            fileName,
            size: file.size,
            url: url
        };
    } catch (error) {
        console.error('S3 업로드 에러:', error);

        // 실패시 로컬 임시 파일 삭제
        try {
            await fs.promises.unlink(file.path);
        } catch {}

        throw new Error('파일 업로드 중 오류가 발생했습니다.:: ' + error);
    }
};

const uploadMultipleToS3 = async (params) => {
    const { bucketName, path, files } = params;

    try {

        const uploadPromises = files.map(file => uploadToS3({
            bucketName: bucketName,
            path: path,
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