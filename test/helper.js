var Hapi = require('hapi');
var Insync = require('insync');
var Tacky = require('../lib');

exports.prepareServer = function (config, callback) {
  /*eslint-disable */
  config.start = (config.start == null ? true : config.start);
  config.expiresIn = config.expiresIn || 100000;
  /*eslint-enable */
  var server = new Hapi.Server({
    debug: false
  });
  server.connection();

  Insync.series([
    function (next) {
      server.register({
        register: Tacky,
        options: { expiresIn: config.expiresIn }
      }, next);
    }, function (next) {
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
    }, function (next) {
      if (config.start) {
        return server.start(next);
      }
      next();
    }], function () {
      callback(null, server);
    }
  );
};
