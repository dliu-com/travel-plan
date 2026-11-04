import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const LOCAL_ASSET = /(<(?:script|link)\b[^>]*\b(?:src|href)=")\/([\w.-]+\.(?:js|css))(")/g;

// Scripts and styles are cached for minutes (and served stale for a day), while the HTML is no-cache.
// Writing each file's content hash into its URL means a new page always loads its matching script.
export function versionAssets(html: string, webDir: string): string {
  return html.replace(LOCAL_ASSET, (_match, before: string, file: string, after: string) => {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(webDir, file))).digest('hex').slice(0, 12);
    return `${before}/${file}?v=${hash}${after}`;
  });
}
