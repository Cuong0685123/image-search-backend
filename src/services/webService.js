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
    return await fetchDuckDuckGoLiteDirect(query, page);
  }

  // Mặc định Bing, nếu Bing rỗng thì tự động fallback DuckDuckGo
  const bingResults = await fetchBingWeb(query, page);
  if (bingResults && bingResults.length > 0) {
    return bingResults;
  }

  console.log(`[Fallback] Bing rỗng, chuyển sang DuckDuckGo cho từ khóa: ${query}`);
  return await fetchDuckDuckGoLiteDirect(query, page);
}

// ====================== BING WEB ======================
async function fetchBingWeb(query, page = 1) {
  const cleanQuery = encodeURIComponent(query.trim());
  const first = (Math.max(1, page) - 1) * 10 + 1;
  const targetUrl = `https://www.bing.com/search?q=${cleanQuery}&format=rss&first=${first}`;

  let xmlData = '';
  try {
    const res = await axios.get(targetUrl, {
      httpsAgent,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/xml,application/xml,application/xhtml+xml,text/html;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 8000,
    });
    xmlData = res.data;
  } catch (err) {
    return [];
  }

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
}

// ====================== DUCKDUCKGO LITE DIRECT (SIÊU NHẸ, KHÔNG BỊ CHẶN) ======================
async function fetchDuckDuckGoLiteDirect(query, page = 1) {
  const cleanQuery = encodeURIComponent(query.trim());
  const sOffset = (Math.max(1, page) - 1) * 30;
  const targetUrl = `https://html.duckduckgo.com/html/?q=${cleanQuery}&s=${sOffset}&dc=${sOffset}&v=l&o=json&api=/d.js&kl=wt-wt`;

  try {
    const res = await axios.post(
      'https://html.duckduckgo.com/html/',
      new URLSearchParams({ q: query.trim(), s: sOffset.toString(), b: '' }).toString(),
      {
        httpsAgent,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Origin': 'https://html.duckduckgo.com',
          'Referer': 'https://html.duckduckgo.com/',
        },
        timeout: 9000,
      }
    );

    const $ = cheerio.load(res.data);
    const results = [];
    const seenUrls = new Set();

    $('.result').each((_, el) => {
      try {
        const linkEl = $(el).find('a.result__url, a.result__title').first();
        let rawUrl = $(el).find('a.result__snippet').attr('href') || linkEl.attr('href');
        const title = $(el).find('a.result__title').text().trim();
        const snippet = $(el).find('.result__snippet').text().trim();

        if (!rawUrl || !title) return;

        if (rawUrl.includes('uddg=')) {
          const match = rawUrl.match(/uddg=([^&]+)/);
          if (match && match[1]) {
            rawUrl = decodeURIComponent(match[1]);
          }
        }

        if (!rawUrl.startsWith('http') || rawUrl.includes('duckduckgo.com') || seenUrls.has(rawUrl)) return;
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
          engine: 'duckduckgo',
        });
      } catch {}
    });

    if (results.length > 0) return results;
  } catch (err) {
    console.warn('Lỗi cào DuckDuckGo HTML:', err.message);
  }

  // Nếu cào HTTP bị chặn mới dùng đến Puppeteer
  return await fetchDuckDuckGoWeb(query, page);
}

// ====================== YANDEX WEB ======================
async function fetchYandexWeb(query, page = 1) {
  const p = Math.max(0, page - 1);
  const cleanQuery = encodeURIComponent(query.trim());
  const targetUrl = `https://yandex.com/search/?text=${cleanQuery}&p=${p}&lr=87&nomisspell=1`;

  try {
    const res = await axios.get(targetUrl, {
      httpsAgent,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': `yandexuid=${Math.floor(Math.random() * 1e18)}; is_gdpr=0; is_gdpr_b=0;`,
        'Referer': 'https://yandex.com/',
      },
      timeout: 10000,
    });

    const html = res.data;
    if (!html || typeof html !== 'string' || html.includes('CheckboxCaptcha')) {
      return await fetchDuckDuckGoLiteDirect(query, page);
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

        const snippet = $(el).find('.OrganicTextContentSpan, .organic__text, .text-container').first().text().trim() || '';

        results.push({
          title,
          url: rawUrl,
          domain,
          snippet,
          engine: 'yandex',
        });
      } catch {}
    });

    return results.length > 0 ? results : await fetchDuckDuckGoLiteDirect(query, page);
  } catch {
    return await fetchDuckDuckGoLiteDirect(query, page);
  }
}

// ====================== PUPPETEER DDG LITE ======================
export async function fetchDuckDuckGoWeb(query, page = 1) {
  const cleanQuery = query.trim();
  const pageIndex = Math.max(1, page);
  const sOffset = (pageIndex - 1) * 30;

  const browser = await getBrowser();
  const browserPage = await browser.newPage();

  try {
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
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    );

    const targetUrl = `https://lite.duckduckgo.com/lite/`;
    await browserPage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 12000 });

    await browserPage.evaluate((q, s) => {
      const form = document.querySelector('form');
      if (form) {
        const inputQ = form.querySelector('input[name="q"]') || document.createElement('input');
        inputQ.name = 'q';
        inputQ.value = q;
        form.appendChild(inputQ);

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

    await browserPage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => null);

    const results = await browserPage.evaluate(() => {
      const items = [];
      const seen = new Set();
      const links = document.querySelectorAll('a.result-link');

      links.forEach((linkEl) => {
        let rawUrl = linkEl.getAttribute('href') || '';
        const title = linkEl.innerText.trim();

        if (!title || !rawUrl) return;

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