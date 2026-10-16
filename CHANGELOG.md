# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - Unreleased

### Added
- Initial release of datastar-attribute-newest-frame, from lith's `live/newest-frame.js` (lith v0.3.0), in TypeScript
- `data-newest-frame` holds the patch events of the stream that `#stream` opened (`data-newest-frame:<id>` names another) and applies only the newest frame of each view among those that arrived together
- Batches per chunk, at most one per animation frame, and after each batch a pause of half the time it took to apply
- Signal patches, appends, removes, scripts and view transitions keep their order and are never dropped; events of a detached stream element are dropped
- The `newest-frame-behind` event on the stream's element when more than half of the last 3 s of frames were skipped (at least 10), with `id`, `frames`, `skipped`, `span` and `reopen` in its detail
- `__reopen`: lith's behaviour, which sets `$_slow` and opens the stream again from a copy of its element, once
- Interactive demo with a Game of Life streamed by a Service Worker through Datastar's own fetch, and the measurements from lith

[1.0.0]: https://github.com/mbolli/datastar-attribute-newest-frame/releases/tag/v1.0.0
