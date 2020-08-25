'use strict';

const { receiveSQSMessages, deleteSQSMessage } = require('@cumulus/aws-client/SQS');
const log = require('@cumulus/common/log');

class Consumer {
  constructor({
    queueUrl,
    messageLimit = 1,
    timeLimit = 90,
    visibilityTimeout,
    deleteProcessedMessage = true,
  }) {
    this.queueUrl = queueUrl;
    this.messageLimit = messageLimit;
    this.visibilityTimeout = visibilityTimeout;
    this.timeLimit = timeLimit * 1000;
    this.now = Date.now();
    this.timeLapsed = false;
    this.deleteProcessedMessage = deleteProcessedMessage;
  }

  async processMessage(message, fn) {
    try {
      await fn(message);
      if (this.deleteProcessedMessage) await deleteSQSMessage(this.queueUrl, message.ReceiptHandle);
      return 1;
    } catch (error) {
      log.error(error);
      return 0;
    }
  }

  async processMessages(fn, messageLimit, visibilityTimeout) {
    if (messageLimit > 10) throw new Error(`Cannot process more than 10 messages per function call. Received limit: ${messageLimit}`);

    let counter = 0;
    const messages = await receiveSQSMessages(
      this.queueUrl,
      { numOfMessages: messageLimit, visibilityTimeout }
    );
    if (messages.length > 0) {
      log.info(`processing ${messages.length} messages`);
      const processes = messages.map((message) => this.processMessage(message, fn));
      const results = await Promise.all(processes);
      counter = results.reduce((s, v) => s + v, 0);
    }
    return counter;
  }

  async consume(fn) {
    let messageLimit = this.messageLimit;
    log.info(`Attempting to process up to ${messageLimit} messages...`);

    let sum = 0;
    /* eslint-disable no-await-in-loop */
    // Only request up to the original messageLimit messages on subsequent `processMessages` calls
    while (messageLimit > 0 && !this.timeLapsed) {
      let results;
      if (messageLimit > 10) {
        results = await this.processMessages(fn, 10, this.visibilityTimeout);
        messageLimit -= 10;
      } else if (messageLimit > 0) {
        results = await this.processMessages(fn, messageLimit, this.visibilityTimeout);
        messageLimit -= messageLimit;
      }
      sum += results;
      // if the function is running for longer than the timeLimit, stop it
      const timeSpent = (Date.now() - this.now);
      if (timeSpent > this.timeLimit) {
        this.timeLapsed = true;
        log.warn(`${this.timeLimit / 1000}-second time limit reached, exiting...`);
      }
    }
    /* eslint-enable no-await-in-loop */

    log.info(`${sum} messages successfully processed from ${this.queueUrl}`);
    return sum;
  }
}

module.exports = {
  Consumer,
};
