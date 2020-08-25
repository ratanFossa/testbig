# @cumulus/common

Common libraries used in Cumulus.

## Usage

```bash
  npm install @cumulus/common
```

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## General Utilities

* [@cumulus/common/aws](./aws.js) - Utilities for working with AWS. For ease of
  setup, testing, and credential management, code should obtain AWS client
  objects from helpers in this module.
* [@cumulus/common/concurrency](./concurrency.js) - Utilities for writing concurrent code
* [@cumulus/common/errors](./errors.js) - Classes for thrown errors
* [@cumulus/common/log](./log.js) - muting or potentially shipping logs to
  alternative locations
* [@cumulus/common/string](./docs/API.md#module_string) - Utilities for
  manipulating strings
* [@cumulus/common/test-utils](./test-utils.js) - Utilities for writing tests
* [@cumulus/common/URLUtils](./docs/API.md#module_URLUtils) - a collection of
  utilities for working with URLs
* [@cumulus/common/util](./docs/API.md#module_util) - Other misc general
  utilities

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
