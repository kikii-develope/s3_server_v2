"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadMultipleToS3 = exports.uploadToS3 = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const date_fns_1 = require("date-fns");
const s3Client_js_1 = __importDefault(require("../services/s3/s3Client.js"));
const iconv_lite_1 = __importDefault(require("iconv-lite"));
const uploadToS3 = async (params) => {
    const { bucketName, path, file } = params;
    try {
        const decodedName = iconv_lite_1.default.decode(Buffer.from(file.originalname, 'latin1'), 'utf-8');
        const fileName = `${(0, date_fns_1.format)(new Date(), 'yyyyMMdd_HHmmss')}_${decodedName}`;
        const command = new client_s3_1.PutObjectCommand({
            Bucket: bucketName,
            Key: `${path}/${fileName}`,
            Body: file.buffer,
            ContentType: file.mimetype,
            ACL: 'public-read',
        });
        await s3Client_js_1.default.send(command);
        const url = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${path}/${fileName}`;
        return {
            success: true,
            fileName,
            size: file.size,
            url: url
        };
    }
    catch (error) {
        console.error('S3 업로드 에러:', error);
        throw new Error('파일 업로드 중 오류가 발생했습니다.:: ' + error);
    }
};
exports.uploadToS3 = uploadToS3;
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
    }
    catch (error) {
        console.error('멀티 파일 업로드 에러:', error);
        throw new Error('파일 업로드 중 오류가 발생했습니다.');
    }
};
exports.uploadMultipleToS3 = uploadMultipleToS3;
