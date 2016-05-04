'use strict';

const Assert = require('assert');
const Http = require('http');
const Hapi = require('hapi');
const Tacky = require('../lib');

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
