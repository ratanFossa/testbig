/* functions for transforming and indexing Cumulus Payloads
 * in ElasticSearch. These functions are specifically designed
 * to transform data for use in cumulus api
 *
 * The module accepts the following kinds of workflows (state machines):
 * - ParsePdrs
 * - IngestGranules
 * - StateMachine (if a payload doesn't belong to previous ones)
 */

'use strict';

const cloneDeep = require('lodash/cloneDeep');
const isString = require('lodash/isString');
const zlib = require('zlib');
const { constructCollectionId } = require('@cumulus/message/Collections');
const log = require('@cumulus/common/log');
const { inTestMode } = require('@cumulus/common/test-utils');

const { convertLogLevel } = require('./logUtils');
const { Search, defaultIndexAlias } = require('./search');
const { Granule } = require('../models');
const { IndexExistsError } = require('../lib/errors');
const mappings = require('../models/mappings.json');

async function createIndex(esClient, indexName) {
  const indexExists = await esClient.indices.exists({ index: indexName })
    .then((response) => response.body);

  if (indexExists) {
    throw new IndexExistsError(`Index ${indexName} exists and cannot be created.`);
  }

  await esClient.indices.create({
    index: indexName,
    body: {
      mappings,
      settings: {
        index: {
          number_of_shards: process.env.ES_INDEX_SHARDS || 1,
        },
      },
    },
  });

  log.info(`Created esIndex ${indexName}`);
}

/**
 * Determine if log message parts come from a Cumulus log.
 *
 * @param {Array<string>} messageParts - Array of message parts
 * @param {number} messageStartIndex - Start index of log message in message string
 * @returns {boolean}
 */
const isCumulusLogMessage = (messageParts, messageStartIndex) =>
  messageParts.length >= 3
  && messageStartIndex
  && messageParts[messageParts.length - 1].endsWith('}');

/**
 * Parse Cumulus log from message parts
 *
 * @param {Array<string>} messageParts - Array of message parts
 * @param {number} messageStartIndex - Start index of log message in message string
 * @returns {Object} - Cumulus log record
 */
const parseCumulusLogMessage = (messageParts, messageStartIndex) => {
  const record = JSON.parse(messageParts.slice(messageStartIndex).join('\t'));
  record.RequestId = messageParts[1];
  return record;
};

/**
 * Parses a StepFunction log payload  and returns a es logsrecord object
 *
 * @param {Object} payload - Stepfunction log payload
 * @returns {Object} - ElasticSearch log record
 */
function parsePayload(payload) {
  let record;
  try {
    // cumulus log message has extra aws messages before the json message,
    // only the json message should be logged to elasticsearch.
    // example message:
    // 2018-06-0 1T17:45:27.108Z a714a0ef-f141-4e52-9661-58ca2233959a
    // {"level": "info", "timestamp": "2018-06-01T17:45:27.108Z",
    // "message": "uploaded s3://bucket/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met"}
    const entryParts = payload.message.trim().split('\t');
    // cumulus log message
    const messageStartIndex = entryParts.findIndex((e) => e.startsWith('{'));
    if (isCumulusLogMessage(entryParts, messageStartIndex)) {
      record = parseCumulusLogMessage(entryParts, messageStartIndex);
    } else { // other logs e.g. cumulus-ecs-task
      record = JSON.parse(payload.message);
    }
    // level is number in elasticsearch
    if (isString(record.level)) record.level = convertLogLevel(record.level);
  } catch (error) {
    record = {
      message: payload.message.trim(),
      sender: payload.sender,
      executions: payload.executions,
      timestamp: payload.timestamp,
      version: payload.version,
      level: 30,
      pid: 1,
      name: 'cumulus',
    };
  }
  return record;
}

/**
 * Extracts info from a stepFunction message and indexes it to
 * an ElasticSearch
 *
 * @param  {Object} esClient - ElasticSearch Connection object
 * @param  {Array} payloads  - an array of log payloads
 * @param  {string} index    - Elasticsearch index alias (default defined in search.js)
 * @param  {string} type     - Elasticsearch type (default: granule)
 * @returns {Promise} Elasticsearch response
 */
async function indexLog(esClient, payloads, index = defaultIndexAlias, type = 'logs') {
  const body = [];

  payloads.forEach((payload) => {
    body.push({ index: { _index: index, _type: type, _id: payload.id } });
    const parsedPayload = parsePayload(payload);
    body.push(parsedPayload);
  });

  const actualEsClient = esClient || (await Search.es());
  const bulkResponse = await actualEsClient.bulk({ body: body });
  return bulkResponse.body;
}

/**
 * Indexes a given record to the specified ElasticSearch index and type
 *
 * @param  {Object} esClient - ElasticSearch Connection object
 * @param  {string} id       - the record id
 * @param  {Object} doc      - the record
 * @param  {string} index    - Elasticsearch index alias
 * @param  {string} type     - Elasticsearch type
 * @param  {string} parent   - the optional parent id
 * @returns {Promise} Elasticsearch response
 */
async function genericRecordUpdate(esClient, id, doc, index, type, parent) {
  if (!doc) throw new Error('Nothing to update. Make sure doc argument has a value');

  const body = cloneDeep(doc);
  body.timestamp = Date.now();

  const params = {
    body,
    id,
    index,
    type,
    refresh: inTestMode(),
  };

  if (parent) params.parent = parent;

  // adding or replacing record to ES
  const actualEsClient = esClient || (await Search.es());
  const indexResponse = await actualEsClient.index(params);
  return indexResponse.body;
}

/**
 * Indexes a step function message to Elastic Search. The message must
 * comply with the cumulus message protocol
 *
 * @param  {Object} esClient - ElasticSearch Connection object
 * @param  {Object} payload  - Cumulus Step Function message
 * @param  {string} index    - Elasticsearch index alias (default defined in search.js)
 * @param  {string} type     - Elasticsearch type (default: execution)
 * @returns {Promise} elasticsearch update response
 */
function indexExecution(esClient, payload, index = defaultIndexAlias, type = 'execution') {
  return genericRecordUpdate(esClient, payload.arn, payload, index, type);
}

/**
 * Indexes the asyncOperation type on ElasticSearch
 *
 * @param  {Object} esClient - ElasticSearch Connection object
 * @param  {Object} payload  - Cumulus Step Function message
 * @param  {string} index    - Elasticsearch index alias (default defined in search.js)
 * @param  {string} type     - Elasticsearch type (default: asyncOperation)
 * @returns {Promise} elasticsearch update response
 */
function indexAsyncOperation(esClient, payload, index = defaultIndexAlias, type = 'asyncOperation') {
  return genericRecordUpdate(esClient, payload.id, payload, index, type);
}

/**
 * Indexes the collection on ElasticSearch
 *
 * @param  {Object} esClient - ElasticSearch Connection object
 * @param  {Object} meta     - the collection record
 * @param  {string} index    - Elasticsearch index alias (default defined in search.js)
 * @param  {string} type     - Elasticsearch type (default: collection)
 * @returns {Promise} Elasticsearch response
 */
function indexCollection(esClient, meta, index = defaultIndexAlias, type = 'collection') {
  const collectionId = constructCollectionId(meta.name, meta.version);
  return genericRecordUpdate(esClient, collectionId, meta, index, type);
}

/**
 * Indexes the provider type on ElasticSearch
 *
 * @param  {Object} esClient - ElasticSearch Connection object
 * @param  {Object} payload  - the provider record
 * @param  {string} index    - Elasticsearch index alias (default defined in search.js)
 * @param  {string} type     - Elasticsearch type (default: provider)
 * @returns {Promise} Elasticsearch response
 */
function indexProvider(esClient, payload, index = defaultIndexAlias, type = 'provider') {
  return genericRecordUpdate(esClient, payload.id, payload, index, type);
}

/**
 * Indexes the reconciliationReport type on ElasticSearch
 *
 * @param  {Object} esClient - ElasticSearch Connection object
 * @param  {Object} payload  - the ReconciliationReport record
 * @param  {string} index    - Elasticsearch index alias (default defined in search.js)
 * @param  {string} type     - Elasticsearch type (default: reconciliationReport)
 * @returns {Promise} Elasticsearch response
 */
function indexReconciliationReport(esClient, payload, index = defaultIndexAlias, type = 'reconciliationReport') {
  return genericRecordUpdate(esClient, payload.name, payload, index, type);
}

/**
 * Indexes the rule type on ElasticSearch
 *
 * @param  {Object} esClient - ElasticSearch Connection object
 * @param  {Object} payload  - the Rule record
 * @param  {string} index    - Elasticsearch index alias (default defined in search.js)
 * @param  {string} type     - Elasticsearch type (default: rule)
 * @returns {Promise} Elasticsearch response
 */

function indexRule(esClient, payload, index = defaultIndexAlias, type = 'rule') {
  return genericRecordUpdate(esClient, payload.name, payload, index, type);
}

/**
 * Indexes the granule type on ElasticSearch
 *
 * @param  {Object} esClient - ElasticSearch Connection object
 * @param  {Object} payload  - Cumulus Step Function message
 * @param  {string} index    - Elasticsearch index alias (default defined in search.js)
 * @param  {string} type     - Elasticsearch type (default: granule)
 * @returns {Promise} Elasticsearch response
 */
async function indexGranule(esClient, payload, index = defaultIndexAlias, type = 'granule') {
  // If the granule exists in 'deletedgranule', delete it first before inserting the granule
  // into ES.  Ignore 404 error, so the deletion still succeeds if the record doesn't exist.
  const delGranParams = {
    index,
    type: 'deletedgranule',
    id: payload.granuleId,
    parent: payload.collectionId,
    refresh: inTestMode(),
  };
  await esClient.delete(delGranParams, { ignore: [404] });

  return genericRecordUpdate(
    esClient,
    payload.granuleId,
    payload,
    index,
    type,
    payload.collectionId
  );
}

/**
 * Indexes the pdr type on ElasticSearch
 *
 * @param  {Object} esClient - ElasticSearch Connection object
 * @param  {Object} payload  - Cumulus Step Function message
 * @param  {string} index    - Elasticsearch index alias (default defined in search.js)
 * @param  {string} type     - Elasticsearch type (default: pdr)
 * @returns {Promise} Elasticsearch response
 */
async function indexPdr(esClient, payload, index = defaultIndexAlias, type = 'pdr') {
  return genericRecordUpdate(
    esClient,
    payload.pdrName,
    payload,
    index,
    type
  );
}

/**
 * delete a record from ElasticSearch
 *
 * @param  {Object} params
 * @param  {Object} params.esClient - ElasticSearch Connection object
 * @param  {string} params.id       - id of the Elasticsearch record
 * @param  {string} params.type     - Elasticsearch type (default: execution)
 * @param  {strint} params.parent   - id of the parent (optional)
 * @param  {string} params.index    - Elasticsearch index (default: cumulus)
 * @param  {Array}  params.ignore   - Response codes to ignore (optional)
 * @returns {Promise} elasticsearch delete response
 */
async function deleteRecord({
  esClient,
  id,
  type,
  parent,
  index = defaultIndexAlias,
  ignore,
}) {
  const params = {
    index,
    type,
    id,
    refresh: inTestMode(),
  };

  let options = {};

  if (parent) params.parent = parent;
  if (ignore) options = { ignore };

  const actualEsClient = esClient || (await Search.es());

  const getResponse = await actualEsClient.get(params, options);
  const deleteResponse = await actualEsClient.delete(params, options);

  if (type === 'granule' && getResponse.body.found) {
    const doc = getResponse.body._source;
    doc.timestamp = Date.now();
    doc.deletedAt = Date.now();

    // When a 'granule' record is deleted, the record is added to 'deletedgranule'
    // type for EMS report purpose.
    await genericRecordUpdate(
      actualEsClient,
      doc.granuleId,
      doc,
      index,
      'deletedgranule',
      parent
    );
  }
  return deleteResponse.body;
}

/**
 * start the re-ingest of a given granule object
 *
 * @param  {Object} g - the granule object
 * @returns {Promise} an object showing the start of the re-ingest
 */
async function reingest(g) {
  const gObj = new Granule();
  return gObj.reingest(g);
}

/**
 * processes the incoming log events coming from AWS
 * CloudWatch
 *
 * @param  {Object} event - incoming message from CloudWatch
 * @param  {Object} context - aws lambda context object
 * @param  {function} cb - aws lambda callback function
 */
function logHandler(event, context, cb) {
  log.debug(event);
  const payload = Buffer.from(event.awslogs.data, 'base64');
  zlib.gunzip(payload, (e, r) => {
    try {
      const logs = JSON.parse(r.toString());
      log.debug(logs);
      return indexLog(undefined, logs.logEvents)
        .then((s) => cb(undefined, s))
        .catch(cb);
    } catch (error) {
      log.error(e);
      return cb();
    }
  });
}

/**
 * Index a record to local Elasticsearch. Used when running API locally.
 *
 * @param {Object} record - Record object
 * @param {function} doIndex - Function to do indexing operation
 * @returns {Promise} - Promise of indexing operation
 */
async function addToLocalES(record, doIndex) {
  const esClient = await Search.es(process.env.ES_HOST);
  return doIndex(esClient, record, process.env.ES_INDEX);
}

module.exports = {
  addToLocalES,
  createIndex,
  logHandler,
  indexCollection,
  indexLog,
  indexProvider,
  indexReconciliationReport,
  indexRule,
  indexGranule,
  indexPdr,
  indexExecution,
  indexAsyncOperation,
  deleteRecord,
  reingest,
};
