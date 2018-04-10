![Tacky](https://github.com/arb/tacky/raw/master/images/smaller.png)

<sub>Logo design by chris.ruppert@gmail.com</sub>

Server-side response caching plugin for [hapi](http://hapijs.com/)

[![Current Version](https://img.shields.io/npm/v/tacky.svg)](https://www.npmjs.org/package/tacky)
[![Build Status](https://travis-ci.org/arb/tacky.svg)](https://travis-ci.org/arb/tacky)
[![belly-button-style](https://img.shields.io/badge/eslint-bellybutton-4B32C3.svg)](https://github.com/continuationlabs/belly-button)


tacky adds a new handler named `cache` that can be used on any route that is a `GET` method. tacky will try to serve a value from the server cache first if present. If the value is not in the server cache, it will call `hydrate()`, reply with the result and then cache the value in the server cache for subsequent requests. tacky stores values in a hapi server cache provision. It does *not* just set the response cache headers.

## Usage

See the [API Reference](https://github.com/arb/tacky/blob/master/API.md)

### Example

_copied from examples/default.js_

```js
const Assert = require('assert');
const Http = require('http');
const Hapi = require('hapi');
const Tacky = require('tacky');

const server = new Hapi.Server();
server.connection({ port: 9001 });

server.register({ register: Tacky }, (err) => {
  Assert.ifError(err);
  server.route({
    method: 'get',
    path: '/',
    config: {
      handler: {
        cache: {
          hydrate: (request, callback) => {
            Http.get('http://www.google.com', (res) => {
              const buffers = [];
              res.on('data', (chunk) => {
                buffers.push(chunk);
              });
              res.on('end', () => {
                callback(null, buffers.join().toString());
              });
            });
          }
        }
      }
    }
  });
  server.start(() => { console.log('Server started at ' + server.info.uri); });
});
```

When the first request comes in to "/", the `hydrate` method is called. We are getting the Google home page and after 1000 milliseconds, we are calling back with the result. If you make a second request to "/", you should notice the delay isn't there and the response is almost instantaneous. The original response has been cached and sent back to the client. If you are testing with a browser, you should notice that the cache header decrements on each request. tacky will set the client cache header ("cache-control:max-age=3566, must-revalidate") based on the ttl options. The cache header ttl will be randomized so that the server isn't slammed by multiple requests at the same time. The goal is to stagger the cache header expiration across different clients.
