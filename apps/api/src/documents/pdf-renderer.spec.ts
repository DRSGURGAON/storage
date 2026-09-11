import { ConfigService } from '@nestjs/config';
import { PdfRendererService } from './pdf-renderer.service';

/**
 * The renderer keeps one Chromium alive for the life of the process, which
 * is the right trade until that Chromium dies -- OOM-killed, crashed, or
 * reaped. Before this was handled, every document after such a death
 * failed with "Connection closed" and the only cure was restarting the
 * API. This test kills the browser on purpose and asks for another PDF.
 */
describe('PDF renderer', () => {
  const config = {
    get: (key: string) => (key === 'PUPPETEER_CHROMIUM_EXECUTABLE' ? process.env.PUPPETEER_CHROMIUM_EXECUTABLE : undefined),
  } as ConfigService;

  const html = '<!doctype html><html><body><h1>Bill</h1></body></html>';

  it('renders again after the browser it was holding has died', async () => {
    const renderer = new PdfRendererService(config);

    const first = await renderer.renderPdf(html);
    expect(first.subarray(0, 5).toString()).toBe('%PDF-');

    // Exactly what a crash leaves behind: a resolved promise holding a
    // browser that is no longer connected.
    await renderer.onModuleDestroy();

    const second = await renderer.renderPdf(html);
    expect(second.subarray(0, 5).toString()).toBe('%PDF-');

    await renderer.onModuleDestroy();
  }, 60_000);

  it('says which variable to set when no browser is configured, rather than failing the same way twice', async () => {
    const renderer = new PdfRendererService({ get: () => undefined } as unknown as ConfigService);
    await expect(renderer.renderPdf(html)).rejects.toThrow(/PUPPETEER_CHROMIUM_EXECUTABLE/);
    // The failure is not cached: fixing the setting must be enough.
    await expect(renderer.renderPdf(html)).rejects.toThrow(/PUPPETEER_CHROMIUM_EXECUTABLE/);
  });
});
