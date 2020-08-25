'use strict';

const test = require('ava');
const { randomString, randomId } = require('@cumulus/common/test-utils');

const bootstrap = require('../../lambdas/bootstrap');
const { Search } = require('../../es/search');
const { bootstrapDynamoDbTables } = require('../../lambdas/bootstrap');
const mappings = require('../../models/mappings.json');
const testMappings = require('../data/testEsMappings.json');
const mappingsSubset = require('../data/testEsMappingsSubset.json');
const mappingsNoFields = require('../data/testEsMappingsNoFields.json');

let esClient;

// This is for a skipped test: bootstrap dynamoDb activates pointInTime on a given table
const tableName = randomString();

// Skipping this test for because LocalStack version 0.8.6 does not support pointInTime
// When this test is back in, make sure to delete the table
test.serial.skip('bootstrap dynamoDb activates pointInTime on a given table', async (t) => {
  const resp = await bootstrapDynamoDbTables([{ name: tableName, pointInTime: true }]);

  t.is(
    resp.ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus,
    'ENABLED'
  );
});

test('bootstrap creates index with alias', async (t) => {
  const indexName = randomId('esindex');
  const testAlias = randomId('esalias');

  await bootstrap.bootstrapElasticSearch('fakehost', indexName, testAlias);
  try {
    esClient = await Search.es();

    t.is((await esClient.indices.exists({ index: indexName })).body, true);

    const alias = await esClient.indices.getAlias({ name: testAlias })
      .then((response) => response.body);

    t.deepEqual(Object.keys(alias), [indexName]);
  } finally {
    await esClient.indices.delete({ index: indexName });
  }
});

test.serial('bootstrap creates index with specified number of shards', async (t) => {
  const indexName = randomId('esindex');
  const testAlias = randomId('esalias');

  process.env.ES_INDEX_SHARDS = 4;
  try {
    await bootstrap.bootstrapElasticSearch('fakehost', indexName, testAlias);
    esClient = await Search.es();

    const indexSettings = await esClient.indices.get({ index: indexName })
      .then((response) => response.body);

    t.is(indexSettings[indexName].settings.index.number_of_shards, '4');
  } finally {
    delete process.env.ES_INDEX_SHARDS;
    await esClient.indices.delete({ index: indexName });
  }
});

test('bootstrap adds alias to existing index', async (t) => {
  const indexName = randomString();
  const testAlias = randomString();

  esClient = await Search.es();

  await esClient.indices.create({
    index: indexName,
    body: { mappings },
  });

  await bootstrap.bootstrapElasticSearch('fakehost', indexName, testAlias);
  esClient = await Search.es();

  const alias = await esClient.indices.getAlias({ name: testAlias })
    .then((response) => response.body);

  t.deepEqual(Object.keys(alias), [indexName]);

  await esClient.indices.delete({ index: indexName });
});

test('Missing types added to index', async (t) => {
  const indexName = randomString();
  const testAlias = randomString();

  esClient = await Search.es();

  await esClient.indices.create({
    index: indexName,
    body: { mappings: mappingsSubset },
  });

  t.deepEqual(
    await bootstrap.findMissingMappings(esClient, indexName, testMappings),
    ['logs', 'deletedgranule']
  );

  await bootstrap.bootstrapElasticSearch('fakehost', indexName, testAlias);
  esClient = await Search.es();

  t.deepEqual(
    await bootstrap.findMissingMappings(esClient, indexName, testMappings),
    []
  );

  await esClient.indices.delete({ index: indexName });
});

test('Missing fields added to index', async (t) => {
  const indexName = randomString();
  const testAlias = randomString();

  esClient = await Search.es();

  await esClient.indices.create({
    index: indexName,
    body: { mappings: mappingsNoFields },
  });

  t.deepEqual(
    await bootstrap.findMissingMappings(esClient, indexName, testMappings),
    ['logs', 'execution']
  );

  await bootstrap.bootstrapElasticSearch('fakehost', indexName, testAlias);
  esClient = await Search.es();

  t.deepEqual(
    await bootstrap.findMissingMappings(esClient, indexName, testMappings),
    []
  );

  await esClient.indices.delete({ index: indexName });
});

test('If an index exists with the alias name, it is deleted on bootstrap', async (t) => {
  const indexName = randomString();
  const testAlias = randomString();

  esClient = await Search.es();

  // Create index with name of alias we want to use
  await esClient.indices.create({
    index: testAlias,
    body: { mappings },
  });

  await bootstrap.bootstrapElasticSearch('fakehost', indexName, testAlias);
  esClient = await Search.es();

  // Get the index and make sure `testAlias` is not a key which would mean it's an index
  // If you use indices.exist on testAlias it'll return true because the alias is
  // applied to the index. Here we're checking it's an alias, not an index
  const { body: index } = await esClient.indices.get({ index: testAlias });

  t.falsy(index[testAlias]);

  await esClient.indices.delete({ index: indexName });
});
