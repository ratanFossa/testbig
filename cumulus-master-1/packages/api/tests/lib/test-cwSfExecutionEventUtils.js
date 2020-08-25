'use strict';

const test = require('ava');
const rewire = require('rewire');
const cwSfExecutionEventUtils = rewire('../../lib/cwSfExecutionEventUtils');

const getFailedExecutionMessage = cwSfExecutionEventUtils.__get__('getFailedExecutionMessage');
const getCumulusMessageFromExecutionEvent = cwSfExecutionEventUtils.__get__('getCumulusMessageFromExecutionEvent');

test.serial('getFailedExecutionMessage() returns the Cumulus message from the output of the last failed step', async (t) => {
  const inputMessage = {
    cumulus_meta: {
      state_machine: 'arn:aws:states:us-east-1:111122223333:stateMachine:HelloWorld-StateMachine',
      execution_name: 'my-execution-name',
    },
  };

  const failedTaskOutput = { a: 1 };

  const result = await cwSfExecutionEventUtils.__with__({
    StepFunctions: {
      getExecutionHistory: ({ executionArn }) => {
        if (executionArn !== 'arn:aws:states:us-east-1:111122223333:execution:HelloWorld-StateMachine:my-execution-name') {
          throw new Error(`Expected executionArn === 'arn:aws:states:us-east-1:111122223333:execution:HelloWorld-StateMachine:my-execution-name' but got ${executionArn}`);
        }
        return {
          events: [
            {
              // lastStepFailedEvent
              type: 'LambdaFunctionFailed',
              id: 1,
            },
            {
              // failedStepExitedEvent
              type: 'TaskStateExited',
              previousEventId: 1,
              stateExitedEventDetails: {
                output: JSON.stringify(failedTaskOutput),
              },
              resource: 'x',
            },
          ],
        };
      },
    },
  })(() => getFailedExecutionMessage(inputMessage));

  t.deepEqual(result, failedTaskOutput);
});

test.serial('getFailedExecutionMessage() returns the input message if there is an error fetching the output of the last failed step', async (t) => {
  // This invalid message will cause getFailedExecutionMessage to fail because
  // it does not contain cumulus_meta.state_machine or cumulus_meta.execution_name
  const inputMessage = { a: 1 };

  const actualResult = await getFailedExecutionMessage(inputMessage);

  t.deepEqual(actualResult, inputMessage);
});

test.serial('getFailedExecutionMessage() returns the input message when no ActivityFailed or LambdaFunctionFailed events are found in the execution history', async (t) => {
  const inputMessage = {
    cumulus_meta: {
      state_machine: 'arn:aws:states:us-east-1:111122223333:stateMachine:HelloWorld-StateMachine',
      execution_name: 'my-execution-name',
    },
  };

  const actualResult = await cwSfExecutionEventUtils.__with__({
    StepFunctions: {
      getExecutionHistory: ({ executionArn }) => {
        if (executionArn !== 'arn:aws:states:us-east-1:111122223333:execution:HelloWorld-StateMachine:my-execution-name') {
          throw new Error(`Expected executionArn === 'arn:aws:states:us-east-1:111122223333:execution:HelloWorld-StateMachine:my-execution-name' but got ${executionArn}`);
        }
        return {
          events: [],
        };
      },
    },
  })(() => getFailedExecutionMessage(inputMessage));

  t.deepEqual(actualResult, inputMessage);
});

test.serial('getFailedExecutionMessage() returns the input message with the details from the last failed lambda step event in the exception field if the failed step exited event cannot be found', async (t) => {
  const inputMessage = {
    cumulus_meta: {
      state_machine: 'arn:aws:states:us-east-1:111122223333:stateMachine:HelloWorld-StateMachine',
      execution_name: 'my-execution-name',
    },
  };

  const actualResult = await cwSfExecutionEventUtils.__with__({
    StepFunctions: {
      getExecutionHistory: ({ executionArn }) => {
        if (executionArn !== 'arn:aws:states:us-east-1:111122223333:execution:HelloWorld-StateMachine:my-execution-name') {
          throw new Error(`Expected executionArn === 'arn:aws:states:us-east-1:111122223333:execution:HelloWorld-StateMachine:my-execution-name' but got ${executionArn}`);
        }
        return {
          events: [
            {
              // lastStepFailedEvent
              type: 'LambdaFunctionFailed',
              id: 1,
              lambdaFunctionFailedEventDetails: {
                type: 'really bad',
              },
            },
          ],
        };
      },
    },
  })(() => getFailedExecutionMessage(inputMessage));

  const expectedResult = {
    ...inputMessage,
    exception: {
      type: 'really bad',
    },
  };

  t.deepEqual(actualResult, expectedResult);
});

test.serial('getFailedExecutionMessage() returns the input message with the details from the last failed activity step event in the exception field if the failed step exited event cannot be found', async (t) => {
  const inputMessage = {
    cumulus_meta: {
      state_machine: 'arn:aws:states:us-east-1:111122223333:stateMachine:HelloWorld-StateMachine',
      execution_name: 'my-execution-name',
    },
  };

  const actualResult = await cwSfExecutionEventUtils.__with__({
    StepFunctions: {
      getExecutionHistory: ({ executionArn }) => {
        if (executionArn !== 'arn:aws:states:us-east-1:111122223333:execution:HelloWorld-StateMachine:my-execution-name') {
          throw new Error(`Expected executionArn === 'arn:aws:states:us-east-1:111122223333:execution:HelloWorld-StateMachine:my-execution-name' but got ${executionArn}`);
        }
        return {
          events: [
            {
              // lastStepFailedEvent
              type: 'ActivityFailed',
              id: 1,
              activityFailedEventDetails: {
                reason: 'busted',
              },
            },
          ],
        };
      },
    },
  })(() => getFailedExecutionMessage(inputMessage));

  const expectedResult = {
    ...inputMessage,
    exception: {
      reason: 'busted',
    },
  };

  t.deepEqual(actualResult, expectedResult);
});

test('getCumulusMessageFromExecutionEvent() returns the event input for a RUNNING event', async (t) => {
  const event = {
    detail: {
      status: 'RUNNING',
      input: JSON.stringify({
        cumulus_meta: {
          workflow_start_time: 122,
        },
      }),
      startDate: 123,
      stopDate: null,
    },
  };

  const message = await getCumulusMessageFromExecutionEvent(event);

  const expectedMessage = {
    cumulus_meta: {
      workflow_start_time: 122,
      workflow_stop_time: null,
    },
    meta: {
      status: 'running',
    },
  };

  t.deepEqual(message, expectedMessage);
});

test('getCumulusMessageFromExecutionEvent() returns the event output for a SUCCEEDED event', async (t) => {
  const event = {
    detail: {
      status: 'SUCCEEDED',
      output: JSON.stringify({
        cumulus_meta: {
          workflow_start_time: 122,
        },
      }),
      startDate: 123,
      stopDate: 124,
    },
  };

  const message = await getCumulusMessageFromExecutionEvent(event);

  const expectedMessage = {
    cumulus_meta: {
      workflow_start_time: 122,
      workflow_stop_time: 124,
    },
    meta: {
      status: 'completed',
    },
  };

  t.deepEqual(message, expectedMessage);
});

test.serial('getCumulusMessageFromExecutionEvent() returns the failed execution message for a failed event', async (t) => {
  const input = {
    cumulus_meta: {
      state_machine: 'arn:aws:states:us-east-1:111122223333:stateMachine:HelloWorld-StateMachine',
      execution_name: 'my-execution-name',
      workflow_start_time: 122,
    },
  };

  const event = {
    detail: {
      status: 'FAILED',
      input: JSON.stringify(input),
      startDate: 123,
      stopDate: 124,
    },
  };

  const failedTaskOutput = input;

  const message = await cwSfExecutionEventUtils.__with__({
    StepFunctions: {
      getExecutionHistory: ({ executionArn }) => {
        if (executionArn !== 'arn:aws:states:us-east-1:111122223333:execution:HelloWorld-StateMachine:my-execution-name') {
          throw new Error(`Expected executionArn === 'arn:aws:states:us-east-1:111122223333:execution:HelloWorld-StateMachine:my-execution-name' but got ${executionArn}`);
        }
        return {
          events: [
            {
              // lastStepFailedEvent
              type: 'LambdaFunctionFailed',
              id: 1,
            },
            {
              // failedStepExitedEvent
              type: 'TaskStateExited',
              previousEventId: 1,
              stateExitedEventDetails: {
                output: JSON.stringify(failedTaskOutput),
              },
              resource: 'x',
            },
          ],
        };
      },
    },
    pullStepFunctionEvent: async () => input,
  })(() => getCumulusMessageFromExecutionEvent(event));

  const expectedMessage = {
    cumulus_meta: {
      state_machine: 'arn:aws:states:us-east-1:111122223333:stateMachine:HelloWorld-StateMachine',
      execution_name: 'my-execution-name',
      workflow_start_time: 122,
      workflow_stop_time: 124,
    },
    meta: {
      status: 'failed',
    },
  };

  t.deepEqual(message, expectedMessage);
});
