![Tacky](https://github.com/continuationlabs/tacky/raw/master/images/smaller.png)

<sub>Logo design by chris.ruppert@gmail.com</sub>

Server-side response caching plugin for [hapi](http://hapijs.com/)

[![Current Version](https://img.shields.io/npm/v/tacky.svg)](https://www.npmjs.org/package/tacky)
[![Build Status](https://travis-ci.org/continuationlabs/tacky.svg)](https://travis-ci.org/continuationlabs/tacky)

[![js-semistandard-style](https://cdn.rawgit.com/flet/semistandard/master/badge.svg)](https://github.com/Flet/semistandard)

tacky adds a new handler named `cache` that can be used on any route that is a `GET` method. tacky will try to serve a value from the server cache first if present. If the value is not in the server cache, it will call `hydrate()`, reply with the result and then cache the value in the server cache for subsequent requests. tacky stores values in a hapi server cache provision. It does *not* just set the response cache headers.

## Usage

See the [API Reference](https://github.com/continuationlabs/tacky/blob/master/API.md)

### Example

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

When the first request comes in to "/", the `hydrate` method is called. We are getting the Google home page and after 1000 milliseconds, we are calling back with the result. If you make a second request to "/", you should notice the delay isn't there and the response is almost instantaneous. The original response has been cached and sent back to the client. If you are testing with a browser, you should notice that the cache header decrements on each request. tacky will set the client cache header ("cache-control:max-age=3566, must-revalidate") based on the ttl options. The cache header ttl will be randomized so that the server isn't slammed by multiple requests at the same time. The goal is to stagger the cache header expiration across different clients.
