import fs from 'node:fs';
import path from 'node:path';
import mime from 'mime-types';
import { tic, writeFileToFolder } from 'myst-cli-utils';
import { FRONTMATTER_ALIASES, PAGE_FRONTMATTER_KEYS } from 'myst-frontmatter';
import { writeIpynb } from 'myst-to-ipynb';
import type { IpynbOptions, ImageData } from 'myst-to-ipynb';
import { filterKeys } from 'simple-validators';
import { selectAll } from 'unist-util-select';
import { VFile } from 'vfile';
import { finalizeMdast } from '../../process/mdast.js';
import type { ISession } from '../../session/types.js';
import { logMessagesFromVFile } from '../../utils/logging.js';
import { KNOWN_IMAGE_EXTENSIONS } from '../../utils/resolveExtension.js';
import type { ExportWithOutput, ExportFnOptions } from '../types.js';
import { cleanOutput } from '../utils/cleanOutput.js';
import { getFileContent } from '../utils/getFileContent.js';
import { getSourceFolder } from '../../transforms/links.js';

export async function runIpynbExport(
  session: ISession,
  sourceFile: string,
  exportOptions: ExportWithOutput,
  opts?: ExportFnOptions,
) {
  const toc = tic();
  const { output, articles } = exportOptions;
  const { clean, projectPath, extraLinkTransformers, execute } = opts ?? {};
  // At this point, export options are resolved to contain one-and-only-one article
  const article = articles[0];
  if (!article?.file) return { tempFolders: [] };
  if (clean) cleanOutput(session, output);
  const [{ mdast, frontmatter }] = await getFileContent(session, [article.file], {
    projectPath,
    imageExtensions: KNOWN_IMAGE_EXTENSIONS,
    extraLinkTransformers,
    preFrontmatters: [
      filterKeys(article, [...PAGE_FRONTMATTER_KEYS, ...Object.keys(FRONTMATTER_ALIASES)]),
    ],
    execute,
  });
  await finalizeMdast(session, mdast, frontmatter, article.file, {
    imageWriteFolder: path.join(path.dirname(output), 'files'),
    imageAltOutputFolder: 'files/',
    imageExtensions: KNOWN_IMAGE_EXTENSIONS,
    simplifyFigures: false,
    useExistingImages: true,
  });
  const vfile = new VFile();
  vfile.path = output;
  // Build ipynb options from export config
  const ipynbOpts: IpynbOptions = {};
  if ((exportOptions as any).markdown === 'commonmark') {
    ipynbOpts.markdown = 'commonmark';
  }
  if ((exportOptions as any).images === 'attachment') {
    ipynbOpts.images = 'attachment';
    // Collect image data from the AST — read files and base64-encode
    ipynbOpts.imageData = await collectImageData(
      session,
      mdast,
      article.file,
      path.dirname(output),
    );
  }
  const mdOut = writeIpynb(vfile, mdast as any, frontmatter, ipynbOpts);
  logMessagesFromVFile(session, mdOut);
  session.log.info(toc(`📓 Exported IPYNB in %s, copying to ${output}`));
  writeFileToFolder(output, mdOut.result as string);
  return { tempFolders: [] };
}

/**
 * Collect base64-encoded image data from the mdast tree (Phase 1 of attachment embedding).
 *
 * Walks all image nodes via `selectAll('image', mdast)`, resolves their
 * filesystem paths using `getSourceFolder` (handles both absolute `/_static/...`
 * and relative paths), reads the files, and base64-encodes them into a map.
 *
 * The returned `Record<url, ImageData>` is passed to `writeIpynb` as
 * `options.imageData`. Phase 2 (in `embedImagesAsAttachments`) then rewrites
 * the serialized markdown to use `attachment:` references.
 *
 * Remote URLs (http/https) and data URIs are skipped — only local files are embedded.
 *
 * URLs are resolved against the source file's folder first; if not found
 * there, against the export output folder — `finalizeMdast` rewrites
 * generated images (e.g. executed notebook outputs) to `files/...` web
 * paths under the output folder, so those only exist at the output side.
 */
async function collectImageData(
  session: ISession,
  mdast: any,
  sourceFile: string,
  outputFolder: string,
): Promise<Record<string, ImageData>> {
  const imageData: Record<string, ImageData> = {};
  const imageNodes = selectAll('image', mdast) as any[];
  const sourcePath = session.sourcePath();
  const seen = new Set<string>();

  const tasks = imageNodes.map(async (img) => {
    const url = img.url ?? img.urlSource;
    if (
      !url ||
      url.startsWith('http://') ||
      url.startsWith('https://') ||
      url.startsWith('data:')
    ) {
      return;
    }
    if (seen.has(url)) return; // already processed
    seen.add(url);

    const sourceFolder = getSourceFolder(url, sourceFile, sourcePath);
    const relativeUrl = url.replace(/^[/\\]+/, '');
    const candidates = [path.join(sourceFolder, relativeUrl), path.join(outputFolder, relativeUrl)];

    for (const filePath of candidates) {
      try {
        const buffer = await fs.promises.readFile(filePath);
        const mimeType = (mime.lookup(filePath) || 'application/octet-stream') as string;
        imageData[url] = {
          mime: mimeType,
          data: buffer.toString('base64'),
        };
        return;
      } catch (err) {
        // try the next candidate
      }
    }
    session.log.debug(`Image not found for attachment embedding: ${url}`);
  });
  await Promise.all(tasks);

  return imageData;
}
