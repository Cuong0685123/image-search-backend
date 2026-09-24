import { scrapeImagesFromUrl } from '../services/extractService.js';

export async function extractImages(req, res) {
  const targetUrl = req.query.url;

  if (!targetUrl || !targetUrl.startsWith('http')) {
    return res.status(400).json({
      success: false,
      message: 'URL không hợp lệ (cần bắt đầu bằng http:// hoặc https://)',
    });
  }

  try {
    let hostname = 'web';
    try {
      hostname = new URL(targetUrl).hostname.replace(/^www\./, '');
    } catch {}

    const images = await scrapeImagesFromUrl(targetUrl);

    return res.json({
      success: true,
      url: targetUrl,
      domain: hostname,
      total: images.length,
      data: images.map((imgUrl, index) => ({
        title: `Ảnh #${index + 1} từ ${hostname}`,
        imageUrl: imgUrl,
        thumbnailUrl: imgUrl,
        sourceUrl: targetUrl,
        domain: hostname,
      })),
    });
  } catch (err) {
    console.error('Lỗi controller extract ảnh:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Không thể bóc ảnh từ URL này',
    });
  }
}