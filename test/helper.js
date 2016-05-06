'use strict';

const Hapi = require('hapi');
const Insync = require('insync');
const Tacky = require('../lib');

module.exports.prepareServer = (config, callback) => {
  /*eslint-disable */
  config.expiresIn = config.expiresIn || 100000;
  /*eslint-enable */
  const server = new Hapi.Server({ debug: false });
  server.connection();

  Insync.series([
    (next) => {
      server.register({
        register: Tacky,
        options: { expiresIn: config.expiresIn }
      }, next);
    },
    (next) => {
      server.route({
        method: 'get',
        path: '/',
        config: {
          handler: {
            cache: {
              hydrate: config.hydrate,
              generateKey: config.generateKey
            }
          }
        }
      });
      next();
    },
    (next) => {
      server.initialize(next);
    }
  ], function () {
    callback(null, server);
  });
};
