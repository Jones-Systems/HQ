'use strict';

require('./tools/updater/bootstrap.cjs').run({
  app: require('electron').app,
  importMain: () => import('./apps/desktop/dist-electron/main.js'),
}).catch(() => {
  process.stderr.write('HQ could not safely start. Inspect the installation recovery status.\n');
  require('electron').app.exit(1);
});
