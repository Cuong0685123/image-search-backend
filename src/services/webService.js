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
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
};

export async function fetchWebResults(query, page = 1, options = {}) {
  const { engine = 'bing' } = options;

  // 1. Thử Bing RSS trước (nguồn nhanh nhất, không bị chặn)
  const bingResults = await fetchBingWebRSS(query, page);
  if (bingResults && bingResults.length > 0) {
    return bingResults;
  }

  // 2. Fallback sang Yahoo Search (dùng index Bing, cực kỳ nhẹ, không dính captcha)
  console.log(`[Web Fallback] Bing rỗng, chuyển sang Yahoo Web cho: ${query}`);
  const yahooResults = await fetchYahooWeb(query, page);
  if (yahooResults && yahooResults.length > 0) {
    return yahooResults;
  }

  return [];
}

// Bing RSS: Lấy bài viết web cực nhanh bằng Cheerio XML Mode
async function fetchBingWebRSS(query, page = 1) {
  const cleanQuery = encodeURIComponent(query.trim());
  const first = (Math.max(1, page) - 1) * 10 + 1;
  const targetUrl = `https://www.bing.com/search?q=${cleanQuery}&format=rss&first=${first}`;

  try {
    const res = await axios.get(targetUrl, {
      httpsAgent,
      headers: {
        ...BROWSER_HEADERS,
        'Cookie': 'SRCHHPGUSR=ADLT=OFF;',
      },
      timeout: 8000,
    });

    const xmlData = res.data;
    if (!xmlData || typeof xmlData !== 'string') return [];

    const $ = cheerio.load(xmlData, { xmlMode: true });
    const results = [];
    const seenUrls = new Set();

    $('item').each((_, el) => {
      try {
        const title = $(el).find('title').first().text().trim();
        const rawUrl = $(el).find('link').first().text().trim();
        const snippet = $(el).find('description').first().text().trim();

        if (!title || !rawUrl || !rawUrl.startsWith('http') || seenUrls.has(rawUrl)) return;
        seenUrls.add(rawUrl);

        let domain = 'web';
        try {
          domain = new URL(rawUrl).hostname.replace(/^www\./, '');
        } catch {}

        results.push({
          title,
          url: rawUrl,
          domain,
          snippet: snippet.replace(/<[^>]*>?/gm, '').trim(),
          engine: 'bing',
        });
      } catch {}
    });

    return results;
  } catch (err) {
    return [];
  }
}

// Yahoo Web: Chạy bằng Cheerio thuần, không dùng Puppeteer
async function fetchYahooWeb(query, page = 1) {
  const cleanQuery = encodeURIComponent(query.trim());
  const b = (Math.max(1, page) - 1) * 10 + 1;
  const targetUrl = `https://search.yahoo.com/search?p=${cleanQuery}&b=${b}&nojs=1`;

  try {
    const res = await axios.get(targetUrl, {
      httpsAgent,
      headers: BROWSER_HEADERS,
      timeout: 9000,
    });

    const html = res.data;
    if (!html || typeof html !== 'string') return [];

    const $ = cheerio.load(html);
    const results = [];
    const seenUrls = new Set();

    $('.algo, .searchCenterMiddle li').each((_, el) => {
      try {
        const linkEl = $(el).find('h3 a, a.fz-m').first();
        let rawUrl = linkEl.attr('href');
        const title = linkEl.text().trim();
        const snippet = $(el).find('.compText, .fz-ms').first().text().trim();

        if (!rawUrl || !title) return;

        // Giải mã link gốc nếu là RU redirect của Yahoo
        if (rawUrl.includes('/RU=')) {
          const match = rawUrl.match(/\/RU=([^/]+)/);
          if (match && match[1]) {
            try {
              rawUrl = decodeURIComponent(match[1]);
            } catch {}
          }
        }

        if (!rawUrl.startsWith('http') || rawUrl.includes('yahoo.com') || seenUrls.has(rawUrl)) return;
        seenUrls.add(rawUrl);

        let domain = 'web';
        try {
          domain = new URL(rawUrl).hostname.replace(/^www\./, '');
        } catch {}

        results.push({
          title,
          url: rawUrl,
          domain,
          snippet,
          engine: 'yahoo',
        });
      } catch {}
    });

    return results;
  } catch (err) {
    console.warn('[Yahoo Web Error]:', err.message);
    return [];
  }
}