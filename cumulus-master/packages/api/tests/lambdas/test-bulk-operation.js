const test = require('ava');
const proxyquire = require('proxyquire');
const sinon = require('sinon');

const { randomId } = require('@cumulus/common/test-utils');

const { fakeGranuleFactoryV2 } = require('../../lib/testUtils');
const Granule = require('../../models/granules');

const sandbox = sinon.createSandbox();
const FakeEsClient = sandbox.stub();
const esSearchStub = sandbox.stub();
const esScrollStub = sandbox.stub();
FakeEsClient.prototype.scroll = esScrollStub;
FakeEsClient.prototype.search = esSearchStub;
const bulkOperation = proxyquire('../../lambdas/bulk-operation', {
  '@elastic/elasticsearch': { Client: FakeEsClient },
});

let applyWorkflowStub;
const envVars = {
  cmr_client_id: randomId('cmr_client'),
  CMR_ENVIRONMENT: randomId('env'),
  cmr_oauth_provider: randomId('cmr_oauth'),
  cmr_password_secret_name: randomId('cmr_secret'),
  cmr_provider: randomId('cmr_provider'),
  cmr_username: randomId('cmr_user'),
  invoke: randomId('invoke'),
  launchpad_api: randomId('api'),
  launchpad_certificate: randomId('certificate'),
  launchpad_passphrase_secret_name: randomId('launchpad_secret'),
  METRICS_ES_HOST: randomId('host'),
  METRICS_ES_USER: randomId('user'),
  METRICS_ES_PASS: randomId('pass'),
  stackName: randomId('stack'),
  system_bucket: randomId('bucket'),
};

test.before(async () => {
  process.env.METRICS_ES_HOST = randomId('host');
  process.env.METRICS_ES_USER = randomId('user');
  process.env.METRICS_ES_PASS = randomId('pass');
  process.env.GranulesTable = randomId('granule');
  await new Granule().createTable();

  applyWorkflowStub = sandbox.stub(Granule.prototype, 'applyWorkflow');
  sandbox.stub(Granule.prototype, '_removeGranuleFromCmr').resolves();
});

test.afterEach.always(() => {
  sandbox.resetHistory();
});

test.after.always(() => {
  sandbox.restore();
});

test('getGranuleIdsForPayload returns unique granule IDs from payload', async (t) => {
  const granuleId1 = randomId('granule');
  const granuleId2 = randomId('granule');
  const ids = [granuleId1, granuleId1, granuleId2];
  const returnedIds = await bulkOperation.getGranuleIdsForPayload({
    ids,
  });
  t.deepEqual(
    returnedIds.sort(),
    [granuleId1, granuleId2].sort()
  );
});

test.serial('getGranuleIdsForPayload returns unique granule IDs from query', async (t) => {
  const granuleId1 = randomId('granule');
  const granuleId2 = randomId('granule');
  esSearchStub.resolves({
    body: {
      hits: {
        hits: [{
          _source: {
            granuleId: granuleId1,
          },
        }, {
          _source: {
            granuleId: granuleId1,
          },
        }, {
          _source: {
            granuleId: granuleId2,
          },
        }],
        total: {
          value: 3,
        },
      },
    },
  });
  const returnedIds = await bulkOperation.getGranuleIdsForPayload({
    query: 'fake-query',
    index: 'fake-index',
  });
  t.deepEqual(
    returnedIds.sort(),
    [granuleId1, granuleId2].sort()
  );
});

test.serial('getGranuleIdsForPayload handles query paging', async (t) => {
  const granuleId1 = randomId('granule');
  const granuleId2 = randomId('granule');
  const granuleId3 = randomId('granule');
  esSearchStub.resolves({
    body: {
      hits: {
        hits: [{
          _source: {
            granuleId: granuleId1,
          },
        }, {
          _source: {
            granuleId: granuleId2,
          },
        }],
        total: {
          value: 3,
        },
      },
    },
  });
  esScrollStub.resolves({
    body: {
      hits: {
        hits: [{
          _source: {
            granuleId: granuleId3,
          },
        }],
        total: {
          value: 3,
        },
      },
    },
  });
  t.deepEqual(
    await bulkOperation.getGranuleIdsForPayload({
      query: 'fake-query',
      index: 'fake-index',
    }),
    [granuleId1, granuleId2, granuleId3]
  );
});

test('bulk operation lambda throws error for unknown event type', async (t) => {
  await t.throwsAsync(bulkOperation.handler({
    type: randomId('type'),
  }));
});

test.serial('bulk operation lambda sets env vars provided in payload', async (t) => {
  const granuleModel = new Granule();
  const granule = await granuleModel.create(fakeGranuleFactoryV2());
  const workflowName = randomId('workflow');

  // ensure env vars aren't already set
  Object.keys(envVars).forEach((envVarKey) => {
    delete process.env[envVarKey];
  });

  await bulkOperation.handler({
    type: 'BULK_GRANULE',
    envVars,
    payload: {
      ids: [granule.granuleId],
      workflowName,
    },
  });
  Object.keys(envVars).forEach((envVarKey) => {
    t.is(process.env[envVarKey], envVars[envVarKey]);
  });
});

test.serial('bulk operation BULK_GRANULE applies workflow to list of granule IDs', async (t) => {
  const granuleModel = new Granule();
  const granules = await Promise.all([
    granuleModel.create(fakeGranuleFactoryV2()),
    granuleModel.create(fakeGranuleFactoryV2()),
  ]);

  const workflowName = randomId('workflow');
  await bulkOperation.handler({
    type: 'BULK_GRANULE',
    envVars,
    payload: {
      ids: [
        granules[0].granuleId,
        granules[1].granuleId,
      ],
      workflowName,
    },
  });
  t.is(applyWorkflowStub.callCount, 2);
  // Can't guarantee processing order so test against granule matching by ID
  applyWorkflowStub.args.forEach((callArgs) => {
    const matchingGranule = granules.find((granule) => granule.granuleId === callArgs[0].granuleId);
    t.deepEqual(matchingGranule, callArgs[0]);
    t.is(callArgs[1], workflowName);
  });
});

test.serial('bulk operation BULK_GRANULE applies workflow to granule IDs returned by query', async (t) => {
  const granuleModel = new Granule();
  const granules = await Promise.all([
    granuleModel.create(fakeGranuleFactoryV2()),
    granuleModel.create(fakeGranuleFactoryV2()),
  ]);

  esSearchStub.resolves({
    body: {
      hits: {
        hits: [{
          _source: {
            granuleId: granules[0].granuleId,
          },
        }, {
          _source: {
            granuleId: granules[1].granuleId,
          },
        }],
        total: {
          value: 2,
        },
      },
    },
  });

  const workflowName = randomId('workflow');
  await bulkOperation.handler({
    type: 'BULK_GRANULE',
    envVars,
    payload: {
      query: 'fake-query',
      workflowName,
      index: randomId('index'),
    },
  });

  t.true(esSearchStub.called);
  t.is(applyWorkflowStub.callCount, 2);
  // Can't guarantee processing order so test against granule matching by ID
  applyWorkflowStub.args.forEach((callArgs) => {
    const matchingGranule = granules.find((granule) => granule.granuleId === callArgs[0].granuleId);
    t.deepEqual(matchingGranule, callArgs[0]);
    t.is(callArgs[1], workflowName);
  });
});

test.serial('bulk operation BULK_GRANULE_DELETE deletes listed granule IDs', async (t) => {
  const granuleModel = new Granule();
  const granules = await Promise.all([
    granuleModel.create(fakeGranuleFactoryV2({ published: false })),
    granuleModel.create(fakeGranuleFactoryV2({ published: false })),
  ]);

  const { deletedGranules } = await bulkOperation.handler({
    type: 'BULK_GRANULE_DELETE',
    envVars,
    payload: {
      ids: [
        granules[0].granuleId,
        granules[1].granuleId,
      ],
    },
  });

  t.deepEqual(
    deletedGranules,
    [
      granules[0].granuleId,
      granules[1].granuleId,
    ]
  );
});

test.serial('bulk operation BULK_GRANULE_DELETE processes all granules that do not error', async (t) => {
  const errorMessage = 'fail';
  let count = 0;

  const deleteStub = sinon.stub(Granule.prototype, 'delete')
    .callsFake(() => {
      count += 1;
      if (count > 3) {
        throw new Error(errorMessage);
      }
      return Promise.resolve();
    });
  t.teardown(() => {
    deleteStub.restore();
  });

  const granuleModel = new Granule();
  const granules = await Promise.all([
    granuleModel.create(fakeGranuleFactoryV2()),
    granuleModel.create(fakeGranuleFactoryV2()),
    granuleModel.create(fakeGranuleFactoryV2()),
    granuleModel.create(fakeGranuleFactoryV2()),
    granuleModel.create(fakeGranuleFactoryV2()),
    granuleModel.create(fakeGranuleFactoryV2()),
  ]);

  const aggregateError = await t.throwsAsync(bulkOperation.handler({
    type: 'BULK_GRANULE_DELETE',
    envVars,
    payload: {
      ids: [
        granules[0].granuleId,
        granules[1].granuleId,
        granules[2].granuleId,
        granules[3].granuleId,
        granules[4].granuleId,
        granules[5].granuleId,
      ],
    },
  }));

  // tried to delete 6 times, but failed 3 times
  t.is(deleteStub.callCount, 6);
  t.deepEqual(
    Array.from(aggregateError).map((error) => error.message),
    [
      errorMessage,
      errorMessage,
      errorMessage,
    ]
  );
});

test.serial('bulk operation BULK_GRANULE_DELETE deletes granule IDs returned by query', async (t) => {
  const granuleModel = new Granule();
  const granules = await Promise.all([
    granuleModel.create(fakeGranuleFactoryV2({ published: false })),
    granuleModel.create(fakeGranuleFactoryV2({ published: false })),
  ]);

  esSearchStub.resolves({
    body: {
      hits: {
        hits: [{
          _source: {
            granuleId: granules[0].granuleId,
          },
        }, {
          _source: {
            granuleId: granules[1].granuleId,
          },
        }],
        total: {
          value: 2,
        },
      },
    },
  });

  const { deletedGranules } = await bulkOperation.handler({
    type: 'BULK_GRANULE_DELETE',
    envVars,
    payload: {
      query: 'fake-query',
      index: randomId('index'),
    },
  });

  t.true(esSearchStub.called);
  t.deepEqual(
    deletedGranules,
    [
      granules[0].granuleId,
      granules[1].granuleId,
    ]
  );
});

test.serial('bulk operation BULK_GRANULE_DELETE does not fail on published granules if payload.forceRemoveFromCmr is true', async (t) => {
  const granuleModel = new Granule();
  const granules = await Promise.all([
    granuleModel.create(fakeGranuleFactoryV2({ published: true })),
    granuleModel.create(fakeGranuleFactoryV2({ published: true })),
  ]);

  const { deletedGranules } = await bulkOperation.handler({
    type: 'BULK_GRANULE_DELETE',
    envVars,
    payload: {
      ids: [
        granules[0].granuleId,
        granules[1].granuleId,
      ],
      forceRemoveFromCmr: true,
    },
  });

  t.deepEqual(
    deletedGranules,
    [
      granules[0].granuleId,
      granules[1].granuleId,
    ]
  );
});
