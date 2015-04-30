var Hoek = require('hoek');

var defaults = {
    expiresIn: 3600000,
    privacy: 'default'
};

var internals = {};

exports.register = function (server, options, next) {

    internals.settings = Hoek.applyToDefaults(defaults, options);

    internals.cache = server.cache({
        expiresIn: internals.settings.expiresIn,
        cache: internals.settings.cache
    });

    server.handler('cache', internals.handler);
    next();
};

exports.register.attributes = {
    pkg: require('../package.json')
};

internals.getCacheString = function (ttl, privacy) {

    var age = Math.floor(ttl / 1000);
    var header = 'max-age=' + age + ', must-revalidate';

    if (privacy !== 'default') {
        header += ', ' + privacy;
    }
    return header;
};

internals.handler = function (route, options) {

    Hoek.assert(typeof options.hydrate === 'function', 'hydrate must be a function.');
    Hoek.assert(route.method === 'get', 'only "get" methods are supported.');

    // This is to prevent confusion about what cach headers to use when sending the response
    // any cache related settings should be under `options` and not under route.settings.cache
    delete route.settings.cache;

    var settings = Hoek.applyToDefaults({
        generateKey: function (request) {

            return request.raw.req.url;
        }
    }, options);

    return function (request, reply) {

        var context = request.route.settings.bind;
        var cacheKey = settings.generateKey.call(context, request);
        var privacy = options.privacy || internals.settings.privacy;

        Hoek.assert(typeof cacheKey === 'string', 'generateKey must return a string.');

        internals.cache.get(cacheKey, function (err, value, cached) {

            if (err) {
                request.log(['cache', 'error'], {
                    message: 'Error looking up ' + cacheKey + ' in the cache',
                    error: err
                });
            }

            if (cached) {
                return reply(value).header('cache-control', internals.getCacheString(cached.ttl, privacy));
            }

            settings.hydrate.call(context, request, function (err, result, state) {

                if (err) {
                    return reply(err);
                }

                var cacheTail = request.tail('cache tail');
                var response = reply(result);
                response.plugins.tacky = state;

                response.header('cache-control', internals.getCacheString(internals.settings.expiresIn, privacy));

                internals.cache.set(cacheKey, result, null, function (cacheErr) {

                    if (cacheErr) {
                        request.log(['cache', 'error'], {
                            message: 'Error setting cache for ' + cacheKey,
                            error: cacheErr
                        });
                    }
                    cacheTail();
                });
            });
        });
    };
};
