'use strict';

const test = require('ava');
const nock = require('nock');
const CMRSearchConceptQueue = require('../CMRSearchConceptQueue');

test.before(() => {
  nock.cleanAll();
});

test.after.always(() => {
  nock.cleanAll();
});

test('CMRSearchConceptQueue handles paging correctly.', async (t) => {
  const headers = { 'cmr-hits': 6 };
  const body1 = '{"hits":6,"items":[{"cmrEntry1":"data1"}, {"cmrEntry2":"data2"}]}';
  const body2 = '{"hits":6,"items":[{"cmrEntry3":"data3"}, {"cmrEntry4":"data4"}]}';
  const body3 = '{"hits":6,"items":[{"cmrEntry5":"data5"}, {"cmrEntry6":"data6"}]}';

  nock('https://cmr.uat.earthdata.nasa.gov')
    .get('/search/granules.umm_json')
    .query((q) => q.page_num === '1')
    .reply(200, body1, headers);

  nock('https://cmr.uat.earthdata.nasa.gov')
    .get('/search/granules.umm_json')
    .query((q) => q.page_num === '2')
    .reply(200, body2, headers);

  nock('https://cmr.uat.earthdata.nasa.gov')
    .get('/search/granules.umm_json')
    .query((q) => q.page_num === '3')
    .reply(200, body3, headers);

  nock('https://cmr.uat.earthdata.nasa.gov')
    .persist()
    .post('/legacy-services/rest/tokens')
    .reply(200, { token: 'ABCDE' });

  const expected = [
    { cmrEntry1: 'data1' },
    { cmrEntry2: 'data2' },
    { cmrEntry3: 'data3' },
    { cmrEntry4: 'data4' },
    { cmrEntry5: 'data5' },
    { cmrEntry6: 'data6' },
  ];
  process.env.CMR_ENVIRONMENT = 'UAT';
  const cmrSearchQueue = new CMRSearchConceptQueue({
    cmrSettings: {
      provider: 'CUMULUS',
      clientId: 'fakeClient',
      username: 'fakeUser',
      password: 'fakePassword',
    },
    type: 'granules',
    searchParams: {},
    format: 'umm_json',
  });
  for (let i = 0; i < 6; i += 1) {
    t.deepEqual(await cmrSearchQueue.peek(), expected[i]); // eslint-disable-line no-await-in-loop
    await cmrSearchQueue.shift(); // eslint-disable-line no-await-in-loop
  }
});
