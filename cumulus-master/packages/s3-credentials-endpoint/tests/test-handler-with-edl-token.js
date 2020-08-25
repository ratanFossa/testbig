'use strict';

const nock = require('nock');
const test = require('ava');
const proxyquire = require('proxyquire');

const lambdaResponsePayload = { a: 1 };

const { handler } = proxyquire(
  '..',
  {
    '@cumulus/aws-client/services': {
      lambda: () => ({
        invoke: () => ({
          promise: async () => ({
            Payload: JSON.stringify(lambdaResponsePayload),
          }),
        }),
      }),
    },
  }
);

test.before(async (t) => {
  t.context.callerClientId = 'caller-client-id';

  t.context.validToken = 'valid-token';
  t.context.invalidToken = 'invalid-token';

  process.env.DISTRIBUTION_REDIRECT_ENDPOINT = 'https://blah';
  process.env.EARTHDATA_BASE_URL = 'https://uat.urs.earthdata.nasa.gov';
  process.env.EARTHDATA_CLIENT_ID = 'this-client-id';
  process.env.EARTHDATA_CLIENT_PASSWORD = 'this-client-password';

  nock.disableNetConnect();

  const nockInterceptors = [
    {
      token: t.context.validToken,
      statusCode: 200,
      body: {
        uid: 'some-user',
      },
    },
    {
      token: t.context.invalidToken,
      statusCode: 403,
      body: {
        error: 'invalid_token',
        error_description: 'The token is either malformed or does not exist',
      },
    },
  ];

  nockInterceptors.forEach(({ token, statusCode, body }) => {
    nock(process.env.EARTHDATA_BASE_URL)
      .persist()
      .post(
        '/oauth/tokens/user',
        {
          token,
          client_id: process.env.EARTHDATA_CLIENT_ID,
          on_behalf_of: t.context.callerClientId,
        }
      )
      .reply(statusCode, body);
  });

  // The handler is using `awsServerlessExpress.proxy`, which starts the Express
  // server on a local socket. nock doesn't support sockets and assumes the
  // request is for localhost port 80
  nock.enableNetConnect('localhost:80');
});

test('GET /s3credentials with a valid EDL token and client id returns credentials', async (t) => {
  const event = {
    httpMethod: 'GET',
    path: '/s3credentials',
    headers: {
      'EDL-Client-Id': t.context.callerClientId,
      'EDL-Token': t.context.validToken,
    },
  };

  const response = await handler(event);

  t.is(response.statusCode, 200);

  t.deepEqual(
    JSON.parse(response.body),
    lambdaResponsePayload
  );
});

test('GET /s3credentials returns a 403 response for an invalid EDL token', async (t) => {
  const event = {
    httpMethod: 'GET',
    path: '/s3credentials',
    headers: {
      'EDL-Client-Id': t.context.callerClientId,
      'EDL-Token': t.context.invalidToken,
    },
  };

  const response = await handler(event);

  t.is(response.statusCode, 403);
});

test('GET /s3credentials forwards the X-Request-Id header to Earthdata Login', async (t) => {
  const event = {
    httpMethod: 'GET',
    path: '/s3credentials',
    headers: {
      'EDL-Client-Id': t.context.callerClientId,
      'EDL-Token': 'X-Request-Id-test',
      'X-Request-Id': 'test-x-request-id',
    },
  };

  const nockScope = nock(
    process.env.EARTHDATA_BASE_URL,
    {
      reqheaders: {
        'X-Request-Id': event.headers['X-Request-Id'],
      },
    }
  )
    .post(
      '/oauth/tokens/user',
      {
        token: event.headers['EDL-Token'],
        client_id: process.env.EARTHDATA_CLIENT_ID,
        on_behalf_of: t.context.callerClientId,
      }
    )
    .reply(200, {});

  await handler(event);

  t.true(nockScope.isDone());
});
