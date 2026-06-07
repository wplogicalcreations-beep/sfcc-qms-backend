const puppeteer = require('puppeteer');

function previewText(value, length) {
  return String(value).slice(0, length).replace(/\s+/g, ' ').trim();
}

async function generatePdfBuffer(html, options = {}) {
  let browser;
  const htmlString = typeof html === 'string' ? html : '';
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROMIUM_PATH || undefined;

  console.log('[PDF SERVICE] HTML input', {
    htmlLength: htmlString.length,
    htmlFirst100: previewText(htmlString, 100),
  });

  if (!htmlString.trim()) {
    console.error('[PDF SERVICE] Missing or empty HTML', {
      htmlLength: htmlString.length,
      htmlFirst200: previewText(htmlString, 200),
    });
    throw new Error('PDF HTML content is missing or empty');
  }

  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    ...(executablePath ? { executablePath } : {}),
  });

  try {
    const page = await browser.newPage();
    await page.setContent(htmlString, {
      waitUntil: ['load', 'domcontentloaded', 'networkidle0'],
      timeout: 30000,
    });

    const rawPdf = await page.pdf({
      format: options.format || 'A4',
      landscape: Boolean(options.landscape),
      printBackground: options.printBackground !== false,
      preferCSSPageSize: options.preferCSSPageSize !== false,
      margin: options.margin || {
        top: '6mm',
        right: '6mm',
        bottom: '6mm',
        left: '6mm',
      },
    });

    const pdfBuffer = Buffer.isBuffer(rawPdf) ? rawPdf : Buffer.from(rawPdf);
    const startsWithPDF = pdfBuffer.subarray(0, 4).toString('utf8') === '%PDF';

    console.log('[PDF SERVICE] PDF output', {
      rawPdfConstructorName: rawPdf?.constructor?.name || typeof rawPdf,
      pdfBufferLength: pdfBuffer.length,
      startsWithPDF,
    });

    if (!pdfBuffer.length) {
      throw new Error('Puppeteer returned an empty PDF buffer');
    }

    if (!startsWithPDF) {
      throw new Error('Puppeteer returned non-PDF content');
    }

    return pdfBuffer;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = { generatePdfBuffer };
