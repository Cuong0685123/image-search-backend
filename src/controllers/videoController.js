import { fetchVideos } from '../services/videoService.js';
import { extractDirectVideo } from '../services/videoExtractorService.js'; // <-- Import hàm extract
import { extractAllVideosFromUrl } from '../services/videoExtractorService.js';
export async function searchVideos(req, res) {
  const query = req.query.q || '';
  const page = parseInt(req.query.page, 10) || 1;
  const engine = req.query.engine || 'bing';

  if (!query.trim()) {
    return res.status(400).json({ success: false, message: 'Thiếu từ khóa tìm kiếm' });
  }

  // Chống cache 304: ép trình duyệt và proxy luôn lấy kết quả tươi
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  try {
    const videos = await fetchVideos(query, page, {
      engine,
      safeSearch: 'off',
      count: 20,
    });

    return res.json({
      success: true,
      query,
      page,
      engine,
      total: videos.length,
      // SỬA TẠI ĐÂY: Miễn là trang này có video (> 0), tiếp tục cho phép bấm "Xem thêm"
      hasMore: videos.length > 0,
      data: videos,
    });
  } catch (err) {
    console.error('Lỗi videoController:', err.message);
    return res.status(500).json({ success: false, message: 'Lỗi khi tìm kiếm video' });
  }
}

export async function extractVideo(req, res) {
  const url = req.query.url;

  if (!url) {
    return res.status(400).json({ success: false, message: 'Thiếu tham số url' });
  }

  try {
    const streamUrl = await extractDirectVideo(url);

    if (streamUrl) {
      return res.json({
        success: true,
        streamUrl,
      });
    }

    return res.json({
      success: false,
      message: 'Không tìm thấy link video stream trực tiếp',
    });
  } catch (err) {
    console.error('Lỗi extractVideo controller:', err.message);
    return res.status(500).json({ success: false, message: 'Lỗi khi bóc tách video' });
  }
}

// Controller bóc toàn bộ video từ một đường link web bất kỳ
export async function extractFromWebLink(req, res) {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ success: false, message: 'Vui lòng cung cấp url' });
  }

  try {
    const videos = await extractAllVideosFromUrl(url);
    return res.json({
      success: true,
      total: videos.length,
      data: videos,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Lỗi khi quét video từ link web' });
  }
}