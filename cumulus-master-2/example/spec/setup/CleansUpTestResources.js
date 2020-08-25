const { deleteS3Files, listS3ObjectsV2 } = require('@cumulus/aws-client/S3');
const { loadConfig } = require('../helpers/testUtils');

describe('Cleans up Test Resources', () => {
  it('removes the test output', async () => {
    const testConfig = await loadConfig();

    const params = {
      Bucket: testConfig.bucket,
      Prefix: `${testConfig.stackName}/test-output/`,
    };
    const s3list = await listS3ObjectsV2(params);
    const s3objects = s3list.map((obj) => ({ Bucket: testConfig.bucket, Key: obj.Key }));
    console.log(`\nDeleting ${s3objects.length} objects`);
    await deleteS3Files(s3objects);
  });
});
