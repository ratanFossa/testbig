'use strict';

const test = require('ava');
const { dynamodb } = require('@cumulus/aws-client/services');
const DynamoDb = require('@cumulus/aws-client/DynamoDb');
const { randomString } = require('@cumulus/common/test-utils');

const Manager = require('../../models/base');

test.beforeEach(async (t) => {
  t.context.tableName = randomString();

  const tableHash = { name: 'id', type: 'S' };
  t.context.manager = new Manager({
    tableName: t.context.tableName,
    tableHash,
  });

  await DynamoDb.createAndWaitForDynamoDbTable({
    TableName: t.context.tableName,
    AttributeDefinitions: [{
      AttributeName: tableHash.name,
      AttributeType: tableHash.type,
    }],
    KeySchema: [{
      AttributeName: tableHash.name,
      KeyType: 'HASH',
    }],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5,
    },
  });
});

test.afterEach.always(
  (t) =>
    DynamoDb.deleteAndWaitForDynamoDbTableNotExists({ TableName: t.context.tableName })
);

test('The Manager constructor throws an exception if the tableName property is not set', (t) => {
  t.throws(
    () => (new Manager({ tableHash: {} })),
    { instanceOf: TypeError }
  );
});

test('The Manager constructor throws an exception if the tableHash property is not set', (t) => {
  t.throws(
    () => (new Manager({ tableName: 'asdf' })),
    { instanceOf: TypeError }
  );
});

test('Manager.createTable() creates the correct table', async (t) => {
  const tableName = randomString();
  const manager = new Manager({
    tableName,
    tableHash: { name: 'id', type: 'S' },
  });

  try {
    await manager.createTable();
    const describeTableResponse = await dynamodb().describeTable({
      TableName: tableName,
    }).promise();

    t.is(describeTableResponse.Table.TableStatus, 'ACTIVE');
  } finally {
    await DynamoDb.deleteAndWaitForDynamoDbTableNotExists({ TableName: tableName });
  }
});

test('The Manager deleteTable method deletes the correct table', async (t) => {
  const tableName = randomString();
  const manager = new Manager({
    tableName,
    tableHash: { name: 'id', type: 'S' },
  });

  await manager.createTable();
  const describeTableResponse = await dynamodb().describeTable({
    TableName: tableName,
  }).promise();

  t.is(describeTableResponse.Table.TableStatus, 'ACTIVE');

  await manager.deleteTable();

  try {
    await dynamodb().describeTable({ TableName: tableName }).promise();
    t.fail();
  } catch (error) {
    t.is(error.code, 'ResourceNotFoundException');
  }
});

test('Manager.exists() returns true when a record exists', async (t) => {
  const { tableName, manager } = t.context;

  const id = randomString();

  await dynamodb().putItem({
    TableName: tableName,
    Item: {
      id: { S: id },
    },
  }).promise();

  t.true(await manager.exists({ id }));
});

test('Manager.exists() returns false when a record does not exist', async (t) => {
  const { manager } = t.context;

  t.false(await manager.exists({ id: 'does-not-exist' }));
});

test('Manager._buildDocClientUpdateParams() returns null for an empty item', (t) => {
  const { manager } = t.context;
  t.is(manager._buildDocClientUpdateParams({
    item: {},
    itemKey: {},
  }), undefined);
});

test('Manager._buildDocClientUpdateParams() does not try to update the key fields', (t) => {
  const { manager } = t.context;

  const item = {
    id: 'value1',
    key: 'value2',
    foo: 'bar',
  };

  const actualParams = manager._buildDocClientUpdateParams({
    item,
    itemKey: { id: item.id, key: item.key },
  });

  t.false(Object.keys(actualParams.ExpressionAttributeNames).includes('#key1'));
  t.false(Object.keys(actualParams.ExpressionAttributeValues).includes(':key1'));
  t.false(actualParams.UpdateExpression.includes('key1'));

  t.false(Object.keys(actualParams.ExpressionAttributeNames).includes('#key2'));
  t.false(Object.keys(actualParams.ExpressionAttributeValues).includes(':key2'));
  t.false(actualParams.UpdateExpression.includes('key2'));
});

test('Manager._buildDocClientUpdateParams() does not try to update a value to `undefined`', (t) => {
  const { manager } = t.context;

  const itemKey = { id: 'value' };
  const item = {
    ...itemKey,
    foo: 'bar',
    wrong: undefined,
  };

  const actualParams = manager._buildDocClientUpdateParams({
    item,
    itemKey,
    mutableFieldNames: ['foo'],
  });

  t.false(Object.keys(actualParams.ExpressionAttributeNames).includes('#wrong'));
  t.false(Object.keys(actualParams.ExpressionAttributeValues).includes(':wrong'));
  t.false(actualParams.UpdateExpression.includes('wrong'));
});

test('Manager._buildDocClientUpdateParams() only updates specified fields', (t) => {
  const { manager } = t.context;

  const itemKey = { id: 'value' };
  const item = {
    ...itemKey,
    foo: 'bar',
    prop1: 'value1',
    prop2: 123,
    prop3: 'value3',
  };

  const actualParams = manager._buildDocClientUpdateParams({
    item,
    itemKey,
    mutableFieldNames: ['foo', 'prop1'],
  });

  t.true(actualParams.UpdateExpression.startsWith('SET '));
  t.false(actualParams.UpdateExpression.includes('REMOVE '));
  t.false(actualParams.UpdateExpression.includes('ADD '));
  t.false(actualParams.UpdateExpression.includes('DELETE '));

  t.is(actualParams.ExpressionAttributeNames['#foo'], 'foo');
  t.is(actualParams.ExpressionAttributeValues[':foo'], 'bar');
  t.true(actualParams.UpdateExpression.includes('#foo = :foo'));

  t.is(actualParams.ExpressionAttributeNames['#prop1'], 'prop1');
  t.is(actualParams.ExpressionAttributeValues[':prop1'], 'value1');
  t.true(actualParams.UpdateExpression.includes('#prop1 = :prop1'));

  t.is(actualParams.ExpressionAttributeNames['#prop2'], 'prop2');
  t.is(actualParams.ExpressionAttributeValues[':prop2'], 123);
  t.true(actualParams.UpdateExpression.includes('#prop2 = if_not_exists(#prop2, :prop2)'));

  t.is(actualParams.ExpressionAttributeNames['#prop3'], 'prop3');
  t.is(actualParams.ExpressionAttributeValues[':prop3'], 'value3');
  t.true(actualParams.UpdateExpression.includes('#prop3 = if_not_exists(#prop3, :prop3)'));
});
