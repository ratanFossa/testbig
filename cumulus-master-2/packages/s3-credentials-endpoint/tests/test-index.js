'use strict';

const cryptoRandomString = require('crypto-random-string');
const test = require('ava');
const sinon = require('sinon');
const request = require('supertest');
const moment = require('moment');

const awsServices = require('@cumulus/aws-client/services');

const { EarthdataLoginClient } = require('@cumulus/earthdata-login-client');

const models = require('@cumulus/api/models');
const { fakeAccessTokenFactory } = require('@cumulus/api/lib/testUtils');

const randomString = () => cryptoRandomString({ length: 6 });

const randomId = (prefix, separator = '-') =>
  [prefix, randomString()].filter((x) => x).join(separator);

process.env.EARTHDATA_CLIENT_ID = randomId('edlID');
process.env.EARTHDATA_CLIENT_PASSWORD = randomId('edlPW');
process.env.DISTRIBUTION_REDIRECT_ENDPOINT = 'http://example.com';
process.env.DISTRIBUTION_ENDPOINT = `https://${randomId('host')}/${randomId('path')}`;
process.env.AccessTokensTable = randomId('tokenTable');
process.env.TOKEN_SECRET = randomId('tokenSecret');

let accessTokenModel;
let authorizationUrl;

// import the express app after setting the env variables
// const { distributionApp } = require('../distribution');
const {
  buildRoleSessionName,
  distributionApp,
  handleTokenAuthRequest,
  requestTemporaryCredentialsFromNgap,
  s3credentials,
} = require('..');

test.before(async () => {
  accessTokenModel = new models.AccessToken('token');
  await accessTokenModel.createTable();

  authorizationUrl = randomId('authURL');
  const stubbedAccessToken = fakeAccessTokenFactory();

  sinon.stub(
    EarthdataLoginClient.prototype,
    'getAccessToken'
  ).callsFake(() => stubbedAccessToken);

  sinon.stub(
    EarthdataLoginClient.prototype,
    'getAuthorizationUrl'
  ).callsFake(() => authorizationUrl);
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  sinon.reset();
});

test('An authorized s3credential requeste invokes NGAPs request for credentials with username from accessToken cookie', async (t) => {
  const username = randomId('username');
  const fakeCredential = { Payload: JSON.stringify({ fake: 'credential' }) };

  const spy = sinon.spy(() => Promise.resolve(fakeCredential));
  sinon.stub(awsServices, 'lambda').callsFake(() => ({
    invoke: (params) => ({
      promise: () => spy(params),
    }),
  }));

  const accessTokenRecord = fakeAccessTokenFactory({ username });
  await accessTokenModel.create(accessTokenRecord);

  process.env.STSCredentialsLambda = 'Fake-NGAP-Credential-Dispensing-Lambda';
  const FunctionName = process.env.STSCredentialsLambda;
  const Payload = JSON.stringify({
    accesstype: 'sameregion',
    returntype: 'lowerCamel',
    duration: '3600',
    rolesession: username,
    userid: username,
  });

  await request(distributionApp)
    .get('/s3credentials')
    .set('Accept', 'application/json')
    .set('Cookie', [`accessToken=${accessTokenRecord.accessToken}`])
    .expect(200);

  t.true(spy.called);
  t.deepEqual(spy.args[0][0], {
    FunctionName,
    Payload,
  });
});

test('An s3credential request without access Token redirects to Oauth2 provider.', async (t) => {
  const response = await request(distributionApp)
    .get('/s3credentials')
    .set('Accept', 'application/json')
    .expect(307);

  t.is(response.status, 307);
  t.is(response.headers.location, authorizationUrl);
});

test('An s3credential request with expired accessToken redirects to Oauth2 provider', async (t) => {
  const accessTokenRecord = fakeAccessTokenFactory({
    expirationTime: moment().unix(),
  });
  await accessTokenModel.create(accessTokenRecord);

  const response = await request(distributionApp)
    .get('/s3credentials')
    .set('Accept', 'application/json')
    .set('Cookie', [`accessToken=${accessTokenRecord.accessToken}`])
    .expect(307);

  t.is(response.status, 307);
  t.is(response.headers.location, authorizationUrl);
});

test('buildRoleSessionName() returns the username if a client name is not provided', (t) => {
  t.is(
    buildRoleSessionName('username'),
    'username'
  );
});

test('buildRoleSessionName() returns the username and client name if a client name is provided', (t) => {
  t.is(
    buildRoleSessionName('username', 'clientname'),
    'username@clientname'
  );
});

test('requestTemporaryCredentialsFromNgap() invokes the credentials lambda with the correct payload', async (t) => {
  let invocationCount = 0;

  const lambdaFunctionName = 'my-lambda-function-name';
  const roleSessionName = 'my-role-session-name';
  const userId = 'my-user-id';

  const fakeLambda = {
    invoke: (params) => {
      invocationCount += 1;

      t.is(params.FunctionName, lambdaFunctionName);

      t.deepEqual(
        JSON.parse(params.Payload),
        {
          accesstype: 'sameregion',
          returntype: 'lowerCamel',
          duration: '3600',
          rolesession: roleSessionName,
          userid: userId,
        }
      );

      return {
        promise: async () => undefined,
      };
    },
  };

  await requestTemporaryCredentialsFromNgap({
    lambda: fakeLambda,
    lambdaFunctionName,
    userId,
    roleSessionName,
  });

  t.is(invocationCount, 1);
});

test('handleTokenAuthRequest() saves the client name in the request, if provided', async (t) => {
  const req = {
    get(headerName) {
      return this.headers[headerName];
    },
    headers: {
      'EDL-Client-Id': 'my-client-id',
      'EDL-Token': 'my-token',
      'EDL-Client-Name': 'my-client-name',
    },
    earthdataLoginClient: {
      async getTokenUsername() {
        return 'my-username';
      },
    },
  };

  await handleTokenAuthRequest(req, undefined, () => undefined);

  t.is(req.authorizedMetadata.clientName, 'my-client-name');
});

test('handleTokenAuthRequest() with an invalid client name results in a "Bad Request" response', async (t) => {
  const req = {
    get(headerName) {
      return this.headers[headerName];
    },
    headers: {
      'EDL-Client-Id': 'my-client-id',
      'EDL-Token': 'my-token',
      'EDL-Client-Name': 'not valid',
    },
    earthdataLoginClient: {
      async getTokenUsername() {
        return 'my-username';
      },
    },
  };

  const res = {
    boom: {
      badRequest: () => 'response-from-boom-badRequest',
    },
  };

  const next = () => t.fail('next() should not have been called');

  t.is(
    await handleTokenAuthRequest(req, res, next),
    'response-from-boom-badRequest'
  );
});

test('s3credentials() with just a username sends the correct request to the Lambda function', async (t) => {
  let lambdaInvocationCount = 0;

  const fakeLambda = {
    invoke: ({ Payload }) => {
      lambdaInvocationCount += 1;

      const parsedPayload = JSON.parse(Payload);

      t.is(parsedPayload.userid, 'my-user-name');
      t.is(parsedPayload.rolesession, 'my-user-name');

      return {
        promise: async () => ({
          Payload: JSON.stringify({}),
        }),
      };
    },
  };

  const req = {
    authorizedMetadata: {
      userName: 'my-user-name',
    },
    lambda: fakeLambda,
  };

  const res = {
    // eslint-disable-next-line lodash/prefer-noop
    send() {},
  };

  await s3credentials(req, res);

  t.is(lambdaInvocationCount, 1);
});

test('s3credentials() with a username and a client name sends the correct request to the Lambda function', async (t) => {
  let lambdaInvocationCount = 0;

  const fakeLambda = {
    invoke: ({ Payload }) => {
      lambdaInvocationCount += 1;

      const parsedPayload = JSON.parse(Payload);

      t.is(parsedPayload.userid, 'my-user-name');
      t.is(parsedPayload.rolesession, 'my-user-name@my-client-name');

      return {
        promise: async () => ({
          Payload: JSON.stringify({}),
        }),
      };
    },
  };

  const req = {
    authorizedMetadata: {
      userName: 'my-user-name',
      clientName: 'my-client-name',
    },
    lambda: fakeLambda,
  };

  const res = {
    // eslint-disable-next-line lodash/prefer-noop
    send() {},
  };

  await s3credentials(req, res);

  t.is(lambdaInvocationCount, 1);
});
