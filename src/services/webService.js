import axios from 'axios';
import https from 'https';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';
const httpsAgent = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: false,
});
let browserInstance = null;

async function getBrowser() {
  // Kiểm tra an toàn: hỗ trợ cả browser.connected và browser.isConnected()
  const isAlive =
    browserInstance &&
    (typeof browserInstance.isConnected === 'function'
      ? browserInstance.isConnected()
      : browserInstance.connected === true);

  if (!isAlive) {
    browserInstance = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    // Reset biến nếu trình duyệt bị tắt đột ngột
    browserInstance.on('disconnected', () => {
      browserInstance = null;
    });
  }
  return browserInstance;
}
export async function fetchWebResults(query, page = 1, options = {}) {
  const { engine = 'bing' } = options;

  if (engine === 'yandex') {
    return await fetchYandexWeb(query, page);
  }
if (engine === 'duckduckgo') {
    return await fetchDuckDuckGoWeb(query, page);
  }
  return await fetchBingWeb(query, page);
}

// ====================== BING WEB (RSS / CLEAN ENDPOINT) ======================
async function fetchBingWeb(query, page = 1) {
  const cleanQuery = encodeURIComponent(query.trim());
  const first = (Math.max(1, page) - 1) * 10 + 1;
  
  // Endpoint RSS của Bing: siêu nhẹ, chuẩn phân trang, không bao giờ bị trùng kết quả
  const targetUrl = `https://www.bing.com/search?q=${cleanQuery}&format=rss&first=${first}`;

  let xmlData = '';
  try {
    const res = await axios.get(targetUrl, {
      httpsAgent,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/xml,application/xml,application/xhtml+xml,text/html;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8',
      },
      timeout: 9000,
    });
    xmlData = res.data;
  } catch (errDirect) {
    try {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
      const proxyRes = await axios.get(proxyUrl, { timeout: 12000 });
      xmlData = proxyRes.data;
    } catch {
      return [];
    }
  }

  if (!xmlData || typeof xmlData !== 'string') return [];

  // Parse dữ liệu XML bằng cheerio với xmlMode = true
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
        // Loại bỏ các thẻ HTML rác trong snippet nếu có
        snippet: snippet.replace(/<[^>]*>?/gm, '').trim(),
        engine: 'bing',
      });
    } catch {}
  });

  return results;
}
// ====================== YANDEX WEB ======================
async function fetchYandexWeb(query, page = 1) {
  const p = Math.max(0, page - 1);
  const cleanQuery = encodeURIComponent(query.trim());
  const targetUrl = `https://yandex.com/search/?text=${cleanQuery}&p=${p}&lr=87&nomisspell=1`;

  let html = '';
  try {
    const res = await axios.get(targetUrl, {
      httpsAgent,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': `yandexuid=${Math.floor(Math.random() * 1e18)}; is_gdpr=0; is_gdpr_b=0;`,
        'Referer': 'https://yandex.com/',
      },
      timeout: 10000,
    });
    html = res.data;
  } catch (errDirect) {
    try {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
      const proxyRes = await axios.get(proxyUrl, { timeout: 12000 });
      html = proxyRes.data;
    } catch {
      return [];
    }
  }

  if (!html || typeof html !== 'string') return [];

  if (html.includes('CheckboxCaptcha') || html.includes('smart-captcha') || html.includes('robot')) {
    console.warn('Yandex phát hiện CAPTCHA, kích hoạt fallback sang Bing.');
    return await fetchBingWeb(query, page);
  }

  const $ = cheerio.load(html);
  const results = [];
  const seenUrls = new Set();

  $('li.serp-item, div.serp-item, .Organic').each((_, el) => {
    try {
      const linkEl = $(el).find('h2 a, a.OrganicTitle-Link, a.Link_theme_outer, a[target="_blank"]').first();
      let rawUrl = linkEl.attr('href');
      let title = linkEl.text().trim();

      if (!rawUrl || !title) return;
      if (rawUrl.startsWith('//')) rawUrl = 'https:' + rawUrl;
      if (!rawUrl.startsWith('http') || rawUrl.includes('yandex.')) return;

      if (seenUrls.has(rawUrl)) return;
      seenUrls.add(rawUrl);

      let domain = 'web';
      try {
        domain = new URL(rawUrl).hostname.replace(/^www\./, '');
      } catch {}

      const snippet =
        $(el).find('.OrganicTextContentSpan, .organic__text, .ExtendedText-Full, .Organic-Content, .text-container').first().text().trim() ||$(el).find('div[class*="text"], span[class*="text"]').first().text().trim() ||
        '';

      results.push({
        title,
        url: rawUrl,
        domain,
        snippet,
        engine: 'yandex',
      });
    } catch {}
  });

  if (results.length === 0) {
    return await fetchBingWeb(query, page);
  }

  return results;
}// Bộ nhớ đệm lưu link trang tiếp theo do Bing tự tạo ra
const nextPageCache = new Map();

// ====================== NGUỒN 3: PUPPETEER DUCKDUCKGO LITE (KHÔNG LỌC, PHÂN TRANG CHUẨN) ======================
export async function fetchDuckDuckGoWeb(query, page = 1) {
  const cleanQuery = query.trim();
  const pageIndex = Math.max(1, page);
  // DDG Lite phân trang theo số lượng bài: trang 1 -> 0, trang 2 -> 30, trang 3 -> 60...
  const sOffset = (pageIndex - 1) * 30;

  const browser = await getBrowser();
  const browserPage = await browser.newPage();

  try {
    // Chỉ chặn ảnh và font để tăng tốc, giữ lại HTML/Script cơ bản
    await browserPage.setRequestInterception(true);
    browserPage.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'font', 'media'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await browserPage.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    // URL DDG Lite kèm kp=-1 (Tắt hoàn toàn SafeSearch, hiển thị tất cả các chủ đề)
    const targetUrl = `https://lite.duckduckgo.com/lite/`;

    await browserPage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 12000 });

    // Điền form tìm kiếm trực tiếp trên giao diện để tránh bot-check
    await browserPage.evaluate((q, s) => {
      const form = document.querySelector('form');
      if (form) {
        const inputQ = form.querySelector('input[name="q"]') || document.createElement('input');
        inputQ.name = 'q';
        inputQ.value = q;
        form.appendChild(inputQ);

        // kp = -1: SafeSearch Off
        const inputKp = document.createElement('input');
        inputKp.name = 'kp';
        inputKp.value = '-1';
        form.appendChild(inputKp);

        if (s > 0) {
          const inputS = document.createElement('input');
          inputS.name = 's';
          inputS.value = s.toString();
          form.appendChild(inputS);
        }

        form.submit();
      }
    }, cleanQuery, sOffset);

    // Đợi trang kết quả load xong bảng dữ liệu
    await browserPage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => null);

    // Trích xuất dữ liệu kết quả từ các hàng trong bảng DDG Lite
    const results = await browserPage.evaluate(() => {
      const items = [];
      const seen = new Set();
      const links = document.querySelectorAll('a.result-link');

      links.forEach((linkEl) => {
        let rawUrl = linkEl.getAttribute('href') || '';
        const title = linkEl.innerText.trim();

        if (!title || !rawUrl) return;

        // Giải mã link redirect qua uddg nếu có
        if (rawUrl.includes('uddg=')) {
          const match = rawUrl.match(/uddg=([^&]+)/);
          if (match && match[1]) {
            try {
              rawUrl = decodeURIComponent(match[1]);
            } catch {}
          }
        }

        if (!rawUrl.startsWith('http') || rawUrl.includes('duckduckgo.com') || seen.has(rawUrl)) return;
        seen.add(rawUrl);

        let domain = 'web';
        try {
          domain = new URL(rawUrl).hostname.replace(/^www\./, '');
        } catch {}

        // Đoạn mô tả snippet nằm ở dòng kế tiếp trong bảng
        let snippet = '';
        const trParent = linkEl.closest('tr');
        if (trParent && trParent.nextElementSibling) {
          const snippetTd = trParent.nextElementSibling.querySelector('.result-snippet');
          if (snippetTd) {
            snippet = snippetTd.innerText.trim();
          }
        }

        items.push({
          title,
          url: rawUrl,
          domain,
          snippet,
          engine: 'duckduckgo',
        });
      });

      return items;
    });

    return results;
  } catch (err) {
    console.warn('Lỗi Puppeteer DDG Lite:', err.message);
    return [];
  } finally {
    await browserPage.close().catch(() => null);
  }
}