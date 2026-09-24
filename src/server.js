import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import { pipeline } from 'stream';

// Lấy đường dẫn thư mục gốc của backend
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');

// Tạo hàm require chuẩn trỏ thẳng vào thư mục gốc của backend (nơi chứa node_modules)
const require = createRequire(path.join(backendRoot, 'package.json'));

// Dùng require để nạp các package từ node_modules (Tránh 100% lỗi ERR_MODULE_NOT_FOUND của ESM)
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const axios = require('axios');

// Các file local route nội bộ thì vẫn import ESM bình thường
import imageRoutes from './routes/imageRoutes.js';
import webRoutes from './routes/webRoutes.js';
import extractRoutes from './routes/extractRoutes.js';
import videoRoutes from './routes/videoRoutes.js';

dotenv.config({ path: path.join(backendRoot, '.env') });

const app = express();
const PORT = process.env.PORT || 5000;

app.disable('etag');
app.set('etag', false);

// Middleware CORS
app.use(cors());
app.use(express.json());

const httpsAgent = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: false,
});

// Endpoint Proxy ảnh
app.get('/api/proxy-image', async (req, res) => {
  let imageUrl = req.query.url;
  if (!imageUrl) {
    return res.status(400).send('Thiếu url');
  }

  if (imageUrl.startsWith('//')) {
    imageUrl = 'https:' + imageUrl;
  }

  if (!imageUrl.startsWith('http')) {
    return res.status(400).send('URL không hợp lệ');
  }

  try {
    const parsedUrl = new URL(imageUrl);
    const origin = `${parsedUrl.protocol}//${parsedUrl.hostname}`;

    const response = await axios({
      url: imageUrl,
      method: 'GET',
      responseType: 'stream',
      timeout: 9000,
      httpsAgent,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': `${origin}/`,
        'Origin': origin,
      },
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');

    response.data.pipe(res);
  } catch (err) {
    res.status(404).send('Error loading image');
  }
});

app.use((req, res, next) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store',
  });
  next();
});

// Đăng ký routes
app.use('/api', imageRoutes);
app.use('/api', extractRoutes);
app.use('/api/web', webRoutes);
app.use('/api', videoRoutes);

app.listen(PORT, () => {
  console.log(`Backend server đang chạy tại: http://localhost:${PORT}`);
});