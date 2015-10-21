'use strict';

var Assert = require('assert');
var Http = require('http');
var Hapi = require('hapi');
var Hoek = require('hoek');
var Tacky = require('../lib');

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
                  callback(null, buffers.join().toString(), {
                    statusCode: 202
                  });
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
  server.ext('onPreResponse', function (request, reply) {
    var response = request.response;

    if (response.isBoom) {
      return reply.continue();
    }

    var state = Hoek.reach(response, 'plugins.tacky.state');

    if (state) {
      response.statusCode = state.statusCode;
    }
    reply.continue();
  });
});
