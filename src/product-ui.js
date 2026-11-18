import {product} from './product.js';

const e = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
/** Shared product chrome, with unbranded chrome for the CMS asset picker. */
export const chromeStyle = '.development-banner{background:#fff4d9;color:#4d3800;border:1px solid #d9bd73;border-radius:4px;padding:6px 12px;margin:0 0 12px;font-size:.9rem}.development-banner small{display:block;font-size:.8rem}.product-footer{border-top:1px solid #bcc7cf;margin-top:40px;padding:12px 0;font-size:.85rem;color:#4e606c;overflow-wrap:anywhere}';
const bannerFor = suite => `<aside class="development-banner" aria-label="Development notice"><strong>Development use only — not for production.</strong><small>${e(suite)}</small></aside>`;
export const banner = bannerFor(product.suite);
export const framedBanner = bannerFor('Local Developer Accelerator (LDA)');
export const headerText = picker => `${product.name} · ${picker ? 'Asset picker' : 'Instances'}`;
export const titleSuffix = ` · ${product.name}`;
const footerFor = (about = false) => `<footer class="product-footer">${e(product.name)} ${e(product.version)} · Apache 2.0${about ? '' : ' · Built by <a href="https://codingkoala.io" target="_blank" rel="noopener noreferrer">Coding Koala</a>'} · Development use only${about ? '' : ' · Not affiliated with or endorsed by Optimizely.'} · <a href="/about">About</a> · <a href="/about/privacy">Privacy</a> · <a href="/about/licence">Licence</a></footer>`;
export const footer = footerFor();
// About, Privacy and Legal notice carry attribution and legal text in the body.
export const aboutFooter = footerFor(true);
// The asset picker is opened by the CMS (popup or frame), so About opens in a new tab.
export const framedFooter = `<footer class="product-footer">${e(product.name)} ${e(product.version)} · Development use only · <a href="/about" target="_blank" rel="noopener noreferrer">About</a></footer>`;
