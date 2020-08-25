const elasticsearch = require('@elastic/elasticsearch');
const get = require('lodash/get');
const pMap = require('p-map');

const log = require('@cumulus/common/log');

const GranuleModel = require('../models/granules');
const SCROLL_SIZE = 500; // default size in Kibana

/**
 * Return a unique list of granule IDs based on the provided list or the response from the
 * query to ES using the provided query and index.
 *
 * @param {Object} payload
 * @param {Object} [payload.query] - Optional parameter of query to send to ES
 * @param {string} [payload.index] - Optional parameter of ES index to query.
 * Must exist if payload.query exists.
 * @param {Object} [payload.ids] - Optional list of granule IDs to bulk operate on
 * @returns {Promise<Array<string>>}
 */
async function getGranuleIdsForPayload(payload) {
  const granuleIds = payload.ids || [];

  // query ElasticSearch if needed
  if (granuleIds.length === 0 && payload.query) {
    log.info('No granule ids detected. Searching for granules in Elasticsearch.');

    if (!process.env.METRICS_ES_HOST
        || !process.env.METRICS_ES_USER
        || !process.env.METRICS_ES_PASS) {
      throw new Error('ELK Metrics stack not configured');
    }

    const query = payload.query;
    const index = payload.index;
    const responseQueue = [];

    const esUrl = `https://${process.env.METRICS_ES_USER}:${
      process.env.METRICS_ES_PASS}@${process.env.METRICS_ES_HOST}`;
    const client = new elasticsearch.Client({
      node: esUrl,
    });

    const searchResponse = await client.search({
      index: index,
      scroll: '30s',
      size: SCROLL_SIZE,
      _source: ['granuleId'],
      body: query,
    });

    responseQueue.push(searchResponse);

    while (responseQueue.length) {
      const { body } = responseQueue.shift();

      body.hits.hits.forEach((hit) => {
        granuleIds.push(hit._source.granuleId);
      });
      if (body.hits.total.value !== granuleIds.length) {
        responseQueue.push(
          // eslint-disable-next-line no-await-in-loop
          await client.scroll({
            scrollId: body._scroll_id,
            scroll: '30s',
          })
        );
      }
    }
  }

  // Remove duplicate Granule IDs
  // TODO: could we get unique IDs from the query directly?
  const uniqueGranuleIds = [...new Set(granuleIds)];
  return uniqueGranuleIds;
}

function applyWorkflowToGranules(granuleIds, workflowName, queueName) {
  const granuleModelClient = new GranuleModel();

  const applyWorkflowRequests = granuleIds.map(async (granuleId) => {
    try {
      const granule = await granuleModelClient.get({ granuleId });
      await granuleModelClient.applyWorkflow(
        granule,
        workflowName,
        queueName,
        process.env.asyncOperationId
      );
      return granuleId;
    } catch (error) {
      return { granuleId, err: error };
    }
  });
  return Promise.all(applyWorkflowRequests);
}

/**
 * Bulk delete granules based on either a list of granules (IDs) or the query response from
 * ES using the provided query and index.
 *
 * @param {Object} payload
 * @param {boolean} [payload.forceRemoveFromCmr]
 *   Whether published granule should be deleted from CMR before removal
 * @param {Object} [payload.query] - Optional parameter of query to send to ES
 * @param {string} [payload.index] - Optional parameter of ES index to query.
 * Must exist if payload.query exists.
 * @param {Object} [payload.ids] - Optional list of granule IDs to bulk operate on
 * @returns {Promise}
 */
async function bulkGranuleDelete(payload) {
  const granuleIds = await getGranuleIdsForPayload(payload);
  const granuleModel = new GranuleModel();
  const forceRemoveFromCmr = payload.forceRemoveFromCmr === true;
  const deletedGranules = await pMap(
    granuleIds,
    async (granuleId) => {
      const granule = await granuleModel.getRecord({ granuleId });
      if (granule.published && forceRemoveFromCmr) {
        await granuleModel.unpublishAndDeleteGranule(granule);
      } else {
        await granuleModel.delete(granule);
      }
      return granuleId;
    },
    {
      concurrency: 10, // is this necessary?
      stopOnError: false,
    }
  );
  return { deletedGranules };
}

/**
 * Bulk apply workflow to either a list of granules (IDs) or to a list of responses from
 * ES using the provided query and index.
 *
 * @param {Object} payload
 * @param {string} payload.workflowName - name of the workflow that will be applied to each granule.
 * @param {string} [payload.queueName] - name of queue that will be used to start workflows
 * @param {Object} [payload.query] - Optional parameter of query to send to ES
 * @param {string} [payload.index] - Optional parameter of ES index to query.
 * Must exist if payload.query exists.
 * @param {Object} [payload.ids] - Optional list of granule IDs to bulk operate on
 * @returns {Promise}
 */
async function bulkGranule(payload) {
  const queueName = payload.queueName;
  const workflowName = payload.workflowName;
  const granuleIds = await getGranuleIdsForPayload(payload);
  return applyWorkflowToGranules(granuleIds, workflowName, queueName);
}

function setEnvVarsForOperation(event) {
  const envVars = get(event, 'envVars', {});
  Object.keys(envVars).forEach((envVarKey) => {
    if (!process.env[envVarKey]) {
      process.env[envVarKey] = envVars[envVarKey];
    }
  });
}

async function handler(event) {
  setEnvVarsForOperation(event);

  if (event.type === 'BULK_GRANULE') {
    return bulkGranule(event.payload);
  }
  if (event.type === 'BULK_GRANULE_DELETE') {
    return bulkGranuleDelete(event.payload);
  }
  // throw an appropriate error here
  throw new TypeError(`Type ${event.type} could not be matched, no operation attempted.`);
}

module.exports = {
  getGranuleIdsForPayload,
  handler,
};
