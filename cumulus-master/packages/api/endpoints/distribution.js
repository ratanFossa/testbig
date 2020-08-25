'use strict';

const urljoin = require('url-join');

const { getFileBucketAndKey } = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');
const { UnparsableFileLocationError } = require('@cumulus/errors');
const { URL } = require('url');

const { EarthdataLoginClient } = require('@cumulus/earthdata-login-client');
const { isLocalApi } = require('../lib/testUtils');
const { AccessToken } = require('../models');

// Running API locally will be on http, not https, so cookies
// should not be set to secure for local runs of the API.
const useSecureCookies = () => {
  if (isLocalApi()) {
    return false;
  }
  return true;
};

/**
 * Return a signed URL to an S3 object
 *
 * @param {Object} s3Client - an AWS S3 Service Object
 * @param {string} Bucket - the bucket of the requested object
 * @param {string} Key - the key of the requested object
 * @param {string} username - the username to add to the redirect url
 * @returns {string} a URL
 */
function getSignedS3Url(s3Client, Bucket, Key, username) {
  const signedUrl = s3Client.getSignedUrl('getObject', { Bucket, Key });

  const parsedSignedUrl = new URL(signedUrl);
  parsedSignedUrl.searchParams.set('x-EarthdataLoginUsername', username);

  return parsedSignedUrl.toString();
}

/**
 * Returns a configuration object
 *
 * @returns {Object} the configuration object needed to handle requests
 */
function getConfigurations() {
  const earthdataLoginClient = new EarthdataLoginClient({
    clientId: process.env.EARTHDATA_CLIENT_ID,
    clientPassword: process.env.EARTHDATA_CLIENT_PASSWORD,
    earthdataLoginUrl: process.env.EARTHDATA_BASE_URL || 'https://uat.urs.earthdata.nasa.gov/',
    redirectUri: process.env.DISTRIBUTION_REDIRECT_ENDPOINT,
  });

  return {
    accessTokenModel: new AccessToken(),
    authClient: earthdataLoginClient,
    distributionUrl: process.env.DISTRIBUTION_ENDPOINT,
    s3Client: s3(),
  };
}

/**
 * Responds to a redirect request
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function handleRedirectRequest(req, res) {
  const {
    accessTokenModel,
    authClient,
    distributionUrl,
  } = getConfigurations();

  const { code, state } = req.query;

  const getAccessTokenResponse = await authClient.getAccessToken(code);

  await accessTokenModel.create({
    accessToken: getAccessTokenResponse.accessToken,
    expirationTime: getAccessTokenResponse.expirationTime,
    refreshToken: getAccessTokenResponse.refreshToken,
    username: getAccessTokenResponse.username,
  });

  return res
    .cookie(
      'accessToken',
      getAccessTokenResponse.accessToken,
      {
        // expirationTime is in seconds but Date() expects milliseconds
        expires: new Date(getAccessTokenResponse.expirationTime * 1000),
        httpOnly: true,
        secure: useSecureCookies(),
      }
    )
    .set({ Location: urljoin(distributionUrl, state) })
    .status(307)
    .send('Redirecting');
}

/**
 * Responds to a file request
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function handleFileRequest(req, res) {
  const { s3Client } = getConfigurations();

  let fileBucket;
  let fileKey;
  try {
    [fileBucket, fileKey] = getFileBucketAndKey(req.params[0]);
  } catch (error) {
    if (error instanceof UnparsableFileLocationError) {
      return res.boom.notFound(error.message);
    }
    throw error;
  }

  const signedS3Url = getSignedS3Url(
    s3Client,
    fileBucket,
    fileKey,
    req.authorizedMetadata.userName
  );

  return res
    .status(307)
    .set({ Location: signedS3Url })
    .send('Redirecting');
}

module.exports = {
  getConfigurations,
  handleRedirectRequest,
  handleFileRequest,
};
