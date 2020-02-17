# Dual Publish

Publish JS project as dual ES modules and CommonJS package to npm.

* Works with **Node.js**, **browsers**, and **bundlers** like webpack or Parcel.
* **No build step.** No need for separated `src/` and `dist/` dirs in repository.
  You will be able to test branch by installing version from GitHub like
  `npm i example@you/example#fix`.
* **Multiple files support**. Your user will be able to import separated files
  like `import async from 'nanoid/async'`.
* **Cleans npm package** from development configs [before publishing].

[before publishing]: https://github.com/shashkovdanil/clean-publish/

<a href="https://evilmartians.com/?utm_source=dual-publish">
  <img src="https://evilmartians.com/badges/sponsored-by-evil-martians.svg"
      alt="Sponsored by Evil Martians" width="236" height="54">
</a>
