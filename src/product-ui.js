import {product} from './product.js';

const e = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
/** Shared product chrome: development banner, header text and one-line legal footer on every HTML page. */
export const chromeStyle = '.development-banner{background:#fff4d9;color:#4d3800;border:1px solid #d9bd73;border-radius:4px;padding:6px 12px;margin:0 0 12px;font-size:.9rem}.development-banner small{display:block;font-size:.8rem}.product-footer{border-top:1px solid #bcc7cf;margin-top:40px;padding:12px 0;font-size:.85rem;color:#4e606c;overflow-wrap:anywhere}';
export const banner = `<aside class="development-banner" aria-label="Development notice"><strong>Development use only — not for production.</strong><small>${e(product.suite)} · by Coding Koala</small></aside>`;
export const headerText = picker => `${product.name} · ${picker ? 'Asset picker' : 'Instances'}`;
export const titleSuffix = ` · ${product.name}`;
// The asset picker is opened by the CMS (popup or frame), so its product links open in a new tab.
const footerFor = (attributes = '') => `<footer class="product-footer">${e(product.name)} ${e(product.version)} · Development use only, not for production · Not affiliated with or endorsed by Optimizely · Optimizely® is a trademark of Optimizely North America Inc. · No warranty · <a href="/about"${attributes}>About</a> · <a href="/about/privacy"${attributes}>Privacy</a> · <a href="/about/licence"${attributes}>Licence</a> · <a href="/about/legal"${attributes}>Legal notice</a></footer>`;
export const footer = footerFor();
export const framedFooter = footerFor(' target="_blank" rel="noopener"');
