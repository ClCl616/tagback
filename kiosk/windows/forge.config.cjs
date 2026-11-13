const path = require('node:path');
module.exports = {
  packagerConfig: {
    asar: true,
    executableName: 'TagBackKiosk',
    extraResource: [path.join(__dirname, 'resources')],
    ignore: [/^\/resources($|\/)/, /^\/out($|\/)/, /^\/test($|\/)/, /^\/scripts($|\/)/],
  },
  makers: [{ name: '@electron-forge/maker-squirrel', config: {
    name: 'TagBackKiosk', setupExe: `TagBackKiosk-${require('./package.json').version}-trial-Setup.exe`,
    noMsi: true,
  } }],
};
