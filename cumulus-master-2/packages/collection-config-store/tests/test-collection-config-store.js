'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const {
  createBucket,
  recursivelyDeleteS3Bucket,
  s3ObjectExists,
  getJsonS3Object,
  putJsonS3Object,
} = require('@cumulus/aws-client/S3');
const { constructCollectionId } = require('@cumulus/message/Collections');

const CollectionConfigStore = require('..');

const randomString = () => cryptoRandomString({ length: 10 });

test.beforeEach(async (t) => {
  t.context.stackName = randomString();
  t.context.name = randomString();
  t.context.version = '6';
  t.context.collectionConfig = { name: randomString() };
  t.context.bucket = randomString();
  // Utility function to return the S3 key of a collection config
  t.context.collectionConfigKey = (name, version) => {
    const collectionId = constructCollectionId(name, version);
    return `${t.context.stackName}/collections/${collectionId}.json`;
  };

  await createBucket(t.context.bucket);
});

test.afterEach((t) =>
  recursivelyDeleteS3Bucket(t.context.bucket)
    .catch((error) => {
      // Some tests delete the bucket before this "afterEach" hook is run,
      // which is okay.
      if (error.code !== 'NoSuchBucket') throw error;
    }));

test.serial('get() fetches a collection config from S3', async (t) => {
  const {
    bucket,
    collectionConfig,
    collectionConfigKey,
    name,
    version,
    stackName,
  } = t.context;

  await putJsonS3Object(
    bucket,
    collectionConfigKey(name, version),
    collectionConfig
  );

  const collectionConfigStore = new CollectionConfigStore(bucket, stackName);
  const fetchedCollectionConfig = await collectionConfigStore.get(name,
    version);

  t.deepEqual(fetchedCollectionConfig, collectionConfig);
});

test.serial('get() does not hit S3 for a cached collection config', async (t) => {
  const {
    bucket,
    collectionConfig,
    collectionConfigKey,
    name,
    version,
    stackName,
  } = t.context;

  await putJsonS3Object(
    bucket,
    collectionConfigKey(name, version),
    collectionConfig
  );

  const collectionConfigStore = new CollectionConfigStore(bucket, stackName);

  // Fetch the collection config once so it's in the cache
  await collectionConfigStore.get(name, version);

  // Delete the S3 bucket so the config can't be fetched from S3
  await recursivelyDeleteS3Bucket(bucket);

  // This get() should use the cache
  const fetchedCollectionConfig = await collectionConfigStore.get(name,
    version);

  t.deepEqual(fetchedCollectionConfig, collectionConfig);
});

test.serial('get() throws an exception if the collection config could not be found', async (t) => {
  const { bucket, version, stackName } = t.context;
  const invalidName = randomString();
  const collectionConfigStore = new CollectionConfigStore(bucket, stackName);
  const collectionId = constructCollectionId(invalidName, version);

  await t.throwsAsync(
    async () => collectionConfigStore.get(invalidName, version),
    { message: new RegExp(`${collectionId}`) }
  );
});

test.serial('get() throws an exception if the bucket does not exist', async (t) => {
  const { name, version, stackName } = t.context;
  const invalidBucket = randomString();
  const collectionConfigStore = new CollectionConfigStore(invalidBucket,
    stackName);

  await t.throwsAsync(
    async () => collectionConfigStore.get(name, version),
    { message: new RegExp(`${invalidBucket}`) }
  );
});

test.serial('put() stores a collection config to S3', async (t) => {
  const {
    bucket,
    collectionConfig,
    collectionConfigKey,
    name,
    version,
    stackName,
  } = t.context;
  const collectionConfigStore = new CollectionConfigStore(bucket, stackName);
  await collectionConfigStore.put(name, version, collectionConfig);

  const storedCollectionConfig = await getJsonS3Object(
    bucket,
    collectionConfigKey(name, version)
  );
  t.deepEqual(storedCollectionConfig, collectionConfig);
});

test.serial('put() updates the cache with the new collection config', async (t) => {
  const {
    bucket,
    name,
    version,
    collectionConfig,
    stackName,
  } = t.context;
  const collectionConfigStore = new CollectionConfigStore(bucket, stackName);

  await collectionConfigStore.put(name, version, collectionConfig);

  // Delete the S3 bucket so the config can't be fetched from S3
  await recursivelyDeleteS3Bucket(bucket);

  // This get() should use the cache
  const fetchedCollectionConfig = await collectionConfigStore.get(name,
    version);

  t.deepEqual(fetchedCollectionConfig, collectionConfig);
});

test.serial('delete() removes the collection config from S3', async (t) => {
  const {
    bucket,
    collectionConfig,
    collectionConfigKey,
    name,
    version,
    stackName,
  } = t.context;
  const key = collectionConfigKey(name, version);
  const s3Object = { Bucket: bucket, Key: key };
  const collectionConfigStore = new CollectionConfigStore(bucket, stackName);

  // Store the collection config to S3
  await collectionConfigStore.put(name, version, collectionConfig);

  // Verify that the collection config is in S3.  Will throw an error
  t.true(await s3ObjectExists(s3Object));

  // Delete the collection config
  await collectionConfigStore.delete(name, version);

  // Verify that the collection config is no longer in S3
  t.false(await s3ObjectExists(s3Object));
});

test('delete() the collection config from the cache', async (t) => {
  const {
    bucket,
    collectionConfig,
    name,
    version,
    stackName,
  } = t.context;
  const collectionConfigStore = new CollectionConfigStore(bucket, stackName);

  // Store the collection config to S3, which will also cache it
  await collectionConfigStore.put(name, version, collectionConfig);

  // Delete the collection config, which should clear it from the cache
  await collectionConfigStore.delete(name, version);

  // Try to get the config, which should hit S3 and fail if it isn't cached
  await t.throwsAsync(
    async () => collectionConfigStore.get(name, version),
    { message: new RegExp(`${constructCollectionId(name, version)}`) }
  );
});
