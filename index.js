import cors from 'cors';
import express from 'express';
import multer, { memoryStorage } from 'multer';
import { uploadToS3, uploadMultipleToS3 } from './src/uploadController.js';
import 'dotenv/config.js'
import { test } from './src/webdav_client.js';

const app = express();

// CORS 설정 - 특정 도메인 허용
const corsOptions = {
  origin: [
    'http://localhost:3000',
    'http://localhost:3003',
    'http://localhost:8080',
    'http://kikii.iptime.org:3013'
  ],
  credentials: true,  // 쿠키/인증 헤더 허용
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));

const upload = multer({ storage: memoryStorage(), preservePath: false });

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


app.use(express.json());

app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);  // 로깅 미들웨어 추가

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
        res.status(400).json({ message: error.message, status: 400 });
    }
});

app.listen(8888, () => {
    console.log('Server is running on port 8888');
    console.log("app version: ", process.env.APP_VERSION);
    // test();
});


app.post('/s3/upload/multiple', upload.array('files', 10), async (req, res) => {
    // console.log(req);

    console.log(req.files);

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: '파일이 없습니다.', status: 400 });
    } else if(req.files.length > 10) {
        return res.status(400).json({ message: '파일 개수가 10개를 초과했습니다.', status: 400 });
    }
    
    const { bucketName, path } = req.body;
    console.log(bucketName, path);

    if(!bucketName) {
        return res.status(400).json({ message: 'bucketName is missing in request body.', status: 400 });
    }

    if(!path) {
        return res.status(400).json({ message: 'path is missing in request body.', status: 400 });
    }

    try {
        const result = await uploadMultipleToS3({
            bucketName: bucketName,
            path: path,
            files: req.files,
        });

        return res.status(200).json({ message: '파일 업로드 성공', status: 200, object: result });
    } catch (error) {
        console.error('멀티 업로드 에러:', error);
        res.status(400).json({ message: error.message, status: 400 });
    }
});