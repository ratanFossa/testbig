'use strict';

const test = require('ava');
const {
  createBucket,
  recursivelyDeleteS3Bucket,
  s3PutObject,
} = require('@cumulus/aws-client/S3');
const {
  randomString,
  validateConfig,
  validateInput,
  validateOutput,
} = require('@cumulus/common/test-utils');
const CollectionConfigStore = require('@cumulus/collection-config-store');
const { PDRParsingError } = require('@cumulus/errors');
const { streamTestData } = require('@cumulus/test-data');
const { parsePdr } = require('..');

async function setUpTestPdrAndValidate(t) {
  return Promise.all([
    s3PutObject({
      Bucket: t.context.payload.config.provider.host,
      Key: `${t.context.payload.input.pdr.path}/${t.context.payload.input.pdr.name}`,
      Body: streamTestData(`pdrs/${t.context.payload.input.pdr.name}`),
    }),
    validateInput(t, t.context.payload.input),
    validateConfig(t, t.context.payload.config),
  ]);
}

test.before(async (t) => {
  const testBucket = `internal-bucket-${randomString().slice(0, 6)}`;
  await createBucket(testBucket);
  t.context.stackName = `stack-${randomString().slice(0, 6)}`;
  t.context.collectionConfigStore = new CollectionConfigStore(
    testBucket,
    t.context.stackName
  );
  const mod09CollectionConfig = {
    granuleIdExtraction: '^(.*)\.hdf',
  };
  const mod87CollectionConfig = {
    granuleIdExtraction: '^PENS-(.*)\.hdf',
  };
  await Promise.all([
    t.context.collectionConfigStore.put('MOD09GQ', '006', mod09CollectionConfig),
    t.context.collectionConfigStore.put('MOD87GQ', '006', mod87CollectionConfig),
  ]);

  t.context.payload = {
    config: {
      stack: t.context.stackName,
      bucket: testBucket,
      provider: {
        id: 'MODAPS',
        protocol: 's3',
        host: testBucket,
      },
    },
    input: {
      pdr: {
        name: '',
        path: '/pdrs',
      },
    },
  };
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.payload.config.bucket);
});

test.serial('parse-pdr properly parses a simple PDR file', async (t) => {
  t.context.payload.input.pdr.name = 'MOD09GQ.PDR';
  await setUpTestPdrAndValidate(t).catch(t.fail);

  const result = await parsePdr(t.context.payload);
  await validateOutput(t, result).catch(t.fail);

  t.is(result.filesCount, 2);
  t.is(result.granulesCount, 1);
  t.is(result.granules.length, 1);
  t.is(result.totalSize, 17909733);

  const granule = result.granules[0];
  t.is(granule.dataType, 'MOD09GQ');

  const hdfFile = result.granules[0].files.find((file) => file.name === 'MOD09GQ.A2017224.h09v02.006.2017227165020.hdf');
  t.truthy(hdfFile);
  t.is(hdfFile.path, '/MODOPS/MODAPS/EDC/CUMULUS/FPROC/DATA');
  t.is(hdfFile.size, 17865615);
  t.is(hdfFile.checksumType, 'CKSUM');
  t.is(hdfFile.checksum, 4208254019);
  t.is(hdfFile.type, 'data');

  const metFile = result.granules[0].files.find((file) => file.name === 'MOD09GQ.A2017224.h09v02.006.2017227165020.hdf.met');
  t.truthy(metFile);
  t.is(metFile.path, '/MODOPS/MODAPS/EDC/CUMULUS/FPROC/DATA');
  t.is(metFile.size, 44118);
  t.is(metFile.type, 'metadata');
});

test.serial('parse-pdr properly parses PDR with granules of different data-types', async (t) => {
  t.context.payload.input.pdr.name = 'multi-data-type.PDR';
  await setUpTestPdrAndValidate(t).catch(t.fail);

  const result = await parsePdr(t.context.payload);
  await validateOutput(t, result).catch(t.fail);

  t.is(result.filesCount, 4);
  t.is(result.granulesCount, 2);
  t.is(result.granules.length, 2);
  t.is(result.totalSize, 35819466);

  const mod09Granule = result.granules.find((granule) => granule.dataType === 'MOD09GQ');
  t.truthy(mod09Granule);
  t.is(mod09Granule.granuleId, 'MOD09GQ.A2017224.h09v02.006.2017227165020');
  t.is(mod09Granule.granuleSize, 17909733);

  const mod09HdfFile = mod09Granule.files.find((file) => file.name === 'MOD09GQ.A2017224.h09v02.006.2017227165020.hdf');
  t.truthy(mod09HdfFile);
  t.is(mod09HdfFile.path, '/MODOPS/MODAPS/EDC/CUMULUS/FPROC/DATA');
  t.is(mod09HdfFile.size, 17865615);
  t.is(mod09HdfFile.checksumType, 'CKSUM');
  t.is(mod09HdfFile.checksum, 4208254019);
  t.is(mod09HdfFile.type, 'data');

  const mod09MetFile = mod09Granule.files.find((file) => file.name === 'MOD09GQ.A2017224.h09v02.006.2017227165020.hdf.met');
  t.truthy(mod09MetFile);
  t.is(mod09MetFile.path, '/MODOPS/MODAPS/EDC/CUMULUS/FPROC/DATA');
  t.is(mod09MetFile.size, 44118);
  t.is(mod09MetFile.type, 'metadata');

  const mod87Granule = result.granules.find((granule) => granule.dataType === 'MOD87GQ');
  t.truthy(mod87Granule);
  t.is(mod87Granule.granuleId, 'MOD87GQ.A2017224.h09v02.006.2017227165020');
  t.is(mod87Granule.granuleSize, 17909733);

  const mod87HdfFile = mod87Granule.files.find((file) => file.name === 'PENS-MOD87GQ.A2017224.h09v02.006.2017227165020.hdf');
  t.truthy(mod87HdfFile);
  t.is(mod87HdfFile.path, '/MODOPS/MODAPS/EDC/CUMULUS/FPROC/DATA');
  t.is(mod87HdfFile.size, 17865615);
  t.is(mod87HdfFile.checksumType, 'CKSUM');
  t.is(mod87HdfFile.checksum, 4208254019);
  t.is(mod87HdfFile.type, 'data');

  const mod87MetFile = mod87Granule.files.find((file) => file.name === 'PENS-MOD87GQ.A2017224.h09v02.006.2017227165020.hdf.met');
  t.truthy(mod87MetFile);
  t.is(mod87MetFile.path, '/MODOPS/MODAPS/EDC/CUMULUS/FPROC/DATA');
  t.is(mod87MetFile.size, 44118);
  t.is(mod87MetFile.type, 'metadata');
});

test.serial('parsePdr throws an exception if FILE_CKSUM_TYPE is set but FILE_CKSUM_VALUE is not', async (t) => {
  t.context.payload.input.pdr.name = 'MOD09GQ-without-FILE_CKSUM_VALUE.PDR';
  await setUpTestPdrAndValidate(t).catch(t.fail);

  await t.throwsAsync(
    parsePdr(t.context.payload),
    {
      instanceOf: PDRParsingError,
      message: 'MISSING FILE_CKSUM_VALUE PARAMETER',
    }
  );
});

test.serial('parsePdr throws an exception if FILE_CKSUM_VALUE is set but FILE_CKSUM_TYPE is not', async (t) => {
  t.context.payload.input.pdr.name = 'MOD09GQ-without-FILE_CKSUM_TYPE.PDR';
  await setUpTestPdrAndValidate(t).catch(t.fail);

  await t.throwsAsync(
    parsePdr(t.context.payload),
    {
      instanceOf: PDRParsingError,
      message: 'MISSING FILE_CKSUM_TYPE PARAMETER',
    }
  );
});

test.serial('parsePdr accepts an MD5 checksum', async (t) => {
  t.context.payload.input.pdr.name = 'MOD09GQ-with-MD5-checksum.PDR';
  await setUpTestPdrAndValidate(t).catch(t.fail);

  const result = await parsePdr(t.context.payload);
  await validateOutput(t, result).catch(t.fail);

  const fileWithChecksum = result.granules[0].files.find((file) => file.name === 'MOD09GQ.A2017224.h09v02.006.2017227165020.hdf');
  t.is(fileWithChecksum.checksumType, 'MD5');
});

test.serial('parsePdr throws an exception if the value of an MD5 checksum is not a string', async (t) => {
  t.context.payload.input.pdr.name = 'MOD09GQ-with-invalid-MD5-checksum.PDR';
  await setUpTestPdrAndValidate(t).catch(t.fail);

  try {
    await parsePdr(t.context.payload);
    t.fail('Expected parsePdr to throw an error');
  } catch (error) {
    t.true(error.message.startsWith('Expected MD5 value to be a string'));
  }
});

test.serial('parsePdr throws an exception if the value of a CKSUM checksum is not a number', async (t) => {
  t.context.payload.input.pdr.name = 'MOD09GQ-with-invalid-CKSUM-checksum.PDR';
  await setUpTestPdrAndValidate(t).catch(t.fail);

  try {
    await parsePdr(t.context.payload);
    t.fail('Expected parsePdr to throw an error');
  } catch (error) {
    t.true(error.message.startsWith('Expected CKSUM value to be a number'));
  }
});

test.serial('parsePdr throws an exception if the a FILE_TYPE in the evaluated PDR is invalid', async (t) => {
  t.context.payload.input.pdr.name = 'MOD09GQ-with-invalid-file-type.PDR';
  await setUpTestPdrAndValidate(t).catch(t.fail);

  await t.throwsAsync(
    parsePdr(t.context.payload),
    {
      instanceOf: PDRParsingError,
      message: 'INVALID FILE_TYPE PARAMETER : INVALID',
    }
  );
});
