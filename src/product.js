import {readFileSync} from 'node:fs';

/** Product identity; the version is read once from package.json at startup. */
export const key = 'assets';
export const name = 'LDA Local Assets';
export const suite = 'Local Developer Accelerator for Optimizely';
export const publisher = 'Coding Koalas Pty Ltd';
export const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
export const dataVersion = 1;
export const compatibleWith = 'Optimizely DAM';
export const product = Object.freeze({key, name, suite, publisher, version, dataVersion, compatibleWith});
