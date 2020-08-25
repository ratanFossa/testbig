/* This code is copied from sat-api-lib library
 * with some alterations.
 * source: https://raw.githubusercontent.com/sat-utils/sat-api-lib/master/libs/aggregations.js
 */

'use strict';

const ES_MAX_AGG = 2147483647;

function date(field) {
  return {
    scenes_by_date: {
      date_histogram: {
        format: 'YYYY-MM-dd',
        interval: 'day',
        field: field,
        order: { _key: 'desc' },
      },
    },
  };
}

function term(field) {
  const aggs = {};

  aggs[`terms_${field}`] = {
    terms: {
      field: field,
      size: ES_MAX_AGG,
    },
  };

  return aggs;
}

module.exports.date = date;
module.exports.term = term;
