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
  const { count = 20 } = options;
  console.log(`[Video Service] Bắt đầu tìm: "${query}" - Trang: ${page}`);

  // 1. Quét qua Yahoo Video Search (Cực nhạy với từ khóa mở, có ảnh thumbnail đầy đủ)
  const yahooVideos = await fetchYahooVideos(query, page, count);
  if (yahooVideos && yahooVideos.length > 0) {
    console.log(`[Video Service] Tìm thấy: ${yahooVideos.length} video`);
    return yahooVideos;
  }

  return [];
}

async function fetchYahooVideos(query, page = 1, count = 20) {
  const cleanQuery = encodeURIComponent(query.trim());
  const b = (Math.max(1, page) - 1) * count + 1;
  const targetUrl = `https://video.search.yahoo.com/search/video?p=${cleanQuery}&b=${b}`;

  try {
    const res = await axios.get(targetUrl, {
      httpsAgent,
      headers: {
        ...BROWSER_HEADERS,
        'Referer': 'https://video.search.yahoo.com/',
      },
      timeout: 10000,
    });

    const html = res.data;
    if (!html || typeof html !== 'string') return [];

    const $ = cheerio.load(html);
    const results = [];
    const seenUrls = new Set();

    $('li.vr, div.v-card, .v-item').each((_, el) => {
      try {
        const linkEl = $(el).find('a[href*="/RU="], a.v-anchor, a').first();
        let rawHref = linkEl.attr('href') || '';
        let targetUrl = '';

        // Giải mã link gốc từ redirect RU= của Yahoo
        if (rawHref.includes('/RU=')) {
          const match = rawHref.match(/\/RU=([^/]+)/);
          if (match && match[1]) {
            try {
              targetUrl = decodeURIComponent(match[1]);
            } catch {}
          }
        } else if (rawHref.startsWith('http')) {
          targetUrl = rawHref;
        }

        if (!targetUrl || targetUrl.includes('yahoo.com') || seenUrls.has(targetUrl)) return;

        const publisher = $(el).find('.v-prov, .v-source, .source').first().text().trim() || 'Web Video';
        if (isBlacklisted(targetUrl, publisher)) return;
        seenUrls.add(targetUrl);

        const title = $(el).find('.v-title, h3, .v-meta-title').first().text().trim() || linkEl.attr('title') || query;
        const imgEl = $(el).find('img').first();
        let thumbnail = imgEl.attr('src') || imgEl.attr('data-src') || '';

        const duration = $(el).find('.v-time, .duration').first().text().trim() || '';
        const views = $(el).find('.v-views, .views').first().text().trim() || '';

        results.push({
          title,
          videoUrl: targetUrl,
          thumbnailUrl: thumbnail,
          duration,
          publisher,
          views,
          engine: 'video',
        });
      } catch {}
    });

    return results.slice(0, count);
  } catch (err) {
    console.warn(`[Yahoo Video Scrape Error]:`, err.message);
    return [];
  }
}