import { describe, expect, test } from 'vitest';
import { embedImagesAsAttachments } from '../src/attachments';

describe('embedImagesAsAttachments', () => {
  test('replaces image URL with attachment reference', () => {
    const md = '![Chart](/_static/img/chart.png)';
    const imageData = {
      '/_static/img/chart.png': { mime: 'image/png', data: 'base64data' },
    };
    const result = embedImagesAsAttachments(md, imageData);
    expect(result.md).toBe('![Chart](attachment:chart.png)');
    expect(result.attachments).toEqual({
      'chart.png': { 'image/png': 'base64data' },
    });
  });

  test('handles multiple images', () => {
    const md = '![A](/_static/a.png)\n\n![B](/_static/b.jpg)';
    const imageData = {
      '/_static/a.png': { mime: 'image/png', data: 'AAAA' },
      '/_static/b.jpg': { mime: 'image/jpeg', data: 'BBBB' },
    };
    const result = embedImagesAsAttachments(md, imageData);
    expect(result.md).toBe('![A](attachment:a.png)\n\n![B](attachment:b.jpg)');
    expect(result.attachments).toEqual({
      'a.png': { 'image/png': 'AAAA' },
      'b.jpg': { 'image/jpeg': 'BBBB' },
    });
  });

  test('deduplicates same-basename images with counter suffix', () => {
    const md = '![A](/dir1/img.png)\n\n![B](/dir2/img.png)';
    const imageData = {
      '/dir1/img.png': { mime: 'image/png', data: 'AAAA' },
      '/dir2/img.png': { mime: 'image/png', data: 'BBBB' },
    };
    const result = embedImagesAsAttachments(md, imageData);
    expect(result.md).toBe('![A](attachment:img.png)\n\n![B](attachment:img_1.png)');
    expect(result.attachments).toEqual({
      'img.png': { 'image/png': 'AAAA' },
      'img_1.png': { 'image/png': 'BBBB' },
    });
  });

  test('skips images not in imageData', () => {
    const md = '![A](/a.png)\n\n![B](/b.png)';
    const imageData = {
      '/a.png': { mime: 'image/png', data: 'AAAA' },
    };
    const result = embedImagesAsAttachments(md, imageData);
    expect(result.md).toBe('![A](attachment:a.png)\n\n![B](/b.png)');
    expect(result.attachments).toEqual({
      'a.png': { 'image/png': 'AAAA' },
    });
  });

  test('returns no attachments when imageData is empty', () => {
    const md = '![A](/a.png)';
    const result = embedImagesAsAttachments(md, {});
    expect(result.md).toBe('![A](/a.png)');
    expect(result.attachments).toBeUndefined();
  });

  test('returns no attachments when no images match', () => {
    const md = '![A](/a.png)';
    const imageData = {
      '/other.png': { mime: 'image/png', data: 'XXXX' },
    };
    const result = embedImagesAsAttachments(md, imageData);
    expect(result.md).toBe('![A](/a.png)');
    expect(result.attachments).toBeUndefined();
  });

  test('handles image with no alt text', () => {
    const md = '![](/_static/chart.png)';
    const imageData = {
      '/_static/chart.png': { mime: 'image/png', data: 'DATA' },
    };
    const result = embedImagesAsAttachments(md, imageData);
    expect(result.md).toBe('![](attachment:chart.png)');
    expect(result.attachments).toEqual({
      'chart.png': { 'image/png': 'DATA' },
    });
  });
});
