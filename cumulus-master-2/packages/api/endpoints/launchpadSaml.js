'use strict';

const saml2 = require('saml2-js');
const got = require('got');
const { JSONPath } = require('jsonpath-plus');
const { parseString } = require('xml2js');
const { promisify } = require('util');
const flatten = require('lodash/flatten');
const get = require('lodash/get');
const moment = require('moment');

const {
  getS3Object,
  parseS3Uri,
  s3ObjectExists,
  s3PutObject,
} = require('@cumulus/aws-client/S3');
const log = require('@cumulus/common/log');

const { AccessToken } = require('../models');
const { createJwtToken } = require('../lib/token');

const parseXmlString = promisify(parseString);

/**
 * launchpad idp metadata s3 uri
 * @returns {string} - s3 location of launchpad idp metadata
 */
const launchpadMetadataS3Uri = () => (
  `s3://${process.env.system_bucket}/${process.env.stackName}/crypto/launchpadMetadata.xml`
);

/**
 * download launchpad's idp metadata to s3
 *
 * @param {string} launchpadPublicMetadataPath - launchpad metadata s3 uri
 * @returns {Promise<undefined>} resolves when the file has been downloaded
 */
const downloadLaunchpadPublicMetadata = async (launchpadPublicMetadataPath) => {
  const launchpadMetadataUrl = process.env.LAUNCHPAD_METADATA_URL;
  const { Bucket, Key } = parseS3Uri(launchpadPublicMetadataPath);
  try {
    const urlResponse = await got.get(launchpadMetadataUrl);
    const launchpadMetadataFromUrl = urlResponse.body;
    const params = { Bucket, Key, Body: launchpadMetadataFromUrl };
    await s3PutObject(params);
    log.debug('Downloaded the launchpad metadata to s3');
  } catch (error) {
    error.message = `Unable to download the launchpad metadata to s3 ${error}`;
    throw error;
  }
};

/**
 * reads public metadata file from S3 path and returns the X509Certificate value
 *
 * The XML file is a copy of the launchpad's idp metadata found here for the sandbox
 * https://auth.launchpad-sbx.nasa.gov/unauth/metadata/launchpad-sbx.idp.xml
 *
 * @param {string} launchpadPublicMetadataPath - launchpad metadata s3 uri
 * @returns {Promise<Array>} Array containing the X509Certificate from the input metadata file.
 */
const launchpadPublicCertificate = async (launchpadPublicMetadataPath) => {
  let launchpadMetatdataXML;
  const { Bucket, Key } = parseS3Uri(launchpadPublicMetadataPath);
  try {
    if (!(await s3ObjectExists({ Bucket, Key }))) {
      await downloadLaunchpadPublicMetadata(launchpadPublicMetadataPath);
    }
    const s3Object = await getS3Object(Bucket, Key);
    launchpadMetatdataXML = s3Object.Body.toString();
  } catch (error) {
    if (error.code === 'NoSuchKey' || error.code === 'NoSuchBucket') {
      error.message = `Cumulus could not find Launchpad public xml metadata at ${launchpadPublicMetadataPath}`;
    }
    throw error;
  }
  const metadata = await parseXmlString(launchpadMetatdataXML);
  const certificate = JSONPath({ wrap: false }, '$..ns1:X509Certificate', metadata);
  if (certificate) return flatten(certificate);
  throw new Error(
    `Failed to retrieve Launchpad metadata X509 Certificate from ${launchpadPublicMetadataPath}`
  );
};

/**
 * Validates the SAML user Group includes the configured authorized User Group.
 *
 * @param {string} samlUserGroup -  Saml response string e.g.:
       'cn=wrongUserGroup,ou=254886,ou=ROLES,ou=Groups,dc=nasa,dc=gov'.
 * @param {string} authorizedGroup - Cumulus oauth user group.
 * @returns {boolean} True if samlUserGroup includes the authorizedUserGroup.
 */
const authorizedUserGroup = (samlUserGroup, authorizedGroup) => {
  const matcher = new RegExp(`cn=${authorizedGroup}`);
  return matcher.test(samlUserGroup);
};

/**
 * Retrieve user and session information from SAML response.
 *
 * @param {Object} samlResponse - Post assert object returned from SAML identity provider.
 * @returns {Object} object containing username and accessToken retrieved from SAML response.
 */
const parseSamlResponse = (samlResponse) => {
  let username;
  let accessToken;
  let userGroups;
  try {
    const attributes = samlResponse.user.attributes;
    username = get(attributes, 'UserId', get(attributes, 'UserID'))[0];
    accessToken = samlResponse.user.session_index;
    userGroups = samlResponse.user.attributes.userGroup;
  } catch (error) {
    throw new Error(
      `invalid SAML response received ${JSON.stringify(samlResponse)}`
    );
  }

  const validGroups = userGroups.filter((userGroup) =>
    authorizedUserGroup(userGroup, process.env.oauth_user_group));
  if (validGroups.length === 0) {
    throw new Error(
      `User not authorized for this application ${username} not a member of userGroup: ${process.env.oauth_user_group}`
    );
  }

  return { username, accessToken };
};

/**
 * Store the SAML response's token in the AccessResponse table and return a JWT
 * from the derived values.
 *
 * @param {Object} samlResponse - post_assert response from saml IDP provider
 *
 * @returns {Promise<Object>} - a valid JWT token that can be used for authentication.
 */
const buildLaunchpadJwt = async (samlResponse) => {
  const { username, accessToken } = parseSamlResponse(samlResponse);
  // expires in 1 hour
  const expirationTime = moment().unix() + 60 * 60;
  const accessTokenModel = new AccessToken();
  await accessTokenModel.create({ accessToken, expirationTime, username });
  return createJwtToken({ accessToken, expirationTime, username });
};

/**
 * convenience function to set up SAML Identity and Service Providers
 */
const prepareSamlProviders = async () => {
  const LaunchpadX509Certificate = await launchpadPublicCertificate(launchpadMetadataS3Uri());

  const spOptions = {
    entity_id: process.env.ENTITY_ID,
    assert_endpoint: process.env.ASSERT_ENDPOINT,
    force_authn: false,
    nameid_format: 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
    sign_get_request: false,
    allow_unencrypted_assertion: true,
  };

  const idpOptions = {
    sso_login_url: process.env.IDP_LOGIN,
    certificates: LaunchpadX509Certificate,
  };

  const idp = new saml2.IdentityProvider(idpOptions);
  const sp = new saml2.ServiceProvider(spOptions);

  return { idp, sp };
};

/**
 * Starting point for SAML SSO login
 *
 * Creates a login request url for a SAML Identity Provider and redirects to
 * that location.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Object} response redirect to the Identity Provider.
 */
const login = async (req, res) => {
  const { idp, sp } = await prepareSamlProviders();
  const relayState = req.query.RelayState;
  sp.create_login_request_url(
    idp,
    { relay_state: relayState },
    (err, loginUrl) => {
      if (err) {
        return res.boom.badRequest('Could not create login request url.', err);
      }
      return res.redirect(loginUrl);
    }
  );
};

/**
 *  SAML AssertionConsumerService (ACS) endpoint.
 *
 *  Receives and validates the POSTed response from Identity Provider Service.
 *  Returns to the RelayState url appending a valid samlResponse-based JWT
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Object} response redirect back to the initiating requests relay
 *                   state with a valid token query parameter.
 */
const auth = async (req, res) => {
  const { idp, sp } = await prepareSamlProviders();
  sp.post_assert(idp, { request_body: req.body }, async (err, samlResponse) => {
    if (err) {
      log.debug(`launchpadSaml.auth post assert error ${err}`);
      if (err.message && err.message.startsWith('SAML Assertion signature check failed!')) {
        return downloadLaunchpadPublicMetadata(launchpadMetadataS3Uri())
          .then(() => res.redirect(`${req.body.RelayState}`));
      }
      return res.boom.badRequest(`SAML post assert error ${err}`, err);
    }

    try {
      const LaunchpadJwtToken = await buildLaunchpadJwt(samlResponse);
      const Location = `${req.body.RelayState}/?token=${LaunchpadJwtToken}`;
      return res.redirect(Location);
    } catch (error) {
      return res.boom.badRequest(`Could not build JWT from SAML response ${error}`, error);
    }
  });
};

/**
 * Helper to pull the url the client sent from a request that has been updated
 * with middleware to include the event context.
 * @param {Object} req - express request object
 * @returns {Object} - The url the client visited to generate the request.
 */
const urlFromRequest = (req) =>
  `${req.protocol}://${req.get('host')}${req.apiGateway.event.requestContext.path}`;

/**
 * helper to grab stageName
 *
 * @param {Object} req - express request object
 * @returns {string} - stage name of apigateway
 */
const stageNameFromRequest = (req) => req.apiGateway.event.requestContext.stage;

/**
 * SAML Token endpoint.
 *
 * Simply returns the token received as a query parameter or redirects to saml
 * login to authenticate.
 * @param {Object} req - express request
 * @param {Object} res - express response
 * @returns {Object} - Either JWToken presented as a query string in the
 * request or a redirect back to saml/login endpoing to receive the token.
 */
const samlToken = async (req, res) => {
  let relayState;
  let stageName;
  try {
    relayState = encodeURIComponent(urlFromRequest(req));
    stageName = stageNameFromRequest(req);
    if (!relayState || !stageName) {
      throw new Error('Incorrect relayState or stageName information in express request.');
    }
  } catch (error) {
    return res.boom.expectationFailed(
      `Could not retrieve necessary information from express request object. ${error.message}`
    );
  }

  if (req.query.token) return res.send({ message: { token: req.query.token } });
  return res.redirect(`/${stageName}/saml/login?RelayState=${relayState}`);
};

const notImplemented = async (req, res) =>
  res.boom.notImplemented(
    `endpoint: "${req.path}" not implemented. Login with launchpad.`
  );

const refreshEndpoint = notImplemented;

module.exports = {
  auth,
  login,
  refreshEndpoint,
  samlToken,
};
