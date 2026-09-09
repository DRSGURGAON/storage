import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Browser } from 'puppeteer-core';

/**
 * puppeteer-core ships ESM-only (package.json "type": "module", all the
 * way down its own files). A plain `import puppeteer from 'puppeteer-core'`
 * compiles, under this project's `module: commonjs` tsconfig, to a
 * top-level `require('puppeteer-core')` -- which the real server satisfies
 * fine via Node 22's own require(esm) interop, but which Jest's
 * independent CJS module loader (jest-runtime, not plain Node `require`)
 * cannot: it throws "Cannot use import statement outside a module" the
 * instant any test imports this file's module graph. Routing the load
 * through `new Function(...)` hides the `import()` from TypeScript's
 * commonjs downlevel (which would otherwise rewrite it back into the same
 * problematic `require()`), so it survives to runtime as a literal dynamic
 * `import()` -- something both plain Node and Jest's test VM can execute
 * directly against the real, unmocked package.
 */
const importPuppeteerCore = new Function('return import("puppeteer-core")') as () => Promise<
  typeof import('puppeteer-core')
>;

/**
 * DECISIONS.md §0 / §24: headless Chromium via Puppeteer, driven with
 * plain HTML/CSS built by documents/html/layout.ts. One browser instance
 * is launched lazily and reused across renders (a fresh browser process
 * per PDF would be needlessly expensive); a fresh *page* is used per
 * render so concurrent generations don't share state.
 */
@Injectable()
export class PdfRendererService implements OnModuleDestroy {
  private browserPromise: Promise<Browser> | null = null;

  constructor(private readonly config: ConfigService) {}

  private async getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      const executablePath = this.config.get<string>('PUPPETEER_CHROMIUM_EXECUTABLE');
      this.browserPromise = importPuppeteerCore().then(({ default: puppeteer }) =>
        puppeteer.launch({
          executablePath: executablePath || undefined,
          args: ['--no-sandbox'],
        }),
      );
    }
    return this.browserPromise;
  }

  async renderPdf(html: string): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({
        format: 'A4',
        margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
        printBackground: true,
      });
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  }

  async onModuleDestroy() {
    if (this.browserPromise) {
      const browser = await this.browserPromise;
      await browser.close();
    }
  }
}
