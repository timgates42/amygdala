'use strict';

var _ = require('underscore');
var ajax = require('./lib/ajax');
var log = require('loglevel');

var Amygdala = function(schema, options) {
  // Initialize a new Amygdala instance with the given schema and options.
  //
  // params:
  // - schema (Object): Details about the data structure.
  // - options (Object)
  //
  // options:
  // - options.headers (Object): Additional headers to provide with each
  //                             request, such as auth headers.
  log.debug('Amygdala#constructor', schema, options);
  options = options || {};

  this._schema = schema;
  this._headers = options.headers;

  // memory data storage
  this._store = {};
};

// ------------------------------
// Internal utils methods
// ------------------------------
Amygdala.prototype._getURI = function(type) {
  // get absolute uri for api endpoint
  if (!this._schema[type] || !this._schema[type].url) {
    throw new Error('Invalid type. Acceptable types are: ' + Object.keys(this._schema));
  }
  return this._schema.apiUrl + this._schema[type].url;
},

// ------------------------------
// Internal data sync methods
// ------------------------------
Amygdala.prototype._set = function(type, response) {
  // Adds or Updates an item of `type` in this._store.
  //
  // type: schema key/store (teams, users)
  // response: response to store in local cache

  // initialize store for this type (if needed)
  // and store it under `store` for easy access.
  var store = this._store[type] ? this._store[type] : this._store[type] = {};
  var schema = this._schema[type];

  if (_.isString(response)) {
    // If the response is a string, try JSON.parse.
    response = JSON.parse(response);
  }

  if (!_.isArray(response)) {
    // The response isn't an array. We need to figure out how to handle it.
    if (schema.parse) {
      // Prefer the schema's parse method if one exists.
      response = schema.parse(response);
      // if it's still not an array, wrap it around one
      if (!_.isArray(response)) {
        response = [response];
      }
    } else {
      // Otherwise, just wrap it in an array and hope for the best.
      response = [response];
    }
  }

  _.each(response, function(obj) {
    // handle oneToMany relations
    _.each(this._schema[type].oneToMany, function(relatedType, relatedAttr) {
      var related = obj[relatedAttr];
      // check if obj has a `relatedAttr` that is defined as a relation
      if (related) {
        // check if attr value is an array,
        // if it's not empty, and if the content is an object and not a string
        if (Object.prototype.toString.call(related) === '[object Array]' &&
          related.length > 0 &&
          Object.prototype.toString.call(related[0]) === '[object Object]') {
          // if related is a list of objects,
          // populate the relation `table` with this data
          this._set(relatedType, related);
          // and replace the list of objects within `obj`
          // by a list of `id's
          obj[relatedAttr] = _.map(related, function(item) {
            return item[this._schema.idAttribute];
          }.bind(this));
        }
      }
    }.bind(this));

    // handle foreignKey relations
    _.each(this._schema[type].foreignKey, function(relatedType, relatedAttr) {
      var related = obj[relatedAttr];
      // check if obj has a `relatedAttr` that is defined as a relation
      if (related) {
        // check if `obj[relatedAttr]` value is an object (FK should not be arrays),
        // if it's not empty, and if the content is an object and not a string
        if (Object.prototype.toString.call(related) === '[object Object]') {
          // if related is an object,
          // populate the relation `table` with this data
          this._set(relatedType, [related]);
          // and replace the list of objects within `item`
          // by a list of `id's
          obj[relatedAttr] = related[this._schema.idAttribute];
        }
      }
    }.bind(this));

    // store the object under this._store['type']['id']
    store[obj[this._schema.idAttribute]] = obj;
    // TODO: compare the previous object and trigger change events

  }.bind(this));
};

Amygdala.prototype._remove = function(type, response) {
  // Removes an item of `type` from this._store.
  //
  // type: schema key/store (teams, users)
  // response: response to store in local cache
  log.debug('Amygdala#_remove', type, response);

  // TODO
};

// ------------------------------
// Public data sync methods
// ------------------------------
Amygdala.prototype.get = function(type, params, options) {
  // GET request for `type` with optional `params`
  //
  // type: schema key/store (teams, users)
  // params: extra queryString params (?team=xpto&user=xyz)
  // options: extra options
  // - url: url override
  log.debug('Amygdala#get', type, params, options);

  // Default to the URI for 'type'
  options = options || {};
  _.defaults(options, {'url': this._getURI(type)});
  // convert paths to full URLs
  // TODO: DRY UP
  if (options.url.indexOf('/') === 0) {
    options.url = this._schema.apiUrl + options.url;
  }

  // Request settings
  var settings = {
    'data': params,
    'headers': this._headers
  };

  return ajax('GET', options.url, settings)
    .then(_.partial(this._set, type).bind(this));
};

Amygdala.prototype.add = function(type, object, options) {
  // POST/PUT request for `object` in `type`
  //
  // type: schema key/store (teams, users)
  // object: object to update local and remote
  // options: extra options
  // -  url: url override
  log.debug('Amygdala#add', type, object, options);

  // Default to the URI for 'type'
  options = options || {};
  _.defaults(options, {'url': this._getURI(type)});
  // convert paths to full URLs
  // TODO: DRY UP
  if (options.url.indexOf('/') === 0) {
    options.url = this._schema.apiUrl + options.url;
  }

  // Request settings
  var settings = {
    'data': JSON.stringify(object),
    'contentType': 'application/json',
    'headers': this._headers
  };

  return ajax('POST', options.url, settings)
    .then(_.partial(this._set, type).bind(this));
};

Amygdala.prototype.update = function(type, object) {
  // POST/PUT request for `object` in `type`
  //
  // type: schema key/store (teams, users)
  // object: object to update local and remote
  log.debug('Amygdala#update', type, object);

  if (!object.url) {
    throw new Error('Missing object.url attribute. A url attribute is required for a PUT request.');
  }

  // TODO: clean up
  var url = object.url;
  // convert paths to full URLs
  if (url.indexOf('/') === 0) {
    url = this._schema.apiUrl + url;
  }

  // Request settings
  var settings = {
    'data': JSON.stringify(object),
    'contentType': 'application/json',
    'headers': this._headers
  };

  return ajax('PUT', url, settings)
    .then(_.partial(this._set, type).bind(this));
};

Amygdala.prototype.remove = function(type, object) {
  // DELETE request for `object` in `type`
  //
  // type: schema key/store (teams, users)
  // object: object to update local and remote
  log.debug('Amygdala#delete', type, object);

  if (!object.url) {
    throw new Error('Missing object.url attribute. A url attribute is required for a DELETE request.');
  }

  // TODO: clean up
  var url = object.url;
  // convert paths to full URLs
  if (url.indexOf('/') === 0) {
    url = this._schema.apiUrl + url;
  }

  // Request settings
  var settings = {
    'data': JSON.stringify(object),
    'contentType': 'application/json',
    'headers': this._headers
  };

  return ajax('DELETE', url, settings)
    .then(_.partial(this._remove, type).bind(this));
};

// ------------------------------
// Public query methods
// ------------------------------
Amygdala.prototype.findAll = function(type, query) {
  // find a list of items within the store. (THAT ARE NOT STORED IN BACKBONE COLLECTIONS)
  var store = this._store[type];
  if (!store || !Object.keys(store).length) {
    return [];
  }
  if (query === undefined) {
    // query is empty, no object is returned
    return _.map(store, function(item) { return item; });
  } else if (Object.prototype.toString.call(query) === '[object Object]') {
    // if query is an object, assume it specifies filters.
    return _.filter(store, function(item) { return _.findWhere([item], query); });
  } else {
    throw new Error('Invalid query for findAll.');
  }
};

Amygdala.prototype.find = function(type, query) {
  // find a specific within the store. (THAT ARE NOT STORED IN BACKBONE COLLECTIONS)
  var store = this._store[type];
  if (!store || !Object.keys(store).length) {
    return undefined;
  }
  if (query === undefined) {
    // query is empty, no object is returned
    return  undefined;
  } else if (Object.prototype.toString.call(query) === '[object Object]') {
    // if query is an object, return the first match for the query
    return _.findWhere(store, query);
  } else if (Object.prototype.toString.call(query) === '[object String]') {
    // if query is a String, assume it stores the key/url value
    return store[query];
  }
};

module.exports = Amygdala;
