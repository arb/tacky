'use strict';

/*eslint-disable handle-callback-err */
const Code = require('code');
const Hapi = require('hapi');
const Insync = require('insync');
const Lab = require('lab');

const Helper = require('./helper');
const Tacky = require('../lib');

const lab = exports.lab = Lab.script();
const describe = lab.describe;
const it = lab.it;
const expect = Code.expect;

const internals = {
  headerRegex: /max-age=\d+,\s+must-revalidate(,\s+private)?/
};

internals.getTtl = (header) => {
  let age = header.match(/(\d+)/)[0];
  age = parseInt(age, 10);
  return age;
};

internals.checkCacheHeader = (res, expires) => {
  expect(res.headers['cache-control']).to.match(internals.headerRegex);

  const ttl = internals.getTtl(res.headers['cache-control']);
  // In seconds
  expect(ttl).to.be.about(expires, Math.floor(expires * 0.60));
};

describe('tacky', () => {
  it('throws if the handler is missing a hydrate function', (done) => {
    const server = new Hapi.Server();
    server.connection();

    server.register({
      register: Tacky
    }, (err) => {
      expect(err).to.not.exist();
      expect(() => {
        server.route({
          method: 'get',
          path: '/',
          handler: {
            cache: {}
          }
        });
      }).to.throw('hydrate must be a function.');
      done();
    });
  });

  it('throws if the method is not a "GET" method', (done) => {
    const server = new Hapi.Server();
    server.connection();

    server.register({
      register: Tacky
    }, (err) => {
      expect(err).to.not.exist();
      expect(() => {
        server.route({
          method: 'post',
          path: '/',
          handler: {
            cache: {
              hydrate () { }
            }
          }
        });
      }).to.throw('only "get" methods are supported.');
      done();
    });
  });

  it('throws if the cache does not exist', (done) => {
    const server = new Hapi.Server();
    server.connection();

    expect(() => {
      server.register({
        register: Tacky,
        options: {
          cache: 'foobar'
        }
      }, () => {});
    }).to.throw('Unknown cache foobar');
    done();
  });

  it('sets the cache-control header smartly', (done) => {
    const result = { foo: 'bar', baz: 123 };

    Helper.prepareServer({
      hydrate (request, callback) {
        callback(null, result);
      },
      expiresIn: 1000000
    }, (err, server) => {
      expect(err).to.not.exist();

      Insync.series([
        (next) => {
          server.inject({
            url: '/'
          }, (res) => {
            internals.checkCacheHeader(res, 1000);
            expect(res.result).to.equal(result);
            setTimeout(next, 1000);
          });
        },
        (next) => {
          server.inject({
            url: '/'
          }, (res) => {
            internals.checkCacheHeader(res, 980);
            expect(res.headers['cache-control']).to.match(internals.headerRegex);

            expect(res.result).to.equal(result);
            next();
          });
        }
      ], done);
    });
  });

  it('stores the result of hydrate in the default server memory cache', (done) => {
    const result = { foo: 'value1', bar: [1, 2, 3] };
    Helper.prepareServer({
      hydrate (request, callback) {
        callback(null, result);
      }
    }, (err, server) => {
      expect(err).to.not.exist();

      server.inject({
        url: '/'
      }, (res) => {
        internals.checkCacheHeader(res, 100);
        expect(res.result).to.equal(result);

        const cache = server._caches._default;
        expect(cache.segments['!tacky']).to.be.true();
        expect(cache.client.connection.cache['!tacky']['/']).to.exist();

        done();
      });
    });
  });

  it('stores the result of hydrate the provisioned cache', (done) => {
    const server = new Hapi.Server({
      debug: false,
      cache: {
        engine: require('hapi/node_modules/catbox-memory'),
        name: 'super-cache'
      }
    });
    server.connection();

    Insync.series([
      (next) => {
        server.register({
          register: Tacky,
          options: {
            expiresIn: 100000,
            cache: 'super-cache'
          }
        }, next);
      },
      (next) => {
        server.route({
          method: 'get',
          path: '/',
          config: {
            handler: {
              cache: {
                hydrate (request, callback) {
                  callback(null, true);
                }
              }
            }
          }
        });
        server.start(next);
      },
      (next) => {
        server.inject({
          url: '/'
        }, (res) => {
          internals.checkCacheHeader(res, 100);

          const cache = server._caches['super-cache'];
          expect(cache.segments['!tacky']).to.be.true();
          expect(cache.client.connection.cache['!tacky']['/']).to.exist();

          next();
        });
      }], done);
  });

  it('serves from the cache if present', (done) => {
    const result = 'abcdefghijk';
    let hitCount = 0;

    Helper.prepareServer({
      hydrate (request, callback) {
        hitCount++;
        callback(null, result);
      }
    }, (err, server) => {
      expect(err).to.not.exist();

      Insync.series([
        (next) => {
          server.inject({
            url: '/'
          }, next.bind(null, null));
        },
        (next) => {
          server.inject({
            url: '/'
          }, (res) => {
            expect(res.result).to.equal(result);
            expect(hitCount).to.equal(1);

            next();
          });
        }
      ], done);
    });
  });

  it('always provides request state and cache information via response.plugins.tacky', (done) => {
    const result = [1, 2, 3, 4, 5];
    const state = {
      total: 1,
      data: {
        foo: 'bar',
        name: 'tacky'
      }
    };
    let hitCount = 0;

    Helper.prepareServer({
      hydrate (request, callback) {
        hitCount++;
        callback(null, result, state);
      }
    }, (err, server) => {
      expect(err).to.not.exist();

      Insync.series([
        (next) => {
          server.ext('onPreResponse', (request, reply) => {
            const tacky = request.response.plugins.tacky;
            expect(tacky.state).to.equal(state);
            expect(tacky.cache).to.exist();
            expect(tacky.cache).to.have.length(3);
            reply.continue();
          });

          next();
        },
        (next) => {
          server.inject({
            url: '/'
          }, (res) => {
            expect(res.result).to.equal(result);
            next();
          });
        },
        (next) => {
          server.inject({
            url: '/'
          }, (res) => {
            expect(res.result).to.equal(result);
            next();
          });
        }
      ], (err) => {
        expect(hitCount).to.equal(1);
        done();
      });
    });
  });

  it('will report cache errors when getting cache values', (done) => {
    const result = [{ foo: 'bar' }, { foo: 'baz' }, { foo: 'zip' }];

    Helper.prepareServer({
      hydrate (request, callback) {
        callback(null, result);
      }
    }, (err, server) => {
      expect(err).to.not.exist();
      Insync.series([
        (next) => {
          server.once('request', (request, event) => {
            expect(event.tags).to.equal(['cache', 'error']);
            expect(event.data.message).to.equal('Error looking up / in the cache');
          });
          next();
        },
        (next) => {
          server.inject({
            url: '/'
          }, (res) => {
            internals.checkCacheHeader(res, 100);
            expect(res.result).to.equal(result);
            next();
          });
        }
      ], done);
    });
  });

  it('will report cache errors when setting cache values', (done) => {
    const result = [{ foo: 'bar' }, { foo: 'baz' }, { foo: 'zip' }];

    Helper.prepareServer({
      hydrate (request, callback) {
        callback(null, result);
      }
    }, (err, server) => {
      expect(err).to.not.exist();
      Insync.series([
        (next) => {
          server.once('request', (request, event) => {
            expect(event.tags).to.equal(['cache', 'error']);
            expect(event.data.message).to.equal('Error setting cache for /');
          });
          next();
        },
        (next) => {
          const Policy = require('hapi/node_modules/catbox/lib/policy');
          const set = Policy.prototype.set;
          Policy.prototype.set = (id, value, options, callback) => {
            Policy.prototype.set = set;

            expect(id).to.equal('/');
            expect(value).to.equal({
              result: result,
              state: null
            });
            callback(new Error('mock error for testing'));
          };

          server.inject({
            url: '/'
          }, (res) => {
            internals.checkCacheHeader(res, 100);
            expect(res.result).to.equal(result);
            next();
          });
        }
      ], done);
    });
  });

  it('will reply with an error if hydrate fails', (done) => {
    Helper.prepareServer({
      hydrate (request, callback) {
        callback(new Error('mock error for testing'));
      }
    }, (err, server) => {
      expect(err).to.not.exist();
      server.inject({
        url: '/'
      }, (res) => {
        expect(res.result).to.equal({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'An internal server error occurred'
        });
        done();
      });
    });
  });

  it('will pass the context option to the hydrate and generateKey function', (done) => {
    const server = new Hapi.Server({ debug: false });
    const context = {
      foo: 'bar',
      baz: true
    };
    server.connection();

    Insync.series([
      (next) => {
        server.register({
          register: Tacky,
          options: { expiresIn: 100000, bind: context }
        }, next);
      },
      (next) => {
        server.route({
          method: 'get',
          path: '/',
          config: {
            handler: {
              cache: {
                hydrate (request, callback) {
                  expect(this).to.equal(context);
                  callback(null, true);
                },
                generateKey (request) {
                  expect(this).to.equal(context);
                  return request.raw.req.url;
                },
                privacy: 'private'
              }
            }
          }
        });
        server.start(next);
      },
      (next) => {
        server.inject({
          url: '/'
        }, (res) => {
          internals.checkCacheHeader(res, 100);
          next();
        });
      }], done);
  });

  it('will not cache values if the generateKey is null or undefined', (done) => {
    const result = { foo: 'bar', baz: 123 };
    Helper.prepareServer({
      hydrate (request, callback) {
        callback(null, result);
      },
      generateKey () {
        return undefined;
      }
    }, (err, server) => {
      expect(err).to.not.exist();

      server.ext('onPreResponse', (request, reply) => {
        expect(request.response.plugins.tacky).to.equal({
          cache: null,
          state: null
        });
        reply.continue();
      });

      Insync.series([
        (next) => {
          server.inject({
            url: '/'
          }, (res) => {
            expect(res.statusCode).to.equal(200);
            expect(res.result).to.equal(result);

            const cache = server._caches._default;
            expect(cache.segments['!tacky']).to.be.true();
            expect(cache.client.connection.cache).to.have.length(0);
            done();
          });
        }
      ], done);
    });
  });

  it('will use the expiresIn route option instead of the Policy default', (done) => {
    const result = [{ foo: 'bar' }, { foo: 'baz' }, { foo: 'zip' }];

    Helper.prepareServer({
      hydrate (request, callback) {
        callback(null, 123456);
      }
    }, (err, server) => {
      Insync.series([
        (next) => {
          server.route({
            method: 'get',
            path: '/cache',
            config: {
              handler: {
                cache: {
                  hydrate (request, callback) {
                    return callback(null, result);
                  },
                  expiresIn: 1000000
                }
              }
            }
          });
          next();
        },
        (next) => {
          server.inject({
            url: '/cache'
          }, (res) => {
            internals.checkCacheHeader(res, 1000);
            expect(res.result).to.equal(result);

            const cache = server._caches._default;
            expect(cache.segments['!tacky']).to.be.true();
            expect(cache.client.connection.cache['!tacky']['/cache'].ttl).to.equal(1000000);
            expect(cache.client.connection.cache['!tacky']['/cache'].item).to.equal(JSON.stringify({ result: result, state: null }));

            next();
          });
        },
        (next) => {
          server.inject({
            url: '/'
          }, (res) => {
            internals.checkCacheHeader(res, 100);
            expect(res.result).to.equal(123456);

            const cache = server._caches._default;
            expect(cache.client.connection.cache['!tacky']['/'].ttl).to.equal(100000);
            expect(cache.client.connection.cache['!tacky']['/'].item).to.equal(JSON.stringify({ result: 123456, state: null }));

            next();
          });
        }], done);
    });
  });

  describe('generateKey()', () => {
    it('can be used to override the default generateKey function', (done) => {
      const result = { foo: 'bar', baz: 123 };
      Helper.prepareServer({
        hydrate (request, callback) {
          callback(null, result);
        },
        generateKey (request) {
          return 12345 + request.state.foo;
        }
      }, (err, server) => {
        expect(err).to.not.exist();
        Insync.series([
          (next) => {
            server.inject({
              url: '/',
              headers: {
                'Cookie': 'foo=bar'
              }
            }, (res) => {
              expect(res.headers['cache-control']).to.match(internals.headerRegex);

              const cache = server._caches._default;
              expect(cache.segments['!tacky']).to.be.true();
              expect(cache.client.connection.cache['!tacky']['12345bar']).to.exist();

              next();
            });
          }
        ], done);
      });
    });

    it('will throw an error if the resultant cache key is not a string', (done) => {
      const result = { foo: 'bar', baz: 123 };

      Helper.prepareServer({
        hydrate (request, callback) {
          callback(null, result);
        },
        generateKey (request) {
          return false;
        }
      }, (err, server) => {
        expect(err).to.not.exist();
        Insync.series([
          (next) => {
            server.on('request-error', (request, err) => {
              expect(err).to.be.an.instanceOf(Error);
              expect(err.message).to.equal('Uncaught error: generateKey must return a string.');
            });
            next();
          },
          (next) => {
            server.inject({
              url: '/'
            }, next.bind(null, null));
          }
        ], done);
      });
    });
  });
});
