import {readFile} from 'node:fs/promises';
import {product} from './product.js';
import {page, link, pre, e} from './dashboard.js';

export const ABOUT_FILES = {'/about/privacy': ['Privacy', 'PRIVACY.md'], '/about/licence': ['Licence', 'LICENSE.md'], '/about/legal': ['Legal notice', 'LEGAL-NOTICE.md']};
const links = () => `<p>${[['/about','About'],['/about/privacy','Privacy'],['/about/licence','Licence'],['/about/legal','Legal notice']].map(([href,label]) => link(href,label)).join(' · ')}</p>`;

/** About pages read the repository-root documents at request time and show them as escaped text. */
export async function aboutPage(path, root = new URL('../', import.meta.url)) {
  if (path === '/about') {
    const rows = [['Product', product.name], ['Suite', product.suite], ['Version', product.version], ['Data version', product.dataVersion], ['Publisher', `${product.publisher} (ACN 668 775 433)`], ['Compatible with', product.compatibleWith], ['Licence', 'Business Source License 1.1 — free for development and other non-production use']];
    return {status: 200, html: page('About', `<dl>${rows.map(([name, value]) => `<dt>${e(name)}</dt><dd>${e(value)}</dd>`).join('')}</dl><p>Development use only, not for production. Not affiliated with or endorsed by Optimizely.</p>${links()}`)};
  }
  const entry = ABOUT_FILES[path];
  if (!entry) return null;
  const [title, file] = entry;
  try { return {status: 200, html: page(title, links() + pre(await readFile(new URL(file, root), 'utf8')))}; }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return {status: 404, html: page(title, `${links()}<p class="error" role="alert">${e(file)} was not found in this installation.</p>`)};
  }
}
