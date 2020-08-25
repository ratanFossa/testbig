'use strict';

const get = require('lodash/get');

const kinesisUtils = require('@cumulus/aws-client/Kinesis');
const awsServices = require('@cumulus/aws-client/services');
const log = require('@cumulus/common/log');

const messageConsumer = require('./message-consumer');

const Kinesis = awsServices.kinesis();
const tallyReducer = (acc, cur) => acc + cur;

/**
 * This function will accept as valid input an event whose `endTimestamp` and `startTimestamp`
 * fields must contain valid input to the `new Date()` constructor if they exist.
 * They will then be populated into `process.env` as ISO strings.
 *
 * @param {Object} event - input object
 */
const configureTimestampEnvs = (event) => {
  if (!process.env.endTimestamp && event.endTimestamp) {
    const dateObj = new Date(event.endTimestamp);
    if (Number.isNaN(dateObj.valueOf())) {
      throw new TypeError(`endTimestamp ${event.endTimestamp} is not a valid input for new Date().`);
    }
    process.env.endTimestamp = dateObj.toISOString();
  }
  if (!process.env.startTimestamp && event.startTimestamp) {
    const dateObj = new Date(event.startTimestamp);
    if (Number.isNaN(dateObj.valueOf())) {
      throw new TypeError(`startTimestamp ${event.startTimestamp} is not a valid input for new Date().`);
    }
    process.env.startTimestamp = dateObj.toISOString();
  }
};

/**
 * Set up params object for call to `Kinesis.getShardIterator()`.
 * Creates timestamp params if `process.env.startTimestamp` is set.
 *
 * @param {string} stream - stream name
 * @param {string} shardId - shard ID
 * @returns {Object} `getShardIterator` params object
 */
const setupIteratorParams = (stream, shardId) => {
  const params = {
    StreamName: stream,
    ShardId: shardId,
  };
  if (process.env.startTimestamp) {
    params.ShardIteratorType = 'AT_TIMESTAMP';
    params.Timestamp = process.env.startTimestamp;
  } else {
    params.ShardIteratorType = 'TRIM_HORIZON';
  }
  return params;
};

/**
 * Set up params object for call to `Kinesis.listShards()`.
 * `streamCreationTimestamp` is required when multiple streams with the same
 * name exist in the Kinesis API (e.g. deleted and current streams).
 *
 * @param {string} stream - kinesis stream name
 * @param {Date|string|number} [streamCreationTimestamp] - Stream creation timestamp
 * used to differentiate streams that have a name used by a previous stream.
 * @returns {Object} `listShards` params object
 */
const setupListShardParams = (stream, streamCreationTimestamp) => {
  const params = {
    StreamName: stream,
  };
  if (streamCreationTimestamp) params.StreamCreationTimestamp = new Date(streamCreationTimestamp);
  return params;
};

/**
 * Process a batch of kinesis records.
 *
 * @param {string} streamArn - Kinesis stream ARN
 * @param {Array<Object>} records - list of kinesis records
 * @returns {number} number of records successfully processed
 */
async function processRecordBatch(streamArn, records) {
  const results = await Promise.all(records.map(async (record) => {
    if (new Date(record.ApproximateArrivalTimestamp) > new Date(process.env.endTimestamp)) {
      return 'skip';
    }
    try {
      await messageConsumer.processRecord(
        {
          kinesis: { data: record.Data },
          eventSourceARN: streamArn,
        },
        false
      );
      return 'ok';
    } catch (error) {
      log.error(error);
      return 'err';
    }
  }));
  const { skip, err, ok } = results.reduce((acc, cur) => {
    acc[cur] += 1;
    return acc;
  }, { skip: 0, err: 0, ok: 0 });
  if (skip > 0) {
    log.info(
      `Skipped ${skip} of ${records.length} records in batch for arriving after endTimestamp`
    );
  }
  if (err > 0) {
    log.warn(`Failed to process ${err} of ${records.length} records in batch`);
  }
  return ok;
}

/**
 * Recursively process all records within a shard between start and end timestamps.
 * Starts at beginning of shard (TRIM_HORIZON) if no start timestamp is available.
 *
 * @param {string} streamArn - Kinesis stream ARN
 * @param {Array<Promise>} recordPromiseList - list of promises from calls to processRecordBatch
 * @param {string} shardIterator - ShardIterator Id
 * @returns {Promise<Array<Promise>>} list of promises from calls to processRecordBatch
 */
async function iterateOverShardRecursively(streamArn, recordPromiseList, shardIterator) {
  try {
    const response = await Kinesis.getRecords({
      ShardIterator: shardIterator,
    }).promise();
    recordPromiseList.push(processRecordBatch(streamArn, response.Records));
    if (response.MillisBehindLatest === 0 || !response.NextShardIterator) return recordPromiseList;
    const nextShardIterator = response.NextShardIterator;
    return iterateOverShardRecursively(streamArn, recordPromiseList, nextShardIterator);
  } catch (error) {
    log.error(error);
    return recordPromiseList;
  }
}

/**
 * Handle shard by creating shardIterator and calling processShard.
 *
 * @param {string} streamName - kinesis stream name
 * @param {string} streamArn - Kinesis stream ARN
 * @param {string} shardId - shard ID
 * @returns {number} number of records successfully processed from shard
 */
async function processShard(streamName, streamArn, shardId) {
  const iteratorParams = setupIteratorParams(streamName, shardId);
  try {
    const shardIterator = (
      await Kinesis.getShardIterator(iteratorParams).promise()
    ).ShardIterator;
    const tallyList = await Promise.all(
      await iterateOverShardRecursively(streamArn, [], shardIterator)
    );
    const shardTally = tallyList.reduce(tallyReducer, 0);
    return shardTally;
  } catch (error) {
    log.error(error);
    return 0;
  }
}

/**
 * Recursively fetch all records within a kinesis stream and process them through
 * message-consumer's processRecord function.
 *
 * @param {string} streamName - Kinesis stream name
 * @param {string} streamArn - Kinesis stream ARN
 * @param {Array<Promise>} shardPromiseList - list of promises from calls to processShard
 * @param {Object} params - listShards query params
 * @returns {Array<Promise>} list of promises from calls to processShard
 */
async function iterateOverStreamRecursivelyToDispatchShards(
  streamName,
  streamArn,
  shardPromiseList,
  params
) {
  const listShardsResponse = (await Kinesis.listShards(params).promise().catch(log.error));
  if (!listShardsResponse || !listShardsResponse.Shards || listShardsResponse.Shards.length === 0) {
    log.error(`No shards found for params ${JSON.stringify(params)}.`);
    return shardPromiseList;
  }
  log.info(`Processing records from ${listShardsResponse.Shards.length} shards..`);
  const shardCalls = listShardsResponse.Shards.map(
    (shard) => processShard(streamName, streamArn, shard.ShardId).catch(log.error)
  );
  shardPromiseList.push(...shardCalls);
  if (!listShardsResponse.NextToken) {
    return shardPromiseList;
  }
  const newParams = { NextToken: listShardsResponse.NextToken };
  return iterateOverStreamRecursivelyToDispatchShards(
    streamName,
    streamArn,
    shardPromiseList,
    newParams
  );
}

/**
 * Fetch all records within a kinesis stream and process them through
 * message-consumer's processRecord function.
 *
 * @param {string} streamName - kinesis stream name
 * @param {Date|string|number} [streamCreationTimestamp] - Optional. Stream creation
 * timestamp used to differentiate streams that have a name used by a previous stream.
 * @returns {number} number of records successfully processed from stream
 */
async function processStream(streamName, streamCreationTimestamp) {
  const initialParams = setupListShardParams(streamName, streamCreationTimestamp);
  const streamArn = await kinesisUtils.describeStream(
    { StreamName: streamName },
    { retries: 2 }
  ).then(
    (streamResponse) => get(streamResponse, 'StreamDescription.StreamARN')
  ).catch(log.error);
  const streamPromiseList = await iterateOverStreamRecursivelyToDispatchShards(
    streamName, streamArn, [], initialParams
  );
  const streamResults = await Promise.all(streamPromiseList);
  const recordsProcessed = streamResults.reduce(tallyReducer, 0);
  const outMsg = `Processed ${recordsProcessed} kinesis records from stream ${streamName}`;
  log.info(outMsg);
  return outMsg;
}

/**
 * Manual Consumer handler. Determines operation from input.
 * Supports manually consuming:
 * - Kinesis records.
 *
 * @param {Object} event - input params object
 * @returns {string} String describing outcome
 */
async function handler(event) {
  configureTimestampEnvs(event);

  if (event.type === 'kinesis' && event.kinesisStream !== undefined) {
    log.info(`Processing records from stream ${event.kinesisStream}`);
    return processStream(event.kinesisStream, event.kinesisStreamCreationTimestamp);
  }

  const errMsg = 'Manual consumer could not determine expected operation'
    + ` from event ${JSON.stringify(event)}`;
  log.fatal(errMsg);
  return errMsg;
}

module.exports = {
  configureTimestampEnvs,
  handler,
  iterateOverShardRecursively,
  iterateOverStreamRecursivelyToDispatchShards,
  processRecordBatch,
  processShard,
  processStream,
  setupIteratorParams,
  setupListShardParams,
};
