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
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Ch-Ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
};

const BLACKLISTED_PLATFORMS = [
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'facebook.com',
  'fb.watch',
  'instagram.com',
  'threads.net',
  'bilibili.com',
  'bilibili.tv',
  'b23.tv',
  'dailymotion.com',
  'dai.ly',
  'vimeo.com',
  'douyin.com',
  'kuaishou.com',
];

function isBlacklisted(url = '', publisher = '') {
  const target = `${url} ${publisher}`.toLowerCase();
  return (
    BLACKLISTED_PLATFORMS.some((platform) => target.includes(platform)) ||
    /bilibili|dailymotion|tiktok|youtube|facebook|instagram|vimeo/i.test(target)
  );
}

export async function fetchVideos(query, page = 1, options = {}) {
  const { engine = 'bing', count = 20 } = options;
  console.log(`[Video Service] Bắt đầu tìm: "${query}" - Trang: ${page} - Engine: ${engine}`);

  if (engine === 'yandex') {
    const yandexResults = await fetchYandexVideosDirect(query, page, count);
    if (yandexResults && yandexResults.length > 0) {
      console.log(`[Video Service] Yandex Video tìm thấy: ${yandexResults.length} video`);
      return yandexResults;
    }
  }

  // Mặc định hoặc fallback: Gọi Bing Video Scraper trực tiếp
  const bingResults = await fetchBingVideosClean(query, page, count);
  if (bingResults && bingResults.length > 0) {
    console.log(`[Video Service] Bing Video tìm thấy: ${bingResults.length} video`);
    return bingResults;
  }

  // Nếu Bing không có, thử kéo từ Yandex
  return await fetchYandexVideosDirect(query, page, count);
}

// ====================== NGUỒN 1: BING VIDEOS (CÀO TRỰC TIẾP TỪ SERP) ======================
async function fetchBingVideosClean(query, page = 1, count = 20) {
  const cleanQuery = encodeURIComponent(query.trim());
  const first = (Math.max(1, page) - 1) * 30 + 1;
  const targetUrl = `https://www.bing.com/videos/search?q=${cleanQuery}&first=${first}&count=35&adlt=off&qft=+filterui:duration-all`;

  try {
    const res = await axios.get(targetUrl, {
      httpsAgent,
      headers: {
        ...BROWSER_HEADERS,
        'Cookie': 'SRCHHPGUSR=ADLT=OFF&NRSLT=-1; _EDGE_S=mkt=en-US&ui=en-US&F=1; MUIDB=1;',
        'Referer': 'https://www.bing.com/',
      },
      timeout: 10000,
    });

    const html = res.data;
    if (!html || typeof html !== 'string') return [];

    const $ = cheerio.load(html);
    const results = [];
    const seenUrls = new Set();

    // Quét toàn bộ khối chứa video
    $('.mc_vtvc, div.videoCard, .inline_video_card').each((_, el) => {
      try {
        const card = $(el);
        const linkEl = card.find('a.vturl, a[href*="/videos/search"]').first();
        const rawHref = linkEl.attr('href') || '';

        // Đọc vrhm metadata
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

        let targetUrlFound = meta?.purl || meta?.curl || meta?.mediaurl;

        // Nếu không có trong vrhm, giải mã từ link redirect
        if (!targetUrlFound && rawHref) {
          const match = rawHref.match(/[?&](?:ru|rurl)=([^&]+)/i);
          if (match && match[1]) {
            targetUrlFound = decodeURIComponent(match[1]);
          }
        }

        if (!targetUrlFound || targetUrlFound.includes('bing.com') || !targetUrlFound.startsWith('http')) {
          return;
        }

        const publisher =
          card.find('.mc_vtvc_meta_row span, .source').first().text().trim() ||
          meta?.publisher ||
          'Web Video';

        if (seenUrls.has(targetUrlFound) || isBlacklisted(targetUrlFound, publisher)) {
          return;
        }
        seenUrls.add(targetUrlFound);

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

        const duration = card.find('.b_duration, .mc_vtvc_duration').text().trim() || '';

        results.push({
          title,
          videoUrl: targetUrlFound,
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
    console.warn('[Bing Clean Video Error]:', err.message);
    return [];
  }
}

// ====================== NGUỒN 2: YANDEX VIDEO (PARSER JSON) ======================
async function fetchYandexVideosDirect(query, page = 1, count = 20) {
  const cleanQuery = encodeURIComponent(query.trim());
  const p = Math.max(0, page - 1);
  const targetUrl = `https://yandex.com/video/search?text=${cleanQuery}&p=${p}&family=0`;

  try {
    const res = await axios.get(targetUrl, {
      httpsAgent,
      headers: {
        ...BROWSER_HEADERS,
        'Cookie': `yp=1750000000.sp.family:0; yandexuid=${Math.floor(Math.random() * 1e18)};`,
        'Referer': 'https://yandex.com/',
      },
      timeout: 10000,
    });

    const html = res.data;
    if (!html || typeof html !== 'string') return [];

    const $ = cheerio.load(html);
    const results = [];
    const seenUrls = new Set();

    // 1. Quét từ data-state JSON nhúng của Yandex
    const stateEl = $('[id^="VideoApp-"][data-state], [data-bem*="serp-list"]').first();
    const rawState = stateEl.attr('data-state');

    if (rawState) {
      try {
        const state = JSON.parse(rawState);
        const items = state?.initialState?.serpList?.items?.entities || {};
        for (const key of Object.keys(items)) {
          const item = items[key];
          const rawUrl = item?.url || item?.shareUrl;
          if (!rawUrl || seenUrls.has(rawUrl) || isBlacklisted(rawUrl)) continue;

          seenUrls.add(rawUrl);
          results.push({
            title: item.title || item.alt || query,
            videoUrl: rawUrl,
            thumbnailUrl: item.thumb?.url || item.thumbnailUrl || '',
            duration: item.duration || '',
            publisher: item.host || 'Yandex Video',
            views: item.views ? `${item.views} lượt xem` : '',
            engine: 'yandex',
          });
        }
      } catch {}
    }

    // 2. Quét dự phòng từ data-bem của từng item
    if (results.length === 0) {
      $('[data-bem*="serp-item"]').each((_, el) => {
        try {
          const bem = $(el).attr('data-bem');
          if (!bem) return;
          const parsed = JSON.parse(bem);
          const data = parsed['serp-item'] || parsed;
          const videoUrl = data.url || data.link;

          if (!videoUrl || seenUrls.has(videoUrl) || isBlacklisted(videoUrl)) return;
          seenUrls.add(videoUrl);

          results.push({
            title: data.title || $(el).find('.thumb-image__image').attr('alt') || query,
            videoUrl,
            thumbnailUrl: data.thumb || $(el).find('img').attr('src') || '',
            duration: data.duration || '',
            publisher: data.provider || 'Web Video',
            views: '',
            engine: 'yandex',
          });
        } catch {}
      });
    }

    return results.slice(0, count);
  } catch (err) {
    console.warn('[Yandex Video Direct Error]:', err.message);
    return [];
  }
}