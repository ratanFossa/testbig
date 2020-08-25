'use strict';

const test = require('ava');
const rulesApi = require('../rules');

test.before(async (t) => {
  t.context.testPrefix = 'unitTestStack';
  t.context.testName = 'testRule';
  t.context.testRule = { some: 'ruleObject' };
  t.context.updateParams = '{ "Param1": "value 1" }';
  t.context.arn = 'testArn';
  t.context.testQuery = { testQueryKey: 'test query value' };
});

test('postRule calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'POST',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: '/rules',
      body: JSON.stringify(t.context.testRule),
    },
  };

  const callback = async (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(rulesApi.postRule({
    prefix: t.context.testPrefix,
    rule: t.context.testRule,
    callback,
  }));
});

test('updateRule calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'PUT',
      resource: '/{proxy+}',
      headers: {
        'Content-Type': 'application/json',
      },
      path: `/rules/${t.context.testName}`,
      body: JSON.stringify(t.context.updateParams),
    },
  };

  const callback = async (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(rulesApi.updateRule({
    prefix: t.context.testPrefix,
    ruleName: t.context.testName,
    updateParams: t.context.updateParams,
    callback,
  }));
});

test('listRules calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/rules',
      queryStringParameters: {},
    },
  };

  const callback = async (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(rulesApi.listRules({
    prefix: t.context.testPrefix,
    callback,
  }));
});

test('getRule calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/rules/${t.context.testName}`,
    },
  };

  const callback = async (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(rulesApi.getRule({
    prefix: t.context.testPrefix,
    ruleName: t.context.testName,
    callback,
  }));
});

test('deleteRule calls the callback with the expected object', async (t) => {
  const expected = {
    prefix: t.context.testPrefix,
    payload: {
      httpMethod: 'DELETE',
      resource: '/{proxy+}',
      path: `/rules/${t.context.testName}`,
    },
  };

  const callback = async (configObject) => {
    t.deepEqual(configObject, expected);
  };

  await t.notThrowsAsync(rulesApi.deleteRule({
    prefix: t.context.testPrefix,
    ruleName: t.context.testName,
    callback,
  }));
});

test('rerunRule calls the updateRule with the expected object', async (t) => {
  const expected = {
    httpMethod: 'PUT',
    resource: '/{proxy+}',
    headers: {
      'Content-Type': 'application/json',
    },
    path: `/rules/${t.context.testName}`,
    body: JSON.stringify({ action: 'rerun' }),
  };

  const callback = async ({ payload }) => {
    t.deepEqual(payload, expected);
  };

  await t.notThrowsAsync(rulesApi.rerunRule({
    prefix: t.context.testPrefix,
    ruleName: t.context.testName,
    callback,
  }));
});
