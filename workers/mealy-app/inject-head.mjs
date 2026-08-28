// Post-export step: Expo's SPA export owns index.html, so home-screen/PWA
// tags are injected here. Run via deploy.sh.
import { readFileSync, writeFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) throw new Error('usage: node inject-head.mjs <index.html>');

const TAGS = `
    <link rel="manifest" href="/manifest.json" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Mealy" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="theme-color" content="#000000" />
  </head>`;

const html = readFileSync(path, 'utf8');
if (!html.includes('</head>')) throw new Error('no </head> in ' + path);
if (html.includes('apple-touch-icon')) {
  console.log('head tags already present, skipping');
} else {
  writeFileSync(path, html.replace('</head>', TAGS));
  console.log('injected home-screen head tags');
}
