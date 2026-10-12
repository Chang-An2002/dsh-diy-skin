// Ask the running DSH webserver whether our plugin's client bundle is in its
// boot graph. The browser session token from the credentials file authenticates
// the request; it is never printed.
const fs = require('fs');
const path = require('path');

const CRED = path.join(process.env.USERPROFILE || '', '.dsh', '.credentials.yaml');
const BASE = 'http://127.0.0.1:19387';

const raw = fs.readFileSync(CRED, 'utf8');

// The file is small YAML; pull the browser-session token without a YAML dep.
function tokenFor(record) {
  const lines = raw.split(/\r?\n/);
  let inRecord = false;
  let indent = 0;
  for (const line of lines) {
    const m = /^(\s*)([A-Za-z0-9_./-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, spaces, key, value] = m;
    if (key === record) {
      inRecord = true;
      indent = spaces.length;
      continue;
    }
    if (inRecord) {
      if (spaces.length <= indent && key !== 'payload') inRecord = false;
      else if (['token', 'secret', 'value'].includes(key) && value) return value.replace(/^["']|["']$/g, '');
    }
  }
  return undefined;
}

const token = tokenFor('client-connection/browser-session');
console.log('browser-session token found:', token ? `yes (${token.length} chars)` : 'NO');

async function probe(url, headers) {
  try {
    const res = await fetch(url, { headers });
    const text = await res.text();
    return { status: res.status, text };
  } catch (error) {
    return { status: 0, text: String(error.message) };
  }
}

(async () => {
  const attempts = [
    ['cookie', { Cookie: `dsh_session=${token}` }],
    ['bearer', { Authorization: `Bearer ${token}` }],
    ['plain', { 'x-dsh-session': token }],
  ];

  let index;
  for (const [label, headers] of attempts) {
    const res = await probe(BASE + '/', { Accept: 'text/html', ...headers });
    console.log(`GET / via ${label}: HTTP ${res.status} (${res.text.length} bytes)`);
    if (res.status === 200) {
      index = res.text;
      break;
    }
  }

  if (!index) {
    console.log('could not authenticate; trying the plugin bundle path directly');
  } else {
    const mentions = /dsh-diy-skin/.test(index);
    console.log('boot payload mentions our plugin:', mentions);
    const combos = [...index.matchAll(/plugins\/[^"'\s]+/g)].map((m) => m[0]);
    console.log('plugin routes in payload:', [...new Set(combos)].slice(0, 8));
    if (!mentions) {
      const ids = [...index.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]);
      console.log('module ids present:', [...new Set(ids)].slice(0, 60));
    }
  }

  // Ask the bundle route directly. It is built from the enabled Loader entries,
  // so a 200 proves the host half loaded and registered the client bundle;
  // a 404 means the row is absent from the composed tree.
  const bundlePaths = [
    '/plugins/dsh-diy-skin/client.js',
    '/plugins/%40local%2Fdsh-diy-skin/client.js',
    '/plugins/@deepseek-ai/dsh-client-ui-theme/client.js',
  ];
  for (const p of bundlePaths) {
    const plain = await probe(BASE + p, { Accept: '*/*' });
    console.log(`${p} -> HTTP ${plain.status} (${plain.text.length} bytes)`);
    if (plain.status === 200 && plain.text.length > 1000) {
      console.log('  first 60 chars:', JSON.stringify(plain.text.slice(0, 60)));
    }
  }
})();
