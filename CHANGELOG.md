# Changelog

## [2.2.4](https://github.com/postalsys/postal-mime/compare/v2.2.3...v2.2.4) (2024-04-11)


### Bug Fixes

* **exports:** Export addressParser and decodeWords functions ([43d3187](https://github.com/postalsys/postal-mime/commit/43d31873308d8eff61876f32614e5cc5143c90dd))

## [2.2.3](https://github.com/postalsys/postal-mime/compare/v2.2.2...v2.2.3) (2024-04-11)


### Bug Fixes

* **attachments:** Added description key from Content-Description attachment header ([6e29de9](https://github.com/postalsys/postal-mime/commit/6e29de97a4dc0043587a59870d52250602801e3c))
* **calendar-attachments:** treat text/calendar as an attachment ([2196b49](https://github.com/postalsys/postal-mime/commit/2196b497f289697e9dc72011708e4355ee7362cc))

## [2.2.2](https://github.com/postalsys/postal-mime/compare/v2.2.1...v2.2.2) (2024-04-10)


### Bug Fixes

* **parse:** Do not throw on empty input when initializing an array buffer object ([ddae5b4](https://github.com/postalsys/postal-mime/commit/ddae5b40d44eaebbfc9117609259a204f27ed4cf))

## [2.2.1](https://github.com/postalsys/postal-mime/compare/v2.2.0...v2.2.1) (2024-03-31)


### Bug Fixes

* **parser:** Reply-To value must be an array, not a single address object ([280bd8d](https://github.com/postalsys/postal-mime/commit/280bd8dc1626315e1a43f35641415453c434716e))

## [2.2.0](https://github.com/postalsys/postal-mime/compare/v2.1.2...v2.2.0) (2024-03-26)


### Features

* **interface:** Added statis parse() method to simplify usage (`await PostalMime.parse(email)`) ([c2faa27](https://github.com/postalsys/postal-mime/commit/c2faa276520d6551df640abe008986eebc6d99d3))

## [2.1.2](https://github.com/postalsys/postal-mime/compare/v2.1.1...v2.1.2) (2024-02-29)


### Bug Fixes

* **git:** re-renamed git repo ([29d235e](https://github.com/postalsys/postal-mime/commit/29d235ece222844dc59858d9e991cc85f65733e2))
* **git:** Renamed git repository ([829e537](https://github.com/postalsys/postal-mime/commit/829e5371602f87fe114d87130c6e9953d50872b4))

## [2.1.1](https://github.com/postalsys/postal-mime/compare/v2.1.0...v2.1.1) (2024-02-26)


### Bug Fixes

* **types:** Updated types for PostalMime ([bc90f6d](https://github.com/postalsys/postal-mime/commit/bc90f6d5b7d3e2475cece77bb094caf421dead97))

## [2.1.0](https://github.com/postalsys/postal-mime/compare/v2.0.2...v2.1.0) (2024-02-22)


### Features

* **workers:** Support Cloudflare Email Workers out of the box ([4904708](https://github.com/postalsys/postal-mime/commit/49047089bf779931dacb4a7b31816b48d1b00840))


### Bug Fixes

* **module:** add types to module exports ([#23](https://github.com/postalsys/postal-mime/issues/23)) ([1ee4a42](https://github.com/postalsys/postal-mime/commit/1ee4a427643d71f6a4bda0db0ebe0b5b280e52ae))

## [2.0.2](https://github.com/postalsys/postal-mime/compare/v2.0.1...v2.0.2) (2023-12-08)


### Bug Fixes

* **test:** Added a tests runner and some tests ([8c6f7fb](https://github.com/postalsys/postal-mime/commit/8c6f7fb495b0158756fc11482a717e8081cede86))
* **test:** Added test action ([c43c086](https://github.com/postalsys/postal-mime/commit/c43c0865dae74a7f20e32885a5860d8654f0c932))

## [2.0.1](https://github.com/postalsys/postal-mime/compare/v2.0.0...v2.0.1) (2023-11-05)


### Bug Fixes

* **npm:** DO not ignore src folder when publishing to npm ([ef8a2df](https://github.com/postalsys/postal-mime/commit/ef8a2df8d65be3dcfc52784c5c73c79f820c1c82))

## [2.0.0](https://github.com/postalsys/postal-mime/compare/v1.1.0...v2.0.0) (2023-11-03)


### ⚠ BREAKING CHANGES

* **module:** Use as an ES module, do not build with webpack

### Features

* **module:** Use as an ES module, do not build with webpack ([70df152](https://github.com/postalsys/postal-mime/commit/70df152ed66346d1f0ca821a9caeb819255bea89))

## [1.1.0](https://github.com/postalsys/postal-mime/compare/v1.0.16...v1.1.0) (2023-11-02)


### Features

* **deploy:** automatic publishing ([64f9a81](https://github.com/postalsys/postal-mime/commit/64f9a814414ff4a6f3e33c23a5c4821ab0099c5f))
* **license:** changed license from AGPL to MIT-0 ([d0ca0dc](https://github.com/postalsys/postal-mime/commit/d0ca0dce40315ae63d8ebd6420c0d1467baac01e))


### Bug Fixes

* **ts:** Update postal-mime.d.ts ([#13](https://github.com/postalsys/postal-mime/issues/13)) ([6cee404](https://github.com/postalsys/postal-mime/commit/6cee40477c711959f94def4c33baf4330a6a249f))
