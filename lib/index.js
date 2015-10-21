'use strict';

const Hoek = require('hoek');
const Insync = require('insync');

const defaults = {
  expiresIn: 3600000,
  privacy: 'default'
};
const pkg = require('../package.json');
const NAME = pkg.name;

const internals = {};

exports.register = function (server, options, next) {
  internals.settings = Hoek.applyToDefaults(defaults, options);
  internals.cache = server.cache({
    expiresIn: internals.settings.expiresIn,
    cache: internals.settings.cache
  });

  server.ext('onPreResponse', internals.extensionPoint);
  server.handler('cache', internals.handler.bind(options.bind));
  next();
};

exports.register.attributes = {
  pkg
};

internals.handler = function (route, options) {
  Hoek.assert(typeof options.hydrate === 'function', 'hydrate must be a function.');
  Hoek.assert(route.method === 'get', 'only "get" methods are supported.');

  // This is to prevent confusion about what cach headers to use when sending the response
  // any cache related settings should be under `options` and not under route.settings.cache
  delete route.settings.cache;

  const settings = Hoek.applyToDefaults({
    generateKey (request) {
      return request.raw.req.url;
    }
  }, options);

  const self = this;
  return function (request, reply) {
    const cacheKey = settings.generateKey.call(self, request);
    const privacy = options.privacy || internals.settings.privacy;
    // If the ttl hasn't been overwritten by a route option, use the default cache policy value which is keyed as 0 via CatBox
    // this is what we use thoughtout the code to call out to Catbox
    const ttl = options.expiresIn || 0;
    // This will be passed out in request.state.tacky so it can be used to set cache-headers
    const maxAge = options.expiresIn || internals.settings.expiresIn;

    // Waterfall functions
    const hydrate = settings.hydrate.bind(self, request);
    const done = function (err, data) {
      if (err) {
        return reply(err);
      }

      const response = reply(data.result);
      response.plugins[NAME] = {
        cache: data.cache,
        state: data.state
      };
    };
    const afterHydrate = function (cache) {
      return function (result /*, [state], [next]*/) {
        let next;
        let state;
        if (arguments.length === 3) {
          state = arguments[1];
          next = arguments[2];
        } else {
          state = null;
          next = arguments[1];
        }

        next(null, { result, state, cache });
      };
    };
    const checkCache = function (next) {
      internals.cache.get(cacheKey, function (err, value, cached) {
        if (err) {
          request.log(['cache', 'error'], {
            message: `Error looking up ${cacheKey} in the cache`,
            error: err
          });
        }

        // If the value is in the cache, short-circuit the waterfall and
        // call out to the end. This is the "documented" way to short-circuit
        // an async waterfall (https://github.com/caolan/async/pull/85#issuecomment-13072390).
        if (cached) {
          return done(null, {
            result: value.result,
            cache: {
              ttl: cached.ttl,
              maxAge: cached.ttl,
              privacy: privacy
            },
            state: value.state
          });
        }
        next(null);
      });
    };

    const tasks = [];
    /* eslint-disable*/
    if (cacheKey == null) {
    /* eslint-enable*/
      tasks.push(hydrate, afterHydrate(null));
    } else {
      tasks.push(checkCache, hydrate);
      tasks.push(afterHydrate({ ttl, maxAge, privacy }));
      tasks.push(function (arg, next) {
        const tail = request.tail('cache tail');
        const value = {
          result: arg.result,
          state: arg.state
        };
        internals.cache.set(cacheKey, value, arg.cache.ttl, function (cacheErr) {
          if (cacheErr) {
            request.log(['cache', 'error'], {
              message: `Error setting cache for ${cacheKey}`,
              error: cacheErr
            });
          }
          tail();
        });
        next(null, arg);
      });
    }

    Insync.waterfall(tasks, done);
  };
};

internals.getCacheString = function (ttl, privacy) {
  const age = Math.floor(ttl / 1000);
  let header = `max-age=${age}, must-revalidate`;

  if (privacy !== 'default') {
    header += ', ' + privacy;
  }
  return header;
};

internals.extensionPoint = function (request, reply) {
  const response = request.response;

  if (response.isBoom) {
    return reply.continue();
  }

  const cache = Hoek.reach(response, 'plugins.' + NAME + '.cache');
  if (cache) {
    // Random number between 60% of the ttl and the TTL.
    const age = internals.between(cache.maxAge * 0.60, cache.maxAge);

    response.header('cache-control', internals.getCacheString(age, cache.privacy));
  }
  reply.continue();
};

internals.between = function (min, max) {
  min = Math.floor(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1) + min);
};
