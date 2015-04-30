![](https://github.com/continuationlabs/tacky/raw/master/images/smaller.png)

<sub>Logo design by chris.ruppert@gmail.com</sub>

Server-side response caching plugin for [hapi](http://hapijs.com/)

[![Current Version](https://img.shields.io/npm/v/tacky.svg)](https://www.npmjs.org/package/tacky)
[![Build Status](https://travis-ci.org/continuationlabs/tacky.svg)](https://travis-ci.org/continuationlabs/tacky)

tacky adds a new handler named `cache` that can be used on any route that is a "get" method. tacky will try to serve a value from the server cache if present. If the value is not in the server cache, it will call a `hydrate` function, reply with the result and the cache the value in the server cache for subsequent requests. tacky stores values in a hapi server cache provision. It does *not* just set the response cache headers.

## Example
_copied from examples/defualt.js_

```js
var Http = require('http');
var Hapi = require('hapi');
var Tacky = require('../lib');

var server = new Hapi.Server();
server.connection({ port: 9001 });

server.register({
  register: Tacky
}, function (err) {

  server.route({
    method: 'get',
    path: '/',
    config: {
      handler: {
        cache: {
            hydrate: function (request, callback) {
              Http.get('http://www.google.com', function (res) {
                var data = '';
                res.on('data', function (chunk) {
                  data += chunk;
                });
                res.on('end', function () {
                  setTimeout(function () {
                    callback(null, data);
                  }, 1000);
                });
              });
            }
        }
      }
    }
  });
  server.start(function () {
    console.log('Server started at ' + server.info.uri)
  });
});
```

When the first request comes in to "/", the `hydrate` method is called. We are getting the Google home page and after 1000 miliseconds, we are calling back with the result. If you make a second request to "/", you should notice the delay isn't there and the response is almost instant. This is because the original response has been cached and sent back to the client. If you are testing with a browser, you should notice that the cache header decrements on each request.

## API

### Hapi Plugin Options

These are the available options passed into Tack during plugin registration (`server.register`).

- `expiresIn` - number of milliseconds to keep results in the cache. Also controls the "max-age" cache header. Defaults to 3600000 (one hour).
- `privacy` - determines the privacy flag included in client-side caching using the 'Cache-Control' header. Values are:
  - 'default' - no privacy flag. This is the default setting.
  - 'public' - mark the response as suitable for public caching.
  - 'private' - mark the response as suitable only for private caching.
- `cache` - name of the cache provision to use if it has already been created by the hapi server. If specified, the cache must already exist before registration. Defaults to the default in-memory hapi cache.

### `cache` Route Handler Options

- `hydrate` - a function used to get data when absent from the cache. Must have the following signature: `function (request, callback)` where:
  - `request` - the incoming hapi request
  - `callback(err, result, state)` - function to execute when hydrate is finished.
    - `err` - any error during processing. If this value is truthy, the request will result in a 500 and the request will _not_ be cached.
    - `result` - the value to save in the cache.
    - `[state]` - this value will be attached to `request.response.plugins.tacky` so it will be available during the various request lifecycle methods. Defaults to `undefined`.
- `[privacy]` - override the global `privacy` setting on a per route basis.
- `[generateKey(request)]` - a function used to generate the cache key. Must return a string. The default value will return `request.raw.req.url`.
  - `request` - incoming hapi request object.

__context__
The `this` pointed for `hydrate` and `generateKey` can be controlled via the `bind` option for the [route handler](https://github.com/hapijs/hapi/blob/master/API.md#route-options).

Example:

```js
config: {
  handler: {
    cache: {
      hydrate: function (request, callback) {
  
        // this is {foo: 'bar', baz: true}
        callback(null, this.baz);
      },
      generateKey: function (request) {
  
        // this is {foo: 'bar', baz: true}
        // don't do this because nothing will cache
        return Date.now() + this.foo;
      }
    }
  },
  bind: {
    foo: 'bar',
    baz: true
  }
}
```
