'use strict';

/**
 * Utilities for storing and retrieving collection config in S3
 *
 * @module collection-config-store
 */

const { deprecate } = require('@cumulus/common/util');
const {
  deleteS3Object,
  getJsonS3Object,
  putJsonS3Object,
} = require('@cumulus/aws-client/S3');
const { constructCollectionId } = require('@cumulus/message/Collections');

/**
 * @class
 * @classdesc Store and retrieve collection configs in S3
 *
 * @example
 * const CollectionConfigStore = require('@cumulus/collection-config-store');
 *
 * const collectionConfigStore = new CollectionConfigStore(
 *   'system-bucket',
 *   'stack-name'
 * );
 *
 * @alias module:collection-config-store
 */
class CollectionConfigStore {
  /**
   * Initialize a CollectionConfigStore instance
   *
   * @param {string} bucket - the bucket where collection configs are stored
   * @param {string} stackName - the Cumulus deployment stack name
   */
  constructor(bucket, stackName) {
    deprecate(
      '@cumulus/collection-config-store',
      '1.23.2',
      '@cumulus/api-client/collections.getCollection()'
    );

    this.bucket = bucket;
    this.stackName = stackName;
    this.cache = {};
  }

  /**
   * Fetch a collection config from S3 (or cache if available)
   *
   * @param {string} name - the name of the collection config to fetch
   * @param {string} version - the version of the collection config to fetch
   * @returns {Promise<Object>} the fetched collection config
   *
   * @async
   */
  async get(name, version) {
    const collectionId = constructCollectionId(name, version);

    // Check to see if the collection config has already been cached
    if (!this.cache[collectionId]) {
      let collectionConfig;
      try {
        // Attempt to fetch the collection config from S3
        collectionConfig = await getJsonS3Object(this.bucket, this.configKey(collectionId));
      } catch (error) {
        if (error.code === 'NoSuchKey') {
          throw new Error(`A collection config for data type "${collectionId}" was not found.`);
        }

        if (error.code === 'NoSuchBucket') {
          throw new Error(`Collection config bucket does not exist: ${this.bucket}`);
        }

        throw error;
      }

      // Store the fetched collection config to the cache
      this.cache[collectionId] = collectionConfig;
    }

    return this.cache[collectionId];
  }

  /**
   * Store a collection config to S3
   *
   * @param {string} name - the name of the collection config to store
   * @param {string} version - version of Collection
   * @param {Object} config - the collection config to store
   * @returns {Promise<null>} resolves when the collection config has been written
   *   to S3
   *
   * @async
   */
  async put(name, version, config) {
    const collectionId = constructCollectionId(name, version);

    this.cache[collectionId] = config;

    return putJsonS3Object(
      this.bucket,
      this.configKey(collectionId),
      config
    ).then(() => null); // Don't leak implementation details to the caller
  }

  /**
   * Delete a collection config from S3
   *
   * @param {string} name - the name of the collection config to delete
   * @param {string} version - version of Collection
   * @returns {Promise<null>} resolves when the collection config has been deleted
   *   to S3
   *
   * @async
   */
  async delete(name, version) {
    const collectionId = constructCollectionId(name, version);

    await deleteS3Object(this.bucket, this.configKey(collectionId));

    delete this.cache[collectionId];
  }

  /**
   * Return the S3 key pointing to the collection config
   *
   * @param {string} collectionId - the name and version
   * @returns {string} the S3 key where the collection config is located
   *
   * @private
   */
  configKey(collectionId) {
    return `${this.stackName}/collections/${collectionId}.json`;
  }
}

module.exports = CollectionConfigStore;
