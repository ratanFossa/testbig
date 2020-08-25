'use strict';

const get = require('lodash/get');
const Ajv = require('ajv');
const pWaitFor = require('p-wait-for');
const awsServices = require('@cumulus/aws-client/services');
const DynamoDb = require('@cumulus/aws-client/DynamoDb');
const { RecordDoesNotExist } = require('@cumulus/errors');
const { inTestMode } = require('@cumulus/common/test-utils');
const { errorify } = require('../lib/utils');

async function enableStream(tableName) {
  const params = {
    TableName: tableName,
    StreamSpecification: {
      StreamEnabled: true,
      StreamViewType: 'NEW_AND_OLD_IMAGES',
    },
  };

  await awsServices.dynamodb().updateTable(params).promise();

  await pWaitFor(
    async () =>
      awsServices.dynamodb().describeTable({ TableName: tableName }).promise()
        .then((response) => response.TableStatus !== 'UPDATING'),
    { interval: 5 * 1000 }
  );
}

async function createTable(tableName, hash, range, attributes, indexes) {
  const params = {
    TableName: tableName,
    AttributeDefinitions: [{
      AttributeName: hash.name,
      AttributeType: hash.type,
    }],
    KeySchema: [{
      AttributeName: hash.name,
      KeyType: 'HASH',
    }],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5,
    },
    ...indexes,
  };

  if (range) {
    params.KeySchema.push({
      AttributeName: range.name,
      KeyType: 'RANGE',
    });

    params.AttributeDefinitions.push({
      AttributeName: range.name,
      AttributeType: range.type,
    });
  }

  if (attributes) {
    attributes.forEach((attribute) => {
      params.AttributeDefinitions.push({
        AttributeName: attribute.name,
        AttributeType: attribute.type,
      });
    });
  }

  const output = await awsServices.dynamodb().createTable(params).promise();
  await awsServices.dynamodb().waitFor('tableExists', { TableName: tableName }).promise();

  if (!inTestMode()) await enableStream(tableName);

  return output;
}

async function deleteTable(tableName) {
  const output = await awsServices.dynamodb().deleteTable({
    TableName: tableName,
  }).promise();

  await awsServices.dynamodb().waitFor('tableNotExists', { TableName: tableName }).promise();
  return output;
}

/**
 * The manager class handles basic operations on a given DynamoDb table
 */
class Manager {
  static recordIsValid(item, schema, removeAdditional = false) {
    if (!schema) {
      throw new Error('schema is not defined');
    }

    const schemaWithAdditionalPropertiesProhibited = JSON.parse(
      JSON.stringify(
        schema,
        (_, value) => {
          if (value.type === 'object') {
            return {
              additionalProperties: false,
              ...value,
            };
          }

          return value;
        }
      )
    );

    const ajv = new Ajv({
      removeAdditional,
      useDefaults: true,
      v5: true,
    });
    const validate = ajv.compile(schemaWithAdditionalPropertiesProhibited);
    const valid = validate(item);
    if (!valid) {
      const err = new Error(`The record has validation errors: ${JSON.stringify(validate.errors)}`);
      err.name = 'SchemaValidationError';
      err.detail = JSON.stringify(validate.errors);
      throw err;
    }
  }

  /**
   * Constructor of Manager class
   *
   * @param {Object} params - params
   * @param {string} params.tableName - (required) the name of the DynamoDB
   *   table associated with this model
   * @param {Object} params.tableHash - (required) an object containing "name"
   *   and "type" properties, which specify the partition key of the DynamoDB
   *   table.
   * @param {Object} params.tableRange - an object containing "name" and "type"
   *   properties, which specify the sort key of the DynamoDB table.
   * @param {Object} params.tableAttributes - list of objects containing "name"
   *   and "type" properties, which specifies additional table attributes for
   *   attribute definitions besides tableHash and tableRange
   * @param {Object} params.tableIndexes - an object containing definition of indexes,
   *   such as GlobalSecondaryIndexes, LocalSecondaryIndexes
   * @param {Object} params.schema - the JSON schema to validate the records
   *   against.
   * @param {boolean} [params.validate=true] - whether items should be validated
   *   before being written to the database.  The _only_ time this should ever
   *   be set to false is when restoring from a backup, and that code is already
   *   written.  So no other time.  Don't even think about it.  I know you're
   *   going to say, "but it's only for this one test case".  No.
   *   Find another way.
   */
  constructor(params = {}) {
    // Make sure all required parameters are present
    if (!params.tableName) throw new TypeError('params.tableName is required');
    if (!params.tableHash) throw new TypeError('params.tableHash is required');

    this.tableName = params.tableName;
    this.tableHash = params.tableHash;
    this.tableRange = params.tableRange;
    this.tableAttributes = params.tableAttributes;
    this.tableIndexes = params.tableIndexes;
    this.schema = params.schema;
    this.dynamodbDocClient = awsServices.dynamodbDocClient({ convertEmptyValues: true });
    this.removeAdditional = false;

    this.validate = get(params, 'validate', true);
  }

  /**
   * Create the DynamoDB table associated with a model
   *
   * @returns {Promise} resolves when the table exists
   */
  createTable() {
    return createTable(
      this.tableName, this.tableHash, this.tableRange, this.tableAttributes, this.tableIndexes
    );
  }

  /**
   * Delete the DynamoDB table associated with a model
   *
   * @returns {Promise} resolves when the table no longer exists
   */
  deleteTable() {
    return deleteTable(this.tableName);
  }

  /**
   * Check if an item exists
   *
   * @param {Object} Key - the key to check for
   * @returns {boolean}
   */
  async exists(Key) {
    try {
      await this.get(Key);
      return true;
    } catch (error) {
      if (error instanceof RecordDoesNotExist) return false;

      throw error;
    }
  }

  /**
   * Enable DynamoDB streams on the table
   *
   * @returns {Promise} resolves when streams are enabled
   */
  enableStream() {
    return enableStream(this.tableName);
  }

  /**
   * Gets the item if found. If the record does not exist
   * the function throws RecordDoesNotExist error
   *
   * @param {Object} item - the item to search for
   * @returns {Promise} The record found
   */
  async get(item) {
    return DynamoDb.get({
      tableName: this.tableName,
      item,
      client: this.dynamodbDocClient,
      getParams: { ConsistentRead: true },
    });
  }

  async batchGet(items, attributes) {
    const params = {
      RequestItems: {
        [this.tableName]: {
          Keys: items,
        },
      },
    };

    if (attributes) {
      params.RequestItems[this.tableName].AttributesToGet = attributes;
    }

    return this.dynamodbDocClient.batchGet(params).promise();
  }

  async batchWrite(deletes, puts = []) {
    const deleteRequests = (deletes || []).map((Key) => ({
      DeleteRequest: { Key },
    }));

    const now = Date.now();
    const putsWithTimestamps = puts.map((item) => ({
      createdAt: now,
      ...item,
      updatedAt: now,
    }));

    if (this.validate) {
      putsWithTimestamps.forEach((item) => {
        this.constructor.recordIsValid(item, this.schema, this.removeAdditional);
      });
    }

    const putRequests = putsWithTimestamps.map((Item) => ({
      PutRequest: { Item },
    }));

    const requests = deleteRequests.concat(putRequests);

    if (requests > 25) {
      throw new Error('Batch Write supports 25 or fewer bulk actions at the same time');
    }

    const params = {
      RequestItems: {
        [this.tableName]: requests,
      },
    };

    return this.dynamodbDocClient.batchWrite(params).promise();
  }

  /**
   * creates record(s)
   *
   * @param {Object<Array|Object>} items - the Item/Items to be added to the database
   * @returns {Promise<Array|Object>} an array of created records or a single
   *   created record
   */
  async create(items) {
    // This is confusing because the argument named "items" could either be
    // an Array of items  or a single item.  To make this function a little
    // easier to understand, converting the single item case here to an array
    // containing one item.
    const itemsArray = Array.isArray(items) ? items : [items];

    // For each item, set the updatedAt property.  If it does not have a
    // createdAt property, set that as well.  Instead of modifying the original
    // item, this returns an updated copy of the item.
    const itemsWithTimestamps = itemsArray.map((item) => {
      const now = Date.now();

      return {
        createdAt: now,
        ...item,
        updatedAt: now,
      };
    });

    if (this.validate) {
      // Make sure that all of the items are valid
      itemsWithTimestamps.forEach((item) => {
        this.constructor.recordIsValid(item, this.schema, this.removeAdditional);
      });
    }

    // Suggested method of handling a loop containing an await, according to
    // https://codeburst.io/javascript-async-await-with-foreach-b6ba62bbf404
    for (let i = 0; i < itemsWithTimestamps.length; i += 1) {
      await this.dynamodbDocClient.put({ // eslint-disable-line no-await-in-loop
        TableName: this.tableName,
        Item: itemsWithTimestamps[i],
      }).promise();
    }

    // If the original item was an Array, return an Array.  If the original item
    // was an Object, return an Object.
    return Array.isArray(items) ? itemsWithTimestamps : itemsWithTimestamps[0];
  }

  async scan(query, fields, limit, select, startKey) {
    return DynamoDb.scan({
      tableName: this.tableName,
      client: this.dynamodbDocClient,
      query,
      fields,
      limit,
      select,
      startKey,
    });
  }

  async delete(item) {
    const params = {
      TableName: this.tableName,
      Key: item,
    };

    return this.dynamodbDocClient.delete(params).promise();
  }

  async update(itemKeys, updates = {}, fieldsToDelete = []) {
    const actualUpdates = {
      ...updates,
      updatedAt: Date.now(),
    };

    // Make sure that we don't update the key fields
    Object.keys(itemKeys).forEach((property) => delete actualUpdates[property]);
    // Make sure we don't delete required fields
    const optionalFieldsToDelete = fieldsToDelete.filter((f) =>
      !this.schema.required.includes(f));

    const currentItem = await this.get(itemKeys);
    const updatedItem = {
      ...currentItem,
      ...updates,
    };

    optionalFieldsToDelete.forEach((f) => {
      delete updatedItem[f];
      delete actualUpdates[f];
    });

    if (this.validate) {
      this.constructor.recordIsValid(
        updatedItem,
        this.schema,
        this.removeAdditional
      );
    }

    // Build the actual update request
    const attributeUpdates = {};
    Object.keys(actualUpdates).forEach((property) => {
      attributeUpdates[property] = {
        Action: 'PUT',
        Value: actualUpdates[property],
      };
    });

    // Add keys to be deleted
    optionalFieldsToDelete.forEach((property) => {
      attributeUpdates[property] = { Action: 'DELETE' };
    });

    // Perform the update
    const updateResponse = await this.dynamodbDocClient.update({
      TableName: this.tableName,
      Key: itemKeys,
      ReturnValues: 'ALL_NEW',
      AttributeUpdates: attributeUpdates,
    }).promise();

    return updateResponse.Attributes;
  }

  /**
   * Updates the status field
   *
   * @param {Object} key - the key to update
   * @param {string} status - the new status
   * @returns {Promise} the updated record
   */
  updateStatus(key, status) {
    return this.update(key, { status });
  }

  /**
   * Marks the record is failed with proper status
   * and error message
   *
   * @param {Object} key - the key to update
   * @param {Object} err - the error object
   * @returns {Promise} the updated record
   */
  hasFailed(key, err) {
    return this.update(
      key,
      { status: 'failed', error: errorify(err), isActive: false }
    );
  }

  /**
   * Build the parameters for dynamodbDocClient.update(). Allows conditional
   * updating of fields based on specification of which fields should be
   * mutable. Fields not specified as mutable will be set to only update if
   * there is not already an existing value.
   *
   * @param {Object} params
   * @param {Object} params.item - The data item to be updated
   * @param {Object} params.itemKey
   *   Object containing the unique key(s) identifying the item
   * @param {Array} params.mutableFieldNames
   *   Array of field names which should be mutable (updated even if there is an existing value)
   * @returns {Object} - Parameters for dynamodbDocClient.update() operation
   */
  _buildDocClientUpdateParams({
    item,
    itemKey,
    mutableFieldNames = [],
  }) {
    const ExpressionAttributeNames = {};
    const ExpressionAttributeValues = {};
    const setUpdateExpressions = [];

    const itemKeyFieldNames = Object.keys(itemKey);

    Object.entries(item).forEach(([fieldName, value]) => {
      if (itemKeyFieldNames.includes(fieldName)) return;
      if (value === undefined) return;

      ExpressionAttributeNames[`#${fieldName}`] = fieldName;
      ExpressionAttributeValues[`:${fieldName}`] = value;

      if (mutableFieldNames.includes(fieldName)) {
        setUpdateExpressions.push(`#${fieldName} = :${fieldName}`);
      } else {
        setUpdateExpressions.push(`#${fieldName} = if_not_exists(#${fieldName}, :${fieldName})`);
      }
    });

    if (setUpdateExpressions.length === 0) return undefined;

    return {
      TableName: this.tableName,
      Key: itemKey,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
      UpdateExpression: `SET ${setUpdateExpressions.join(', ')}`,
    };
  }
}

module.exports = Manager;
