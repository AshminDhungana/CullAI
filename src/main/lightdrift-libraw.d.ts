// Ambient type shim for lightdrift-libraw.
declare module 'lightdrift-libraw' {
  import LibRaw = require('libraw');
  export = LibRaw;
}