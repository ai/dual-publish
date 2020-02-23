# Dual Publish

Publish JS project as dual ES modules and CommonJS package to npm.

* Works with **Node.js**, **browsers**, and **bundlers** like webpack or Parcel.
* **No build step.** No need for separated `src/` and `dist/` dirs in repository.
  You will be able to test branch by installing version from GitHub like
  `npm i example@you/example#fix`.
* **Multiple files support**. Your user will be able to import separated files
  like `import async from 'nanoid/async'`.
* **Cleans npm package** from development configs [before publishing].

You write CommonJS in your npm library sources:

```js
// index.js
module.exports = lib
```

`npx dual-publish` compiles your library during publishing to npm:

```js
// index.js
export default lib

// index.cjs
module.exports = lib

// package.json
{
  …
  "type": "module",
  "module": "index.js",
  "main": "index.cjs"
}
```

Now your library can be imported natively as ESM or CommonJS:

```js
// CommonJS
let lib = require('lib')

// ESM in webpack, Parcel, and Rollup
import lib from 'lib'

// ESM in Node.js. We need index.js because Conditional Exports produce warning.
import lib from 'lib/index.js'

// ESM in browser
import lib from 'https://cdn.jsdelivr.net/npm/lib/index.js'
```

[before publishing]: https://github.com/shashkovdanil/clean-publish/

<a href="https://evilmartians.com/?utm_source=dual-publish">
  <img src="https://evilmartians.com/badges/sponsored-by-evil-martians.svg"
      alt="Sponsored by Evil Martians" width="236" height="54">
</a>

## Limits

* Node.js ESM users should manually add `index.mjs` to import, because
  [Conditional Exports] print warning.
* Only default export is supported right now, since CommonJS doesn’t support
  combining default and named exports.
* Every JS file should be in separated dir. `lib/index.js` instead of `lib.js`.
  We need it to put `package.json` with `module`.

[Conditional Exports]: https://nodejs.org/api/esm.html#esm_conditional_exports


## Usage

1. Take a normal CommonJS project with `require()` and `module.exports =`.
2. Move all files into separated dirs. Like rename `lib.js` to `lib/index.js`.
   Old `require('./lib')` will work.
3. Add `dual-publish` to the project:

   ```sh
   npm i --save-dev dual-publish
   ```
4. Add instruction for Node.js ESM users to manually add `index.mjs` in imports.
   You can copy them from
   [NanoEvents](https://github.com/ai/nanoevents/#es-modules).
5. Test the result by calling `npx dual-publish --without-publish`.
   It will create a folder in your project with converted files.
   Review them manually.
6. Publish your project with `npx dual-publish` instead of `npm publish`.

   ```sh
   npx dual-publish
   ```
