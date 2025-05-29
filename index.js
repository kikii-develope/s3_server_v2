import cors from 'cors';
import express from 'express';
import multer, { memoryStorage } from 'multer';
import { uploadToS3, uploadMultipleToS3 } from './src/uploadController.js';
import 'dotenv/config.js'


const app = express();

// 요청 패킷 정보를 로깅하는 미들웨어
const requestLogger = (req, res, next) => {
    console.log('\n=== 요청 패킷 정보 ===');
    console.log('Method:', req.method);
    console.log('URL:', req.url);
    console.log('Headers:', req.headers);
    console.log('Query:', req.query);
    console.log('Body:', req.body);
    console.log('File:', req.file);
    console.log('Files:', req.files);
    console.log('=====================\n');
    next();
};

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);  // 로깅 미들웨어 추가

const upload = multer({ storage: memoryStorage() });

app.get('/', (req, res) => {
    res.send('Hello World');
});

app.post('s3/upload', upload.single('file'), async (req, res) => {

    if (!req.file) {
        return res.status(400).json({ message: '파일이 없습니다.', status: 400 });
    }

    const { bucketName } = req.body;

    if(!bucketName) {
        return res.status(400).json({ message: 'bucketName is missing in request body.', status: 400 });
    }

    try {
        const result = await uploadToS3({
            bucketName: bucketName,
            file: req.file,
        });
        return res.status(200).json({ message: '파일 업로드 성공', status: 200, object: result });
    } catch (error) {
        console.error('업로드 에러:', error);
        res.status(500).json({ message: error.message, status: 500 });
    }
});

app.post('/s3/upload/multiple', upload.array('files', 10), async (req, res) => {

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: '파일이 없습니다.', status: 400 });
    } else if(req.files.length > 10) {
        return res.status(400).json({ message: '파일 개수가 10개를 초과했습니다.', status: 400 });
    }
    
    const { bucketName } = req.body;

    if(!bucketName) {
        return res.status(400).json({ message: 'bucketName is missing in request body.', status: 400 });
    }

    try {
        const result = await uploadMultipleToS3({
            bucketName: bucketName,
            files: req.files,
        });

        return res.status(200).json({ message: '파일 업로드 성공', status: 200, object: result });
    } catch (error) {
        console.error('멀티 업로드 에러:', error);
        res.status(500).json({ message: error.message, status: 500 });
    }
});

app.listen(8989, () => {
    console.log('Server is running on port 8989');
});
