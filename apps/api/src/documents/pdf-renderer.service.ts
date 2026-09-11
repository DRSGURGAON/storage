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
 * instant any test imports this file's module graph. So the load has to
 * reach runtime as a literal dynamic `import()`, hidden from TypeScript's
 * commonjs downlevel (which would otherwise rewrite it straight back into
 * that same `require()`), and it has to be a *direct* `eval` to do it.
 *
 * `new Function('return import("puppeteer-core")')` hides it just as well
 * and was the first thing tried, but it is subtly wrong under Jest. V8
 * gives a `new Function` body the *default* host-defined options, so Node
 * resolves its `import()` through the process-wide default callback --
 * and Jest registers that callback once, from whichever test environment
 * happened to be created first. Every later spec file therefore imported
 * against a torn-down environment: the second spec to render a PDF failed
 * with "Test environment has been torn down", however the function was
 * constructed (DECISIONS.md §30). A direct `eval` instead inherits the
 * host-defined options of the script that calls it -- this module, as
 * compiled by the *live* runtime -- so the import always resolves against
 * the environment actually running. Plain Node treats both forms alike.
 *
 * Two other routes are dead ends worth naming: a static
 * `await import(...)` is what tsc rewrites, and `createRequire` does not
 * escape Jest either -- Jest patches `node:module` so the require handle
 * it hands back is jest-runtime's own, which refuses ESM outright.
 */
function loadPuppeteerCore(): Promise<typeof import('puppeteer-core')> {
  // eslint-disable-next-line no-eval
  return eval('import("puppeteer-core")') as Promise<typeof import('puppeteer-core')>;
}

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
    if (this.browserPromise) {
      // A browser that died -- OOM-killed, crashed, or reaped by the
      // container -- leaves a resolved promise holding a corpse, and every
      // later render fails with "Connection closed" until someone restarts
      // the API. So the cached one is used only while it is still
      // connected, and otherwise thrown away and relaunched.
      const existing = await this.browserPromise.catch(() => null);
      if (existing?.connected) return existing;
      this.browserPromise = null;
    }

    const executablePath = this.config.get<string>('PUPPETEER_CHROMIUM_EXECUTABLE');
    if (!executablePath) {
      // `puppeteer-core` never looks for a browser on its own -- that is
      // the whole difference between it and `puppeteer`, which bundles a
      // download. Left to itself it raises "An `executablePath` or
      // `channel` must be specified for `puppeteer-core`", which reaches
      // an operator as a 500 on the first Generate click and names
      // nothing they can set. So it is said here instead, with the
      // variable in it.
      throw new Error(
        'PUPPETEER_CHROMIUM_EXECUTABLE is not set, so no browser can be launched to render PDFs. ' +
          'Point it at a Chrome or Chromium binary (the container image sets it to /usr/bin/chromium).',
      );
    }

    // A failed launch is not cached either: a machine that was briefly out
    // of memory would otherwise never render a document again.
    const launching = loadPuppeteerCore().then(({ default: puppeteer }) =>
      puppeteer.launch({ executablePath, args: ['--no-sandbox'] }),
    );
    this.browserPromise = launching;
    launching.catch(() => {
      if (this.browserPromise === launching) this.browserPromise = null;
    });
    return launching;
  }

  async renderPdf(html: string): Promise<Buffer> {
    try {
      return await this.renderOnce(html);
    } catch (error) {
      // The browser can die *between* the connected check and the render.
      // One retry on a fresh browser turns a document an operator is
      // waiting for into a document they get.
      if (!isDisconnected(error)) throw error;
      this.browserPromise = null;
      return this.renderOnce(html);
    }
  }

  private async renderOnce(html: string): Promise<Buffer> {
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
      const browser = await this.browserPromise.catch(() => null);
      await browser?.close();
    }
  }
}

/**
 * Puppeteer signals a dead browser by message rather than by type -- there
 * is no exported error class to catch.
 */
function isDisconnected(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Connection closed') ||
    message.includes('Target closed') ||
    message.includes('Session closed') ||
    message.includes('Protocol error') ||
    message.includes('browser has disconnected')
  );
}
