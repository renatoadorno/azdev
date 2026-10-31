import pkg from '../../package.json';

// Injected at compile time by build.js (--define). Undefined when running from
// source, where package.json is the source of truth.
declare const BUILD_VERSION: string | undefined;

export const VERSION = typeof BUILD_VERSION === 'string' ? BUILD_VERSION : pkg.version;
