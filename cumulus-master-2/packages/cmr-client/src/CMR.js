'use strict';

const get = require('lodash/get');
const got = require('got');
const publicIp = require('public-ip');
const Logger = require('@cumulus/logger');
const secretsManagerUtils = require('@cumulus/aws-client/SecretsManager');

const searchConcept = require('./searchConcept');
const ingestConcept = require('./ingestConcept');
const deleteConcept = require('./deleteConcept');
const getConcept = require('./getConcept');
const getUrl = require('./getUrl');
const { ummVersion, validateUMMG } = require('./UmmUtils');

const log = new Logger({ sender: 'cmr-client' });

const logDetails = {
  file: 'cmr-client/CMR.js',
};

const IP_TIMEOUT_MS = 1 * 1000;

const userIpAddress = () =>
  publicIp.v4({ timeout: IP_TIMEOUT_MS })
    .catch((_) => '127.0.0.1');

/**
 * Returns a valid a CMR token
 *
 * @param {string} cmrProvider - the CMR provider id
 * @param {string} clientId - the CMR clientId
 * @param {string} username - CMR username
 * @param {string} password - CMR password
 * @returns {Promise.<string>} the token
 *
 * @private
 */
async function updateToken(cmrProvider, clientId, username, password) {
  // if (!cmrProvider) throw new Error('cmrProvider is required.');
  // if (!clientId) throw new Error('clientId is required.');
  // if (!username) throw new Error('username is required.');
  // if (!password) throw new Error('password is required.');

  // Update the saved ECHO token
  // for info on how to add collections to CMR: https://cmr.earthdata.nasa.gov/ingest/site/ingest_api_docs.html#validate-collection
  let response;

  try {
    response = await got.post(getUrl('token'), {
      json: true,
      body: {
        token: {
          username: username,
          password: password,
          client_id: clientId,
          user_ip_address: await userIpAddress(),
          provider: cmrProvider,
        },
      },
    });
  } catch (error) {
    if (get(error, 'response.body.errors')) {
      throw new Error(`CMR Error: ${error.response.body.errors[0]}`);
    }
    throw error;
  }

  if (!response.body.token) throw new Error('Authentication with CMR failed');

  return response.body.token.id;
}

/**
 * A class to simplify requests to the CMR
 *
 * @typicalname cmrClient
 *
 * @example
 * const { CMR } = require('@cumulus/cmr-client');
 *
 * const cmrClient = new CMR({
 *  provider: 'my-provider',
 *  clientId: 'my-clientId',
 *  username: 'my-username',
 *  password: 'my-password'
 * });
 *
 * or
 *
 * const cmrClient = new CMR({
  *  provider: 'my-provider',
  *  clientId: 'my-clientId',
  *  token: 'cmr_or_launchpad_token'
  * });
 */
class CMR {
  /**
   * The constructor for the CMR class
   *
   * @param {Object} params
   * @param {string} params.provider - the CMR provider id
   * @param {string} params.clientId - the CMR clientId
   * @param {string} params.username - CMR username, not used if token is provided
   * @param {string} params.passwordSecretName - CMR password secret, not used if token is provided
   * @param {string} params.password - CMR password, not used if token or
   *  passwordSecretName is provided
   * @param {string} params.token - CMR or Launchpad token,
   * if not provided, CMR username and password are used to get a cmr token
   */
  constructor(params = {}) {
    this.clientId = params.clientId;
    this.provider = params.provider;
    this.username = params.username;
    this.password = params.password;
    this.passwordSecretName = params.passwordSecretName;
    this.token = params.token;
  }

  /**
  * Get the CMR password, from the AWS secret if set, else return the password
  * @returns {Promise.<string>} - the CMR password
  */
  getCmrPassword() {
    if (this.passwordSecretName) {
      return secretsManagerUtils.getSecretString(
        this.passwordSecretName
      );
    }

    return this.password;
  }

  /**
   * The method for getting the token
   *
   * @returns {Promise.<string>} the token
   */
  async getToken() {
    return (this.token) ? this.token
      : updateToken(this.provider, this.clientId, this.username, await this.getCmrPassword());
  }

  /**
   * Return object containing CMR request headers for PUT / POST / DELETE
   *
   * @param {Object} params
   * @param {string} [params.token] - CMR request token
   * @param {string} [params.ummgVersion] - UMMG metadata version string or null if echo10 metadata
   * @returns {Object} CMR headers object
   */
  getWriteHeaders(params = {}) {
    const contentType = params.ummgVersion
      ? `application/vnd.nasa.cmr.umm+json;version=${params.ummgVersion}`
      : 'application/echo10+xml';

    const headers = {
      'Client-Id': this.clientId,
      'Content-type': contentType,
    };

    if (params.token) headers['Echo-Token'] = params.token;
    if (params.ummgVersion) headers.Accept = 'application/json';

    return headers;
  }

  /**
   * Return object containing CMR request headers for GETs
   *
   * @param {Object} params
   * @param {string} [params.token] - CMR request token
   * @returns {Object} CMR headers object
   */
  getReadHeaders(params = {}) {
    const headers = {
      'Client-Id': this.clientId,
    };

    if (params.token) headers['Echo-Token'] = params.token;

    return headers;
  }

  /**
   * Adds a collection record to the CMR
   *
   * @param {string} xml - the collection XML document
   * @returns {Promise.<Object>} the CMR response
   */
  async ingestCollection(xml) {
    const headers = this.getWriteHeaders({ token: await this.getToken() });
    return ingestConcept('collection', xml, 'Collection.DataSetId', this.provider, headers);
  }

  /**
   * Adds a granule record to the CMR
   *
   * @param {string} xml - the granule XML document
   * @returns {Promise.<Object>} the CMR response
   */
  async ingestGranule(xml) {
    const headers = this.getWriteHeaders({ token: await this.getToken() });
    return ingestConcept('granule', xml, 'Granule.GranuleUR', this.provider, headers);
  }

  /**
   * Adds/Updates UMMG json metadata in the CMR
   *
   * @param {Object} ummgMetadata - UMMG metadata object
   * @returns {Promise<Object>} to the CMR response object.
   */
  async ingestUMMGranule(ummgMetadata) {
    const headers = this.getWriteHeaders({
      token: await this.getToken(),
      ummgVersion: ummVersion(ummgMetadata),
    });

    const granuleId = ummgMetadata.GranuleUR || 'no GranuleId found on input metadata';
    logDetails.granuleId = granuleId;

    let response;
    try {
      await validateUMMG(ummgMetadata, granuleId, this.provider);

      response = await got.put(
        `${getUrl('ingest', this.provider)}granules/${granuleId}`,
        {
          json: true,
          body: ummgMetadata,
          headers,
        }
      );
      if (response.body.errors) {
        throw new Error(`Failed to ingest, CMR Errors: ${response.errors}`);
      }
    } catch (error) {
      log.error(error, logDetails);
      throw error;
    }

    return response.body;
  }

  /**
   * Deletes a collection record from the CMR
   *
   * @param {string} datasetID - the collection unique id
   * @returns {Promise.<Object>} the CMR response
   */
  async deleteCollection(datasetID) {
    const headers = this.getWriteHeaders({ token: await this.getToken() });
    return deleteConcept('collection', datasetID, headers);
  }

  /**
   * Deletes a granule record from the CMR
   *
   * @param {string} granuleUR - the granule unique id
   * @returns {Promise.<Object>} the CMR response
   */
  async deleteGranule(granuleUR) {
    const headers = this.getWriteHeaders({ token: await this.getToken() });
    return deleteConcept('granules', granuleUR, this.provider, headers);
  }

  async searchConcept(type, searchParams, format = 'json', recursive = true) {
    const headers = this.getReadHeaders({ token: await this.getToken() });
    return searchConcept({
      type,
      searchParams,
      previousResults: [],
      headers,
      format,
      recursive,
    });
  }

  /**
   * Search in collections
   *
   * @param {string} params - the search parameters
   * @param {string} [format=json] - format of the response
   * @returns {Promise.<Object>} the CMR response
   */
  async searchCollections(params, format = 'json') {
    const searchParams = { provider_short_name: this.provider, ...params };
    return this.searchConcept(
      'collections',
      searchParams,
      format
    );
  }

  /**
   * Search in granules
   *
   * @param {string} params - the search parameters
   * @param {string} [format='json'] - format of the response
   * @returns {Promise.<Object>} the CMR response
   */
  async searchGranules(params, format = 'json') {
    const searchParams = { provider_short_name: this.provider, ...params };
    return this.searchConcept(
      'granules',
      searchParams,
      format
    );
  }

  /**
   * Get the granule metadata from CMR using the cmrLink
   *
   * @param {string} cmrLink - URL to concept
   * @returns {Object} - metadata as a JS object, null if not found
   */
  async getGranuleMetadata(cmrLink) {
    const headers = this.getReadHeaders({ token: await this.getToken() });
    return getConcept(cmrLink, headers);
  }
}
module.exports = CMR;
