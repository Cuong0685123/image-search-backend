import axios from 'axios';
import https from 'https';
import * as cheerio from 'cheerio';

const httpsAgent = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: false,
});

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
  'Sec-Ch-Ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
};

export async function fetchVideos(query, page = 1, options = {}) {
  const { count = 20 } = options;
  console.log(`[Video Service] Bắt đầu tìm: "${query}" - Trang: ${page}`);

  // 1. Thử Bing Video Scraper mở rộng (Hỗ trợ 18+, adlt=off)
  const bingVideos = await fetchBingVideosUncensored(query, page, count);
  if (bingVideos && bingVideos.length > 0) {
    console.log(`[Video Service] Bing Video tìm thấy: ${bingVideos.length} video`);
    return bingVideos;
  }

  // 2. Fallback sang Dailymotion API (Đã tắt Family Filter)
  console.log(`[Video Service] Bing rỗng, chuyển sang Dailymotion Unfiltered...`);
  const dmVideos = await fetchDailymotionUnfiltered(query, page, count);
  if (dmVideos && dmVideos.length > 0) {
    console.log(`[Video Service] Dailymotion tìm thấy: ${dmVideos.length} video`);
    return dmVideos;
  }

  return [];
}

// ====================== NGUỒN 1: BING VIDEOS (TẮT BỘ LỌC KIỂM DUYỆT) ======================
async function fetchBingVideosUncensored(query, page = 1, count = 20) {
  const cleanQuery = encodeURIComponent(query.trim());
  const first = (Math.max(1, page) - 1) * count + 1;

  // Sử dụng endpoint search chuẩn của Bing với cookie adlt=off để lấy mọi nội dung
  const targetUrl = `https://www.bing.com/videos/search?q=${cleanQuery}&first=${first}&count=${count}&adlt=off&qft=+filterui:duration-all`;

  try {
    const res = await axios.get(targetUrl, {
      httpsAgent,
      headers: {
        ...BROWSER_HEADERS,
        // Cặp Cookie quan trọng để tắt SafeSearch triệt để trên Bing
        'Cookie': 'SRCHHPGUSR=ADLT=OFF&NRSLT=-1; _EDGE_S=mkt=en-US&ui=en-US&F=1; MUIDB=1; SRCHD=AF=NOFORM;',
        'Referer': 'https://www.bing.com/',
      },
      timeout: 10000,
    });

    const html = res.data;
    if (!html || typeof html !== 'string') return [];

    const $ = cheerio.load(html);
    const results = [];
    const seenUrls = new Set();

    // Quét thẻ card video của Bing
    $('.mc_vtvc, div.videoCard, .inline_video_card').each((_, el) => {
      try {
        const card = $(el);
        const linkEl = card.find('a.vturl, a[href*="/videos/search"]').first();
        const rawHref = linkEl.attr('href') || '';

        // Trích xuất metadata
        const rawMeta = card.attr('vrhm') || card.find('[vrhm]').attr('vrhm');
        let meta = null;
        if (rawMeta) {
          try {
            meta = JSON.parse(rawMeta);
          } catch {
            try {
              meta = JSON.parse(rawMeta.replace(/&quot;/g, '"'));
            } catch {}
          }
        }

        let videoUrl = meta?.purl || meta?.curl || meta?.mediaurl;

        // Nếu không có trong JSON vrhm, bóc từ param ru= redirect
        if (!videoUrl && rawHref) {
          const match = rawHref.match(/[?&](?:ru|rurl)=([^&]+)/i);
          if (match && match[1]) {
            try {
              videoUrl = decodeURIComponent(match[1]);
            } catch {}
          }
        }

        if (!videoUrl || videoUrl.includes('bing.com') || !videoUrl.startsWith('http')) {
          return;
        }

        if (seenUrls.has(videoUrl)) return;
        seenUrls.add(videoUrl);

        const title =
          card.find('.mc_vtvc_title, .b_tit').text().trim() ||
          meta?.title ||
          query;

        const imgEl = card.find('img').first();
        let thumbnailUrl =
          imgEl.attr('src') ||
          imgEl.attr('data-src') ||
          meta?.thumb?.url ||
          '';

        if (thumbnailUrl.startsWith('//')) {
          thumbnailUrl = 'https:' + thumbnailUrl;
        }

        const duration = card.find('.b_duration, .mc_vtvc_duration').text().trim() || meta?.duration || '';
        const publisher = card.find('.mc_vtvc_meta_row span, .source').first().text().trim() || meta?.publisher || 'Web Video';

        results.push({
          title,
          videoUrl,
          thumbnailUrl,
          duration,
          publisher,
          views: '',
          engine: 'bing',
        });
      } catch {}
    });

    return results.slice(0, count);
  } catch (err) {
    console.warn('[Bing Video Uncensored Error]:', err.message);
    return [];
  }
}

// ====================== NGUỒN 2: DAILYMOTION API (TẮT BỘ LỌC FAMILY) ======================
async function fetchDailymotionUnfiltered(query, page = 1, count = 20) {
  const cleanQuery = encodeURIComponent(query.trim());
  const limit = Math.min(count, 50);

  // family_filter=false là cờ cho phép trả về mọi nội dung
  const targetUrl = `https://api.dailymotion.com/videos?search=${cleanQuery}&page=${page}&limit=${limit}&family_filter=false&fields=id,title,duration,thumbnail_360_url,thumbnail_480_url,url,views_total,owner.screenname`;

  try {
    const res = await axios.get(targetUrl, {
      httpsAgent,
      headers: {
        'User-Agent': BROWSER_HEADERS['User-Agent'],
        'Accept': 'application/json',
      },
      timeout: 9000,
    });

    const list = res.data?.list || [];
    if (!Array.isArray(list) || list.length === 0) return [];

    return list.map((item) => {
      const totalSec = item.duration || 0;
      const min = Math.floor(totalSec / 60);
      const sec = totalSec % 60;
      const durationStr = totalSec > 0 ? `${min}:${sec < 10 ? '0' : ''}${sec}` : '';

      return {
        title: item.title || query,
        videoUrl: item.url || `https://www.dailymotion.com/video/${item.id}`,
        thumbnailUrl: item.thumbnail_480_url || item.thumbnail_360_url || '',
        duration: durationStr,
        publisher: item['owner.screenname'] || 'DailyMotion',
        views: item.views_total ? `${item.views_total.toLocaleString()} lượt xem` : '',
        engine: 'dailymotion',
      };
    });
  } catch (err) {
    console.warn(`[Dailymotion Unfiltered Error]:`, err.message);
    return [];
  }
}