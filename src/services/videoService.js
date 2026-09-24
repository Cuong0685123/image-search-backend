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

function decodeBingRedirectUrl(rawHref = '') {
  if (!rawHref) return null;
  const match = rawHref.match(/[?&](?:ru|rurl)=([^&]+)/i);
  if (match && match[1]) {
    try {
      let decoded = decodeURIComponent(match[1]);
      if (
        decoded.includes('%3A') ||
        decoded.includes('%2F') ||
        decoded.includes('%3a') ||
        decoded.includes('%2f')
      ) {
        decoded = decodeURIComponent(decoded);
      }
      if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
        return decoded;
      }
    } catch {}
  }
  return null;
}

export async function fetchVideos(query, page = 1, options = {}) {
  const { engine = 'bing', count = 20 } = options;
  console.log(`[Video Service] Bắt đầu tìm: "${query}" - Trang: ${page} - Engine: ${engine}`);

  if (engine === 'yandex') {
    const yandexRes = await fetchYandexVideos(query, page, { count });
    if (yandexRes && yandexRes.length > 0) {
      console.log(`[Video Service] Yandex Video tìm thấy: ${yandexRes.length} video`);
      return yandexRes;
    }
  }

  // Mặc định hoặc fallback sang Bing Video Main
  const bingResults = await fetchBingVideosMain(query, page, { count });
  if (bingResults && bingResults.length > 0) {
    console.log(`[Video Service] Bing Video tìm thấy: ${bingResults.length} video`);
    return bingResults;
  }

  // Nếu cả 2 đều rỗng, thử phương án quét mở rộng qua Bing Web Video
  console.log(`[Video Service] Chuyển hướng quét Web Video...`);
  return await fetchBingWebVideosFallback(query, page, { count });
}

// ====================== BING VIDEOS (ENDPOINT CHÍNH THỨC) ======================
async function fetchBingVideosMain(query, page = 1, options = {}) {
  const { count = 20 } = options;
  const cleanQuery = encodeURIComponent(query.trim());
  const first = (Math.max(1, page) - 1) * count + 1;

  // Sử dụng endpoint chuẩn có tham số form và adlt=off
  const targetUrl = `https://www.bing.com/videos/search?q=${cleanQuery}&first=${first}&count=${count}&adlt=off&qft=+filterui:duration-all&form=HDRSC3`;

  try {
    const res = await axios.get(targetUrl, {
      httpsAgent,
      headers: {
        ...BROWSER_HEADERS,
        'Cookie': 'SRCHHPGUSR=ADLT=OFF&NRSLT=-1; _EDGE_S=mkt=en-US&ui=en-US&F=1; MUIDB=1;',
        'Referer': 'https://www.bing.com/',
      },
      timeout: 9000,
    });

    const html = res.data;
    if (!html || typeof html !== 'string') return [];

    const $ = cheerio.load(html);
    const results = [];
    const seenUrls = new Set();

    // Bóc tách cả card dạng desktop lẫn mobile
    $('.mc_vtvc, .inline_video_card, div.dg_u, [data-vrm]').each((_, el) => {
      try {
        const card = $(el);
        const linkEl = card.find('a[href*="/videos/search"], a.vturl, a').first();
        const rawHref = linkEl.attr('href') || card.attr('href') || '';

        const rawMeta =
          card.attr('vrhm') ||
          card.attr('data-vrm') ||
          card.attr('data-promoted') ||
          linkEl.attr('data-vrm') ||
          linkEl.attr('vrhm');

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

        let externalUrl = null;
        if (meta?.purl && !meta.purl.includes('bing.com')) {
          externalUrl = meta.purl;
        } else if (meta?.curl && !meta.curl.includes('bing.com')) {
          externalUrl = meta.curl;
        } else if (meta?.url && !meta.url.includes('bing.com')) {
          externalUrl = meta.url;
        } else if (meta?.mediaurl && !meta.mediaurl.includes('bing.com')) {
          externalUrl = meta.mediaurl;
        }

        if (!externalUrl) {
          externalUrl = decodeBingRedirectUrl(rawHref);
        }

        if (!externalUrl || externalUrl.includes('bing.com') || externalUrl.startsWith('/')) {
          return;
        }

        const publisher =
          card.find('.mc_vtvc_meta_row span, .source, .publisher').first().text().trim() ||
          meta?.publisher ||
          meta?.source ||
          'Web Video';

        if (seenUrls.has(externalUrl) || isBlacklisted(externalUrl, publisher)) {
          return;
        }
        seenUrls.add(externalUrl);

        const title =
          card.find('.mc_vtvc_title, .b_tit, .title').text().trim() ||
          linkEl.attr('title') ||
          card.find('a[title]').attr('title') ||
          meta?.title ||
          query;

        const imgEl = card.find('img').first();
        let thumbnailUrl =
          imgEl.attr('src') ||
          imgEl.attr('data-src') ||
          imgEl.attr('data-thumb') ||
          meta?.thumb?.url ||
          '';

        if (thumbnailUrl.startsWith('//')) {
          thumbnailUrl = 'https:' + thumbnailUrl;
        }

        const duration =
          card.find('.b_duration, .mc_vtvc_duration, .duration').text().trim() ||
          meta?.duration ||
          '';

        const views = card.find('.mc_vtvc_meta_row_sub span, .views').text().trim() || '';

        results.push({
          title,
          videoUrl: externalUrl,
          thumbnailUrl,
          duration,
          publisher,
          views,
          engine: 'bing',
        });
      } catch {}
    });

    return results;
  } catch (err) {
    console.warn(`[Bing Video Main Error]:`, err.message);
    return [];
  }
}

// ====================== YANDEX VIDEO ======================
async function fetchYandexVideos(query, page = 1, options = {}) {
  const { count = 20 } = options;
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

    $('.thumb-image__image, [data-bem*="serp-item"]').each((_, el) => {
      try {
        const itemEl = $(el).closest('[data-bem]');
        const dataBem = itemEl.attr('data-bem');
        if (!dataBem) return;

        const parsed = JSON.parse(dataBem);
        const videoData = parsed['serp-item'] || parsed;
        const externalUrl = videoData.url || videoData.link;

        if (!externalUrl || seenUrls.has(externalUrl) || isBlacklisted(externalUrl)) return;
        seenUrls.add(externalUrl);

        results.push({
          title: videoData.title || query,
          videoUrl: externalUrl,
          thumbnailUrl: videoData.thumb || videoData.thumbnail || '',
          duration: videoData.duration || '',
          publisher: videoData.provider || 'Yandex Video',
          views: '',
          engine: 'yandex',
        });
      } catch {}
    });

    return results.slice(0, count);
  } catch (err) {
    console.warn(`[Yandex Video Error]:`, err.message);
    return [];
  }
}

// ====================== PHƯƠNG ÁN QUÉT MỞ RỘNG (FALLBACK) ======================
async function fetchBingWebVideosFallback(query, page = 1, options = {}) {
  const { count = 20 } = options;
  const cleanQuery = encodeURIComponent(`${query.trim()} video`);
  const first = (Math.max(1, page) - 1) * count + 1;
  const targetUrl = `https://www.bing.com/search?q=${cleanQuery}&first=${first}&adlt=off`;

  try {
    const res = await axios.get(targetUrl, {
      httpsAgent,
      headers: BROWSER_HEADERS,
      timeout: 8000,
    });

    const $ = cheerio.load(res.data);
    const results = [];
    const seenUrls = new Set();

    $('li.b_algo').each((_, el) => {
      try {
        const titleEl = $(el).find('h2 a').first();
        const url = titleEl.attr('href');
        const title = titleEl.text().trim();
        if (!url || !url.startsWith('http') || seenUrls.has(url) || isBlacklisted(url)) return;

        seenUrls.add(url);
        let domain = 'Web Video';
        try {
          domain = new URL(url).hostname.replace(/^www\./, '');
        } catch {}

        results.push({
          title,
          videoUrl: url,
          thumbnailUrl: '',
          duration: '',
          publisher: domain,
          views: '',
          engine: 'bing',
        });
      } catch {}
    });

    return results.slice(0, count);
  } catch {
    return [];
  }
}