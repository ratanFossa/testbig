'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const {
  deleteS3Object,
  s3ObjectExists,
  s3PutObject,
} = require('@cumulus/aws-client/S3');
const log = require('@cumulus/common/log');

/**
 * Throw an error if hello world is configured to throw an error for
 * testing/example purposes. Set the pass on retry value to simulate
 * a task passing on a retry.
 *
 * @param {Object} event - input from the message adapter
 * @returns {undefined} none
 */
async function throwErrorIfConfigured(event) {
  const execution = event.config.execution;
  const retryFilename = `${execution}_retry.txt`;
  const bucket = event.config.bucket;

  let isRetry = false;

  if (event.config.passOnRetry) {
    isRetry = await s3ObjectExists({
      Bucket: bucket,
      Key: retryFilename,
    });
  }

  if (event.config.passOnRetry && isRetry) {
    log.debug('Detected retry');

    // Delete file
    await deleteS3Object(bucket, retryFilename);
  } else if (event.config.fail) {
    if (event.config.passOnRetry) {
      await s3PutObject({
        Bucket: bucket,
        Key: retryFilename,
        Body: '',
      });
    }

    throw new Error('Step configured to force fail');
  }
}

/**
 * Return sample 'hello world' JSON
 *
 * @param {Object} event - input from the message adapter
 * @returns {Object} sample JSON object
 */
async function helloWorld(event) {
  await throwErrorIfConfigured(event);

  return {
    hello: 'Hello World',
  };
}
/**
 * Lambda handler
 *
 * @param {Object} event      - a Cumulus Message
 * @param {Object} context    - an AWS Lambda context
 * @returns {Promise<Object>} - sample JSON object
 */
async function handler(event, context) {
  return cumulusMessageAdapter.runCumulusTask(helloWorld, event, context);
}

exports.handler = handler;
exports.helloWorld = helloWorld; // exported to support testing
