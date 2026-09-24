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
  'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
};

export async function fetchWebResults(query, page = 1, options = {}) {
  const { engine = 'bing' } = options;
  console.log(`[Web Service] Tìm kiếm bài viết: "${query}" - Trang: ${page} - Engine: ${engine}`);

  // Nguồn 2: Ưu tiên Yahoo Web Search
  if (engine === 'yandex' || engine === 'yahoo') {
    const yahooResults = await fetchYahooWeb(query, page);
    if (yahooResults && yahooResults.length > 0) {
      console.log(`[Web Service] Yahoo tìm thấy: ${yahooResults.length} bài viết (Trang ${page})`);
      return yahooResults;
    }
  }

  // Nguồn 1 (Mặc định): Bing Web qua RSS Feed (Cực nhanh, không bao giờ timeout trên Render)
  const bingResults = await fetchBingRSSWeb(query, page);
  if (bingResults && bingResults.length > 0) {
    console.log(`[Web Service] Bing RSS tìm thấy: ${bingResults.length} bài viết (Trang ${page})`);
    return bingResults;
  }

  // Fallback: Yahoo Web
  const fallbackYahoo = await fetchYahooWeb(query, page);
  if (fallbackYahoo && fallbackYahoo.length > 0) {
    console.log(`[Web Service] Fallback Yahoo tìm thấy: ${fallbackYahoo.length} bài viết`);
    return fallbackYahoo;
  }

  return [];
}

// ====================== NGUỒN 1: BING WEB RSS (CHỐNG TIMEOUT & CHẶN BOT) ======================
async function fetchBingRSSWeb(query, page = 1) {
  const cleanQuery = encodeURIComponent(query.trim());
  const first = (Math.max(1, page) - 1) * 10 + 1;
  // Endpoint RSS của Bing chấp nhận tham số first và format=rss chuẩn
  const targetUrl = `https://www.bing.com/search?q=${cleanQuery}&format=rss&first=${first}&setmkt=vi-VN&setlang=vi`;

  try {
    const res = await axios.get(targetUrl, {
      httpsAgent,
      headers: {
        ...BROWSER_HEADERS,
        'Cookie': 'SRCHHPGUSR=ADLT=OFF&NRSLT=10; _EDGE_S=mkt=vi-VN&ui=vi-VN&F=1;',
      },
      timeout: 5000, // Timeout ngắn 5s để không bị treo
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

        if (!title || !rawUrl || !rawUrl.startsWith('http')) return;
        if (seenUrls.has(rawUrl)) return;
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
    console.warn('[Bing RSS Warning]:', err.message);
    return [];
  }
}

// ====================== NGUỒN 2: YAHOO WEB (PHÂN TRANG OFFSET) ======================
async function fetchYahooWeb(query, page = 1) {
  const cleanQuery = encodeURIComponent(query.trim());
  const b = (Math.max(1, page) - 1) * 10 + 1;
  const targetUrl = `https://search.yahoo.com/search?p=${cleanQuery}&b=${b}&nojs=1`;

  try {
    const res = await axios.get(targetUrl, {
      httpsAgent,
      headers: {
        ...BROWSER_HEADERS,
        'Referer': 'https://search.yahoo.com/',
      },
      timeout: 6000,
    });

    const html = res.data;
    if (!html || typeof html !== 'string') return [];

    const $ = cheerio.load(html);
    const results = [];
    const seenUrls = new Set();

    $('.algo, .searchCenterMiddle li, #web li').each((_, el) => {
      try {
        const linkEl = $(el).find('h3 a, a.fz-m').first();
        let rawUrl = linkEl.attr('href');
        const title = linkEl.text().trim();
        const snippet = $(el).find('.compText, .fz-ms, span.fc-2nd').first().text().trim();

        if (!rawUrl || !title) return;

        // Bóc link thực từ redirect RU=
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
    console.warn('[Yahoo Web Warning]:', err.message);
    return [];
  }
}