/* eslint no-param-reassign: "off" */

/* This code is copied from sat-api-lib library
 * with some alterations.
 * source: https://raw.githubusercontent.com/sat-utils/sat-api-lib/master/libs/queries.js
 */

'use strict';

const omit = require('lodash/omit');

const regexes = {
  terms: /^(.*)__in$/,
  term: /^((?!__).)*$/,
  not: /^(.*)__not$/,
  exists: /^(.*)__exists$/,
  range: /^(.*)__(from|to)$/,
};

const queryFields = [
  'error',
  'granuleId',
  'id',
  'status',
  'pdrName',
  'msg',
  'name',
];

const build = {
  general: (params) => ({
    query_string: {
      query: params.q,
    },
  }),

  sort: (params) => {
    let sort;
    const { sort_by: sortBy, order, sort_key: sortKey } = params;

    if (sortBy && order) {
      sort = [{ [sortBy]: { order: order } }];
    } else if (sortKey && Array.isArray(sortKey)) {
      sort = sortKey.map((key) => ({
        [key.replace(/^[+-]/, '')]: { order: key.startsWith('-') ? 'desc' : 'asc' },
      }));
    } else {
      sort = [{ timestamp: { order: 'desc' } }];
    }

    return sort;
  },

  prefix: (queries, _prefix, terms) => {
    if (_prefix) {
      let fields = queryFields.slice();

      terms = terms.map((f) => f.name);

      // remove fields that are included in the termFields
      fields = fields.filter((field) => !terms.includes(field));

      const results = fields.map((f) => ({
        prefix: {
          [`${f}`]: _prefix,
        },
      }));

      queries.should = queries.should.concat(results);
      queries.minimum_should_match = (queries.minimum_should_match || 0) + 1;
    }
  },

  infix: (queries, _infix, terms) => {
    if (_infix) {
      let fields = queryFields.slice();

      terms = terms.map((f) => f.name);

      // remove fields that are included in the termFields
      fields = fields.filter((field) => !terms.includes(field));

      const results = {
        query_string: {
          query: `*${_infix}*`,
          fields,
        },
      };

      queries.should = queries.should.concat(results);
      queries.minimum_should_match = (queries.minimum_should_match || 0) + 1;
    }
  },

  _term: (params, regex) => params.map((i) => {
    let fieldName = i.name;

    if (regex) {
      const match = i.name.match(regex);
      fieldName = match[1];
    }

    return {
      match: {
        [fieldName]: i.value,
      },
    };
  }),

  term: (queries, params) => {
    queries.must = queries.must.concat(build._term(params));
  },

  range: (queries, params, regex) => {
    const fields = {};

    // extract field names and values
    params.forEach((i) => {
      const match = i.name.match(regex);
      if (!fields[match[1]]) fields[match[1]] = {};

      if (match[2] === 'from') {
        fields[match[1]].gte = i.value;
      }

      if (match[2] === 'to') {
        fields[match[1]].lte = i.value;
      }
    });

    // because elasticsearch doesn't support multiple
    // fields in range query, make it an erray
    const results = Object.keys(fields).map((k) => ({ range: { [k]: fields[k] } }
    ));

    queries.must = queries.must.concat(results);
  },

  terms: (queries, params, regex) => {
    const results = params.map((i) => {
      const field = i.name.match(regex)[1];
      return {
        terms: {
          [field]: i.value.replace(' ', '').split(','),
        },
      };
    });

    queries.must = queries.must.concat(results);
  },

  not: (queries, params, regex) => {
    const results = params.map((i) => {
      const field = i.name.match(regex)[1];
      return {
        terms: {
          [field]: i.value.replace(' ', '').split(','),
        },
      };
    });

    queries.must_not = queries.must_not.concat(results);
  },

  exists: (queries, params, regex) => {
    const results = params.map((i) => {
      const field = i.name.match(regex)[1];
      return {
        exists: {
          field: field,
        },
      };
    });

    queries.must = queries.must.concat(results);
  },
};

function selectParams(fields, regex) {
  return fields.filter((f) => f.name.match(regex));
}

module.exports = function query(params) {
  const sortParams = params.sortParams || { sort: build.sort(params) };
  delete params.sortParams;

  const response = {
    query: { match_all: {} },
    sort: sortParams.sort,
  };

  const queries = {
    must: [],
    should: [],
    must_not: [],
  };

  const { prefix: _prefix, infix: _infix } = params;

  // remove reserved words (that are not fields)
  params = omit(
    params,
    [
      'limit',
      'page',
      'skip',
      'sort_by',
      'sort_key',
      'order',
      'prefix',
      'infix',
      'fields',
    ]
  );

  if (Object.keys(params).length === 0 && !_prefix && !_infix) {
    return response;
  }

  // Do general search
  if (params.q) {
    response.query = build.general(params);
    return response;
  }

  // determine which search strategy should be applied
  // options are term, terms, range, exists and not in
  const fields = Object.entries(params).map(([name, value]) => ({ name, value }));

  Object.keys(regexes).forEach((k) => {
    const f = selectParams(fields, regexes[k]);

    if (f && f.length > 0) {
      build[k](queries, f, regexes[k]);
    }
  });

  // perform prefix and infix searches
  build.prefix(queries, _prefix, fields);
  build.infix(queries, _infix, fields);

  response.query = {
    bool: queries,
  };

  return response;
};
