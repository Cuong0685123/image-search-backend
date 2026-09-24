import axios from 'axios';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';

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
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    browserInstance.on('disconnected', () => {
      browserInstance = null;
    });
  }
  return browserInstance;
}

function resolveUrl(relativeUrl, baseUrl) {
  try {
    return new URL(relativeUrl, baseUrl).href;
  } catch {
    return null;
  }
}

async function extractWithCheerio(targetUrl) {
  const res = await axios.get(targetUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
    timeout: 10000,
  });

  const $ = cheerio.load(res.data);
  const images = new Set();

  const ogImage = $('meta[property="og:image"]').attr('content');
  if (ogImage) {
    const full = resolveUrl(ogImage, targetUrl);
    if (full) images.add(full);
  }

  $('img').each((_, el) => {
    const src =
      $(el).attr('src') ||
      $(el).attr('data-src') ||
      $(el).attr('data-original') ||
      $(el).attr('data-lazy-src');

    if (src) {
      const full = resolveUrl(src, targetUrl);
      if (full && !full.startsWith('data:image/svg')) {
        images.add(full);
      }
    }

    const srcset = $(el).attr('srcset');
    if (srcset) {
      const urls = srcset.split(',').map((part) => part.trim().split(' ')[0]);
      urls.forEach((u) => {
        const full = resolveUrl(u, targetUrl);
        if (full) images.add(full);
      });
    }
  });

  return Array.from(images);
}

async function extractWithPuppeteer(targetUrl) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 20000 });

    // Cuộn nhẹ xuống để kích hoạt lazy load
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 400;
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= 2000) {
            clearInterval(timer);
            resolve();
          }
        }, 150);
      });
    });

    const imageUrls = await page.evaluate(() => {
      const urls = new Set();
      const imgs = document.querySelectorAll('img');
      imgs.forEach((img) => {
        const src = img.currentSrc || img.src || img.getAttribute('data-src');
        if (src && src.startsWith('http')) {
          urls.add(src);
        }
      });
      return Array.from(urls);
    });

    return imageUrls;
  } finally {
    await page.close().catch(() => null);
  }
}

export async function scrapeImagesFromUrl(targetUrl) {
  try {
    const images = await extractWithCheerio(targetUrl);
    if (images.length > 0) return images;
    return await extractWithPuppeteer(targetUrl);
  } catch {
    return await extractWithPuppeteer(targetUrl);
  }
}