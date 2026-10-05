# Third-party notices

The production extension includes these locally bundled dependencies:

- **NSFWJS 4.3.0** and its MobileNetV2Mid model assets — MIT License. Copyright Infinite Red, Inc. Source: <https://github.com/infinitered/nsfwjs>
- **TensorFlow.js 4.22.0** — Apache License 2.0. Copyright The TensorFlow Authors. Source: <https://github.com/tensorflow/tfjs>
- **TensorFlow.js WebAssembly backend 4.22.0** (`@tensorflow/tfjs-backend-wasm`, including its prebuilt `.wasm` binaries, which incorporate XNNPACK under the BSD 3-Clause License) — Apache License 2.0. Copyright The TensorFlow Authors. Source: <https://github.com/tensorflow/tfjs/tree/master/tfjs-backend-wasm>

The complete corresponding license texts are available in each dependency's npm package and upstream repository. No dependency is loaded remotely at runtime.

## Replacement paintings

The paintings in `assets/sacred-art/` cover hidden media when the sacred-art option is on. Each comes from a museum open-access program that dedicates its images to the public domain:

- **The Metropolitan Museum of Art**, Open Access (public domain, CC0). <https://www.metmuseum.org/about-the-met/policies-and-documents/open-access>
- **The Cleveland Museum of Art**, Open Access (CC0). <https://www.clevelandart.org/open-access>
- **National Gallery of Art, Washington**, Open Access (CC0). <https://www.nga.gov/artworks/free-images-and-open-access>
- **The Art Institute of Chicago**, public-domain works (CC0). <https://www.artic.edu/open-access/open-access-images>

`assets/sacred-art/CREDITS.json` lists every painting's title, artist, date, museum, and object page; the painting viewer shows the same credit. The packaged copies are re-encoded at a lower JPEG quality; the images are otherwise unchanged.

## Adult-domain data

The compressed data in `data/adult-domains.txt.gz` is derived from [The Block List Project pornography list](https://github.com/blocklistproject/Lists), released under the **Unlicense**. Its complete license is included in `data/ADULT_LIST_LICENSE.txt`. `data/adult-list.json` records the exact source revision, source URL, SHA-256 hashes, entry counts, and exclusions. Changes: validate domain syntax, exclude selected mixed-content parent domains and public suffixes, deduplicate, remove redundant children, sort, and gzip. This list is bundled; it is not fetched remotely while browsing.
