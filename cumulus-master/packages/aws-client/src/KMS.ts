/**
 * @module KMS
 */

import { kms } from './services';

/**
 * Create a KMS key
 *
 * See https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/KMS.html#createKey-property
 * for allowed params and return value.
 *
 * @param {Object} params
 * @returns {Promise<Object>}
 */
export const createKey = (params: AWS.KMS.CreateKeyRequest = {}) =>
  kms().createKey(params).promise();

/**
 * Encrypt a string using KMS
 *
 * @param {string} KeyId - the KMS key to use for encryption
 * @param {string} Plaintext - the string to be encrypted
 * @returns {Promise<string>} the Base 64 encoding of the encrypted value
 */
export const encrypt = async (KeyId: string, Plaintext: string) => {
  const { CiphertextBlob } = await kms().encrypt({ KeyId, Plaintext }).promise();

  if (CiphertextBlob === undefined) throw new Error('Returned CiphertextBlob is undefined');

  return CiphertextBlob.toString('base64');
};

/**
 * Decrypt a KMS-encrypted string, Base 64 encoded
 *
 * @param {string} ciphertext - a KMS-encrypted value, Base 64 encoded
 * @returns {string} the plaintext
 */
export const decryptBase64String = async (ciphertext: string) => {
  const { Plaintext } = await kms().decrypt({
    CiphertextBlob: Buffer.from(ciphertext, 'base64'),
  }).promise();

  if (Plaintext === undefined) return undefined;

  return Plaintext.toString();
};
