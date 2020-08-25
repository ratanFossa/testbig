'use strict';

const get = require('lodash/get');
const pAll = require('p-all');
const pick = require('lodash/pick');
const { randomId } = require('@cumulus/common/test-utils');

const { createCollection } = require('@cumulus/integration-tests/Collections');
const {
  findExecutionArn, getExecutionWithStatus,
} = require('@cumulus/integration-tests/Executions');
const { getGranuleWithStatus } = require('@cumulus/integration-tests/Granules');
const { createProvider } = require('@cumulus/integration-tests/Providers');
const { createOneTimeRule } = require('@cumulus/integration-tests/Rules');

const { deleteCollection } = require('@cumulus/api-client/collections');
const { deleteGranule } = require('@cumulus/api-client/granules');
const { deleteProvider } = require('@cumulus/api-client/providers');
const { deleteRule } = require('@cumulus/api-client/rules');

const { deleteS3Object, s3PutObject } = require('@cumulus/aws-client/S3');

const { loadConfig } = require('../../helpers/testUtils');

describe('The DiscoverGranules workflow with one existing granule, one new granule, and duplicateHandling="skip"', () => {
  let beforeAllFailed = false;
  let collection;
  let discoverGranulesRule;
  let existingGranuleId;
  let existingGranuleKey;
  let finishedDiscoverGranulesExecution;
  let ingestGranuleRule;
  let newGranuleId;
  let newGranuleKey;
  let prefix;
  let provider;
  let sourceBucket;

  beforeAll(async () => {
    try {
      const config = await loadConfig();
      prefix = config.stackName;
      sourceBucket = config.bucket;

      // The S3 path where granules will be ingested from
      const sourcePath = `${prefix}/tmp/${randomId('test-')}`;

      // Create the collection
      collection = await createCollection(
        prefix,
        {
          duplicateHandling: 'skip',
        }
      );

      // Create the S3 provider
      provider = await createProvider(prefix, { host: sourceBucket });

      // Stage the existing granule file to S3
      existingGranuleId = randomId('existing-granule-');
      existingGranuleKey = `${sourcePath}/${existingGranuleId}.txt`;
      await s3PutObject({
        Bucket: sourceBucket,
        Key: existingGranuleKey,
        Body: 'asdf',
      });

      const ingestTime = Date.now() - 1000 * 30;

      // Ingest the existing granule
      ingestGranuleRule = await createOneTimeRule(
        prefix,
        {
          workflow: 'IngestGranule',
          collection: pick(collection, ['name', 'version']),
          provider: provider.id,
          payload: {
            testExecutionId: randomId('test-execution-'),
            granules: [
              {
                granuleId: existingGranuleId,
                dataType: collection.name,
                version: collection.version,
                files: [
                  {
                    name: `${existingGranuleId}.txt`,
                    path: sourcePath,
                  },
                ],
              },
            ],
          },
        }
      );

      // Find the "IngestGranule" execution ARN
      const ingestGranuleExecutionArn = await findExecutionArn(
        prefix,
        (execution) =>
          get(execution, 'originalPayload.testExecutionId') === ingestGranuleRule.payload.testExecutionId,
        { timestamp__from: ingestTime },
        { timeout: 15 }
      );

      // Wait for the "IngestGranule" execution to be completed
      await getExecutionWithStatus({ prefix, arn: ingestGranuleExecutionArn, status: 'completed' });

      // Wait for the existing granule to be fully ingested
      await getGranuleWithStatus({ prefix, granuleId: existingGranuleId, status: 'completed' });

      // Stage the new granule file to S3
      newGranuleId = randomId('new-granule-');
      newGranuleKey = `${sourcePath}/${newGranuleId}.txt`;
      await s3PutObject({
        Bucket: sourceBucket,
        Key: newGranuleKey,
        Body: 'asdf',
      });

      // Run DiscoverGranules
      discoverGranulesRule = await createOneTimeRule(
        prefix,
        {
          workflow: 'DiscoverGranules',
          collection: {
            name: collection.name,
            version: collection.version,
          },
          provider: provider.id,
          meta: {
            provider_path: `${sourcePath}/`,
          },
          payload: {
            testExecutionId: randomId('test-execution-'),
          },
        }
      );

      // Find the "DiscoverGranules" execution ARN
      const discoverGranulesExecutionArn = await findExecutionArn(
        prefix,
        (execution) =>
          get(execution, 'originalPayload.testExecutionId') === discoverGranulesRule.payload.testExecutionId,
        { timestamp__from: ingestTime },
        { timeout: 15 }
      );

      // Get the completed "DiscoverGranules" execution
      finishedDiscoverGranulesExecution = await getExecutionWithStatus({
        prefix,
        arn: discoverGranulesExecutionArn,
        status: 'completed',
      });
    } catch (error) {
      beforeAllFailed = true;
      throw error;
    }
  });

  it('queues one granule for ingest', async () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else expect(finishedDiscoverGranulesExecution.finalPayload.running.length).toEqual(1);
  });

  it('queues the correct granule for ingest', async () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else {
      // The execution ARN of the "IngestGranules" workflow that was
      // created as a result of the "DiscoverGranules" workflow.
      const arn = finishedDiscoverGranulesExecution.finalPayload.running[0];

      // Wait for the execution to end
      const execution = await getExecutionWithStatus({ prefix, arn, status: 'completed' });

      expect(execution.originalPayload.granules[0].granuleId).toEqual(newGranuleId);
    }
  });

  it('results in the new granule being ingested', async () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else {
      await expectAsync(
        getGranuleWithStatus({ prefix, granuleId: newGranuleId, status: 'completed' })
      ).toBeResolved();
    }
  });

  afterAll(async () => {
    // Must delete rules before deleting associated collection and provider
    await pAll(
      [
        () => deleteRule({ prefix, ruleName: get(ingestGranuleRule, 'name') }),
        () => deleteRule({ prefix, ruleName: get(discoverGranulesRule, 'name') }),
      ],
      { stopOnError: false }
    ).catch(console.error);

    await pAll(
      [
        () => deleteS3Object(sourceBucket, existingGranuleKey),
        () => deleteS3Object(sourceBucket, newGranuleKey),
        () => deleteGranule({ prefix, granuleId: existingGranuleId }),
        () => deleteGranule({ prefix, granuleId: newGranuleId }),
        () => deleteProvider({ prefix, providerId: get(provider, 'id') }),
        () => deleteCollection({
          prefix,
          collectionName: get(collection, 'name'),
          collectionVersion: get(collection, 'version'),
        }),
      ],
      { stopOnError: false }
    ).catch(console.error);
  });
});
