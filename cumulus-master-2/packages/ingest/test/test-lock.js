'use strict';

const proxyquire = require('proxyquire');
const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');

// 5 * 60 seconds * 1000 milliseconds
const fiveMinutes = 5 * 60 * 1000;

const { checkOldLocks, countLock, proceed } = proxyquire(
  '../lock',
  {
    '@cumulus/aws-client/S3': {
      deleteS3Object: () => Promise.resolve(),
      listS3ObjectsV2: (_, providerName) => Promise.resolve([
        {
          Key: `lock/${providerName}/test`,
          LastModified: new Date(),
        },
        {
          Key: `lock/${providerName}/test2`,
          LastModified: new Date(Date.now() - (fiveMinutes + 1)),
        },
      ]),
    },
  }
);

test.beforeEach(async (t) => {
  t.context.bucket = randomString();
  t.context.providerName = randomString();
});

test('checkOldLocks() returns correct number of locks', async (t) => {
  const { bucket, providerName } = t.context;

  let count = await checkOldLocks(bucket, []);
  t.is(count, 0);

  count = await checkOldLocks(bucket, [
    {
      Key: `lock/${providerName}/test`,
      LastModified: new Date(),
    },
    {
      Key: `lock/${providerName}/test2`,
      LastModified: new Date(Date.now() - (fiveMinutes + 1)),
    },
    {
      Key: `lock/${providerName}/test3`,
      LastModified: new Date(Date.now() - (fiveMinutes + 1)),
    },
  ]);
  t.is(count, 1);
});

test('countLock() returns the correct number of locks', async (t) => {
  const { bucket, providerName } = t.context;

  const count = await countLock(bucket, providerName);

  t.is(count, 1);
});

test('proceed() returns true if globalConnectionLimit is undefined', async (t) => {
  t.true(await proceed(undefined, {}, undefined));
});
