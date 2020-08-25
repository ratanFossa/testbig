'use strict';

const test = require('ava');

const {
  getExecutionUrlFromArn,
  getMessageExecutionArn,
  getMessageExecutionName,
  getMessageStateMachineArn,
  getStateMachineArnFromExecutionArn,
} = require('../Executions');

test('getExecutionUrlFromArn returns correct URL when no region environment variable is specified', (t) => {
  t.is(
    getExecutionUrlFromArn('fake-arn'),
    'https://console.aws.amazon.com/states/home?region=us-east-1'
      + '#/executions/details/fake-arn'
  );
});

test.serial('getExecutionUrlFromArn returns correct URL when a region environment variable is specified', (t) => {
  process.env.AWS_DEFAULT_REGION = 'fake-region';
  t.is(
    getExecutionUrlFromArn('fake-arn'),
    'https://console.aws.amazon.com/states/home?region=fake-region'
      + '#/executions/details/fake-arn'
  );
  delete process.env.AWS_DEFAULT_REGION;
});

test('getMessageExecutionName throws error if cumulus_meta.execution_name is missing', (t) => {
  t.throws(
    () => getMessageExecutionName(),
    { message: 'cumulus_meta.execution_name not set in message' }
  );
});

test('getMessageStateMachineArn throws error if cumulus_meta.state_machine is missing', (t) => {
  t.throws(
    () => getMessageStateMachineArn(),
    { message: 'cumulus_meta.state_machine not set in message' }
  );
});

test('getMessageExecutionArn returns correct execution ARN for valid message', (t) => {
  const cumulusMessage = {
    cumulus_meta: {
      state_machine: 'arn:aws:states:us-east-1:111122223333:stateMachine:HelloWorld-StateMachine',
      execution_name: 'my-execution-name',
    },
  };

  const executionArn = getMessageExecutionArn(cumulusMessage);

  t.is(
    executionArn,
    'arn:aws:states:us-east-1:111122223333:execution:HelloWorld-StateMachine:my-execution-name'
  );
});

test('getMessageExecutionArn returns null for an invalid message', (t) => {
  const executionArn = getMessageExecutionArn({});
  t.is(executionArn, null);
});

test('getStateMachineArnFromExecutionArn returns correct state machine ARN', (t) => {
  t.is(
    getStateMachineArnFromExecutionArn(
      'arn:aws:states:us-east-1:000000000000:execution:fake-Workflow:abcd-1234-efgh-5678'
    ),
    'arn:aws:states:us-east-1:000000000000:stateMachine:fake-Workflow'
  );
});

test('getStateMachineArnFromExecutionArn returns null for no input', (t) => {
  t.is(
    getStateMachineArnFromExecutionArn(),
    null
  );
});
