import express from 'express';
import axios from 'axios';
import { 
  searchVideos, 
  extractVideo, 
  extractFromWebLink 
} from '../controllers/videoController.js';

const router = express.Router();

// Route tìm kiếm video theo từ khóa
router.get('/videos', searchVideos);

// Route bóc tách direct link video đơn lẻ
router.get('/extract-video', extractVideo);

// Route bóc tách toàn bộ video từ đường dẫn web
router.get('/extract-from-web', extractFromWebLink);

// XỬ LÝ LỖI 403: Route Proxy Stream Video vượt tường lửa Hotlink (Twitter/X, v.v.)
router.get('/proxy-video', async (req, res) => {
  const targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).send('Thiếu tham số url video');
  }

  try {
    const range = req.headers.range;
    const customHeaders = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Encoding': 'identity',
    };

    // Nếu là video Twitter/X thì giả lập referer từ chính nền tảng
    if (targetUrl.includes('twimg.com') || targetUrl.includes('twitter.com') || targetUrl.includes('x.com')) {
      customHeaders['Referer'] = 'https://x.com/';
      customHeaders['Origin'] = 'https://x.com';
    }

    if (range) {
      customHeaders['Range'] = range;
    }

    const videoResponse = await axios({
      method: 'get',
      url: targetUrl,
      responseType: 'stream',
      headers: customHeaders,
      timeout: 20000,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    // Chuyển tiếp các header quan trọng để trình duyệt hỗ trợ tua (seek) và phát video chuẩn HTML5
    res.status(videoResponse.status);
    if (videoResponse.headers['content-type']) {
      res.setHeader('Content-Type', videoResponse.headers['content-type']);
    }
    if (videoResponse.headers['content-length']) {
      res.setHeader('Content-Length', videoResponse.headers['content-length']);
    }
    if (videoResponse.headers['content-range']) {
      res.setHeader('Content-Range', videoResponse.headers['content-range']);
    }
    if (videoResponse.headers['accept-ranges']) {
      res.setHeader('Accept-Ranges', videoResponse.headers['accept-ranges']);
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    videoResponse.data.pipe(res);
  } catch (err) {
    console.error('Lỗi proxy video:', err.message);
    if (!res.headersSent) {
      return res.status(500).send('Không thể phát luồng video từ nguồn này');
    }
  }
});

export default router;