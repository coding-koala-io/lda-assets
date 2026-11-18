import {readFile} from 'node:fs/promises';
import {product} from './product.js';
import {page, link, pre, e} from './dashboard.js';

export const ABOUT_FILES = {'/about/privacy': ['Privacy', 'PRIVACY.md'], '/about/licence': ['Licence', 'LICENSE.md'], '/about/legal': ['Legal notice', 'LEGAL-NOTICE.md']};
const links = () => `<p>${[['/about','About'],['/about/privacy','Privacy'],['/about/licence','Licence'],['/about/legal','Legal notice']].map(([href,label]) => link(href,label)).join(' · ')}</p>`;

/** About pages read the repository-root documents at request time and show them as escaped text. */
export async function aboutPage(path, root = new URL('../', import.meta.url)) {
  if (path === '/about') {
    const rows = [['Product', product.name], ['Version', product.version], ['Suite', product.suite], ['Compatible with', product.compatibleWith], ['Built by', 'Coding Koala', 'https://codingkoala.io'], ['Source', 'GitHub', 'https://github.com/coding-koala-io/lda-assets'], ['Licence', 'Apache License 2.0, development tool, not for production use'], ['Copyright', `2026 ${product.publisher} (ACN 668 775 433)`], ['Data version', product.dataVersion]];
    return {status: 200, html: page('About', `<dl>${rows.map(([name, value, href]) => `<dt>${e(name)}</dt><dd>${href ? `<a href="${e(href)}" target="_blank" rel="noopener noreferrer">${e(value)}</a>` : e(value)}</dd>`).join('')}</dl><p>Not affiliated with or endorsed by Optimizely. Optimizely® is a trademark of Optimizely North America Inc. Provided as is, without warranty.</p>${links()}`, '', {about:true})};
  }
  const entry = ABOUT_FILES[path];
  if (!entry) return null;
  const [title, file] = entry;
  try { return {status: 200, html: page(title, links() + pre(await readFile(new URL(file, root), 'utf8')), '', {about: path === '/about/privacy' || path === '/about/legal'})}; }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return {status: 404, html: page(title, `${links()}<p class="error" role="alert">${e(file)} was not found in this installation.</p>`)};
  }
}
