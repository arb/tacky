![](https://github.com/continuationlabs/tacky/raw/master/images/smaller.png)

<sub>Logo design by chris.ruppert@gmail.com</sub>

Server-side response caching plugin for [hapi](http://hapijs.com/)

[![Current Version](https://img.shields.io/npm/v/tacky.svg)](https://www.npmjs.org/package/tacky)
[![Build Status](https://travis-ci.org/continuationlabs/tacky.svg)](https://travis-ci.org/continuationlabs/tacky)

[![js-semistandard-style](https://cdn.rawgit.com/flet/semistandard/master/badge.svg)](https://github.com/Flet/semistandard)

tacky adds a new handler named `cache` that can be used on any route that is a `GET` method. tacky will try to serve a value from the server cache first if present. If the value is not in the server cache, it will call `hydrate()`, reply with the result and then cache the value in the server cache for subsequent requests. tacky stores values in a hapi server cache provision. It does *not* just set the response cache headers.

## Example
_copied from examples/default.js_

```js
var Assert = require('assert');
var Http = require('http');
var Hapi = require('hapi');
var Tacky = require('./lib');

var server = new Hapi.Server();
server.connection({ port: 9001 });

server.register({
  register: Tacky
}, function (err) {
  Assert.ifError(err);
  server.route({
    method: 'get',
    path: '/',
    config: {
      handler: {
        cache: {
          hydrate: function (request, callback) {
            Http.get('http://www.google.com', function (res) {
              var buffers = [];
              res.on('data', function (chunk) {
                buffers.push(chunk);
              });
              res.on('end', function () {
                setTimeout(function () {
                  callback(null, buffers.join().toString());
                }, 1000);
              });
            });
          }
        }
      }
    }
  });
  server.start(function () {
    console.log('Server started at ' + server.info.uri);
  });
});
```

When the first request comes in to "/", the `hydrate` method is called. We are getting the Google home page and after 1000 milliseconds, we are calling back with the result. If you make a second request to "/", you should notice the delay isn't there and the response is almost instantaneous. This is because the original response has been cached and sent back to the client. If you are testing with a browser, you should notice that the cache header decrements on each request. tacky will set the client cache header ("cache-control:max-age=3566, must-revalidate") based on the ttl options. The cache header ttl will be randomized so that the server isn't slammed by multiple requests at the same time. The goal is to stagger the cache header expiration across different clients.

## API

### Hapi Plugin Options

These are the available options passed into Tack during plugin registration (`server.register`).

- `expiresIn` - number of milliseconds to keep results in the cache. Also controls the "max-age" cache header. Defaults to 3600000 (one hour).
- `privacy` - determines the privacy flag included in client-side caching using the 'Cache-Control' header. Values are:
  - 'default' - no privacy flag. This is the default setting.
  - 'public' - mark the response as suitable for public caching.
  - 'private' - mark the response as suitable only for private caching.
- `cache` - name of the cache provision to use if it has already been created by the hapi server. If specified, the cache must already exist before registration. Defaults to the default in-memory hapi cache.
- `bind` - context object for `hydrate` and `generateKey`. Defaults to `undefined`.

### `cache` Route Handler Options

- `hydrate` - a function used to get data when absent from the cache. Must have the following signature: `function (request, callback)` where:
  - `request` - the incoming hapi request
  - `callback(err, result[, state])` - function to execute when hydrate is finished.
    - `err` - any error during processing. If this value is truthy, the request will result in a 500 and the request will _not_ be cached.
    - `result` - the value to save in the cache and will be used in responses via `reply(response)`.
    - `[state]` - this value will be attached to `request.response.plugins.tacky.state` so it will be available during the various request lifecycle methods. Defaults to `null`. `state` is also stored in the cache so it should only contain information truly necessary for generating a cached response and should *not* include any request specific information.
- `[privacy]` - override the global `privacy` setting on a per route basis.
- `[expiresIn]` - override the global `expiresIn` setting on a per route basis.
- `[generateKey(request)]` - a function used to generate the cache key. The default value will return `request.raw.req.url`. If `undefined` is returned, cache lookup and storage will be completely skipped. All other results must be strings.
  - `request` - incoming hapi request object.

tacky provides two additional data points throughout the request lifecycle via `response.plugins.tacky` that can be used outside of the plugin for business specific application.
  - `cache` - object with the following keys. Will be `null` if `generateKey` returns `undefined`.
    - `maxAge` - number of milliseconds remaining for this cache record. This value should be used in custom logic outside tacky.
    - `ttl` - number of milliseconds remaining for this cache record. Will be `0` the first time a record is cached. Using `maxAge` is preferred because of this.
    - `privacy` - privacy setting used for the cache header
  - `state` - object passed into the callback of the `hydrate` method. Will be `null` if not provided by the callback to `hydrate` or if the result is not available in the cache.
