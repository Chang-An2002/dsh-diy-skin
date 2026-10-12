// Verify the plugin still resolves the way the Loader resolves it: by bare name
// from the *profile* directory, through the profile's node_modules -> junction
// -> workspace package, honouring `exports`.
//
// Resolution is anchored on the profile manifest rather than this file's own
// location, because the whole point is what the profile can see.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const PROFILE = process.argv[2] ?? 'C:/Users/pipi0/.dsh/profiles/desktop';
const NAME = 'dsh-diy-skin';

const require = createRequire(PROFILE + '/package.json');
const resolved = require.resolve(NAME);
console.log('resolved  :', resolved);

const manifest = require(resolved.replace(/index\.js$/, 'package.json'));
console.log('version   :', manifest.version);
console.log('bundle    :', manifest.dsh?.bundle?.patch);
console.log('client    :', JSON.stringify(manifest.dsh?.client));

const mod = await import(pathToFileURL(resolved).href);
console.log('exports   :', Object.keys(mod).join(', '), '| apply is', typeof mod.apply);

// The browser half must be reachable through the `./client` subpath too, since
// that is what client-modules reads.
const clientPath = require.resolve(NAME + '/client');
console.log('./client  :', clientPath);
console.log('size      :', require('node:fs').statSync(clientPath).size, 'bytes');
