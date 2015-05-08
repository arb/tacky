var Code = require('code');
var Hapi = require('hapi');
var Hoek = require('hoek');
var Insync = require('insync');
var Lab = require('lab');

var Helper = require('./helper');
var Tacky = require('../lib');

var lab = exports.lab = Lab.script();
var describe = lab.describe;
var it = lab.it;
var before = lab.before;
var after = lab.after;
var expect = Code.expect;

var internals = {
    headerRegex: /max-age=\d+,\s+must-revalidate(,\s+private)?/
};

internals.getTtl = function (header) {
    var age = header.match(/(\d+)/)[0];
    age = parseInt(age, 10);
    return age;
};

describe('tacky', function () {

    it('throws if the handler is missing a hydrate function', function (done) {

        var server = new Hapi.Server();
        server.connection();

        server.register({
            register: Tacky
        }, function (err) {

            expect(err).to.not.exist();
            expect(function () {

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

    it('throws if the method is not a "GET" method', function (done) {

        var server = new Hapi.Server();
        server.connection();

        server.register({
            register: Tacky
        }, function (err) {

            expect(err).to.not.exist();
            expect(function () {

                server.route({
                    method: 'post',
                    path: '/',
                    handler: {
                        cache: {
                            hydrate: Hoek.ignore
                        }
                    }
                });
            }).to.throw('only "get" methods are supported.');
            done();
        });
    });

    it('throws if the cache does not exist', function (done) {

        var server = new Hapi.Server();
        server.connection();

        expect(function () {

            server.register({
                register: Tacky,
                options: {
                    cache: 'foobar'
                }
            }, Hoek.ignore);
        }).to.throw('Unknown cache foobar');
        done();
    });

    it('sets the cache-control header smartly', function (done) {

        var result = { foo: 'bar', baz: 123 };
        var ttlOne;
        var ttlTwo;

        Helper.prepareServer({
            hydrate: function (request, callback) {

                callback(null, result);
            }
        }, function (err, server) {

            expect(err).to.not.exist();

            Insync.series([
                function (next) {

                    server.inject({
                        url: '/'
                    }, function (res) {

                        expect(res.headers['cache-control']).to.exist();
                        expect(internals.headerRegex.test(res.headers['cache-control'])).to.be.true();
                        expect(res.result).to.deep.equal(result);
                        setTimeout(next, 100);
                    });
                },
                function (next) {

                    server.inject({
                        url: '/'
                    }, function (res) {

                        expect(res.headers['cache-control']).to.exist();
                        expect(internals.headerRegex.test(res.headers['cache-control'])).to.be.true();

                        ttlTwo = internals.getTtl(res.headers['cache-control']);
                        expect(ttlTwo).to.be.lessThan(100);
                        expect(res.result).to.deep.equal(result);
                        next();
                    });
                }
            ], done);
        });
    });

    it('stores the result of hydrate in the default server memory cache', function (done) {

        var result = { foo: 'value1', bar: [1, 2, 3] };
        Helper.prepareServer({
            hydrate: function (request, callback) {

                callback(null, result);
            }
        }, function (err, server) {

            expect(err).to.not.exist();

            Insync.series([
                function (next) {

                    server.inject({
                        url: '/'
                    }, function (res) {

                        expect(internals.headerRegex.test(res.headers['cache-control'])).to.be.true();
                        expect(res.result).to.deep.equal(result);

                        var cache = server._caches._default;
                        expect(cache.segments['!tacky']).to.be.true();
                        expect(cache.client.connection.cache['!tacky']['/']).to.exist();

                        next();
                    });
                }
            ], done);
        });
    });

    it('stores the result of hydrate the provisioned cache', function (done) {

        var server = new Hapi.Server({
            debug: false,
            cache: {
                engine: require('hapi/node_modules/catbox-memory'),
                name: 'super-cache'
            }
        });
        server.connection();

        Insync.series([
            function (next) {

                server.register({
                    register: Tacky,
                    options: {
                        expiresIn: 100000,
                        cache: 'super-cache'
                    }
                }, next);
            }, function (next) {

                server.route({
                    method: 'get',
                    path: '/',
                    config: {
                        handler: {
                            cache: {
                                hydrate: function (request, callback) {

                                    callback(null, true);
                                }
                            }
                        }
                    }
                });
                server.start(next);
            }, function (next) {

                server.inject({
                    url: '/'
                }, function (res) {

                    expect(internals.headerRegex.test(res.headers['cache-control'])).to.be.true();

                    var cache = server._caches['super-cache'];
                    expect(cache.segments['!tacky']).to.be.true();
                    expect(cache.client.connection.cache['!tacky']['/']).to.exist();

                    next();
                });
            }], done);
    });

    it('serves from the cache if present', function (done) {

        var result = 'abcdefghijk';
        var hitCount = 0;

        Helper.prepareServer({
            hydrate: function (request, callback) {

                hitCount++;
                callback(null, result);
            }
        }, function (err, server) {

            expect(err).to.not.exist();

            Insync.series([
                function (next) {

                    server.inject({
                        url: '/'
                    }, next.bind(null, null));
                },
                function (next) {

                    server.inject({
                        url: '/'
                    }, function (res) {

                        expect(res.result).to.equal(result);
                        expect(hitCount).to.equal(1);

                        next();
                    });
                }
            ], done);
        });
    });

    it('provides request state and cache information', function (done) {

        var result = [1, 2, 3, 4, 5];
        var state = {
            total: 1,
            data: {
                foo: 'bar',
                name: 'tacky'
            }
        };

        Helper.prepareServer({
            hydrate: function (request, callback) {

                callback(null, result, state);
            }
        }, function (err, server) {

            expect(err).to.not.exist();

            Insync.series([
                function (next) {

                    server.start(next);
                    server.ext('onPreResponse', function (request, reply) {

                        expect(request.response.plugins.tacky.state).to.deep.equal(state);
                        expect(request.response.plugins.tacky.cache).to.exist();
                        reply.continue();
                    });
                },
                function (next) {

                    server.inject({
                        url: '/'
                    }, function (res) {

                        expect(res.result).to.equal(result);
                        next();
                    });
                }
            ], done);
        });
    });

    it('will report cache errors when getting cache values', function (done) {

        var result = [{ foo: 'bar' }, { foo: 'baz' }, { foo: 'zip' }];

        Helper.prepareServer({
            hydrate: function (request, callback) {

                callback(null, result);
            },
            start: false
        }, function (err, server) {

            expect(err).to.not.exist();
            Insync.series([
                function (next) {

                    server.once('request', function (request, event) {

                        expect(event.tags).to.deep.equal(['cache', 'error']);
                        expect(event.data.message).to.equal('Error looking up / in the cache');
                    });
                    next();
                },
                function (next) {

                    server.inject({
                        url: '/'
                    }, function (res) {

                        expect(res.result).to.equal(result);
                        next();
                    });
                }
            ], done);
        });
    });

    it('will report cache errors when setting cache values', function (done) {

        var result = [{ foo: 'bar' }, { foo: 'baz' }, { foo: 'zip' }];

        Helper.prepareServer({
            hydrate: function (request, callback) {

                callback(null, result);
            }
        }, function (err, server) {

            expect(err).to.not.exist();
            Insync.series([
                function (next) {

                    server.once('request', function (request, event) {

                        expect(event.tags).to.deep.equal(['cache', 'error']);
                        expect(event.data.message).to.equal('Error setting cache for /');
                    });
                    next();
                },
                function (next) {

                    var Policy = require('hapi/node_modules/catbox/lib/policy');
                    var set = Policy.prototype.set;
                    Policy.prototype.set = function (id, value, options, callback) {

                        Policy.prototype.set = set;

                        expect(id).to.equal('/');
                        expect(value).to.deep.equal(result);
                        callback(new Error('mock error for testing'));
                    };

                    server.inject({
                        url: '/'
                    }, function (res) {

                        expect(res.result).to.equal(result);
                        next();
                    });
                }
            ], done);
        });
    });

    it('will reply with an error if hydrate fails', function (done) {

        var result = [{ foo: 'bar' }, { foo: 'baz' }, { foo: 'zip' }];

        Helper.prepareServer({
            hydrate: function (request, callback) {

                callback(new Error('mock error for testing'));
            }
        }, function (err, server) {

            expect(err).to.not.exist();
            server.inject({
                url: '/'
            }, function (res) {

                expect(res.result).to.deep.equal({
                    statusCode: 500,
                    error: 'Internal Server Error',
                    message: 'An internal server error occurred'
                });
                expect(res.headers['cache-control']).to.equal('no-cache');
                done();
            });
        });
    });

    it('will pass the context option to the hydrate and generateKey function', function (done) {

        var server = new Hapi.Server({ debug: false });
        var context = {
            foo: 'bar',
            baz: true
        };
        server.connection();

        Insync.series([
            function (next) {

                server.register({
                    register: Tacky,
                    options: { expiresIn: 100000, bind: context }
                }, next);
            }, function (next) {

                server.route({
                    method: 'get',
                    path: '/',
                    config: {
                        handler: {
                            cache: {
                                hydrate: function (request, callback) {

                                    expect(this).to.deep.equal(context);
                                    callback(null, true);
                                },
                                generateKay: function (request) {

                                    expect(this).to.deep.equal(context);
                                    return request.raw.req.url;
                                },
                                privacy: 'private'
                            }
                        }
                    }
                });
                server.start(next);
            }, function (next) {

                server.inject({
                    url: '/'
                }, function (res) {

                    expect(internals.headerRegex.test(res.headers['cache-control'])).to.be.true();
                    next();
                });
            }], done);
    });

    it('will not cache values if the cachekey is null or undefined', function (done) {

        var result = { foo: 'bar', baz: 123 };
        Helper.prepareServer({
            hydrate: function (request, callback) {

                callback(null, result);
            },
            generateKey: function () {

                return undefined;
            }
        }, function (err, server) {

            expect(err).to.not.exist();

            server.ext('onPreResponse', function (request, reply) {

                expect(request.response.plugins.tacky).to.deep.equal({
                    cache: null,
                    state: null
                });
                reply.continue();
            });

            Insync.series([
                function (next) {

                    server.inject({
                        url: '/'
                    }, function (res) {

                        expect(res.statusCode).to.equal(200);
                        expect(res.headers['cache-control']).to.equal('no-cache');
                        expect(res.result).to.deep.equal(result);

                        var cache = server._caches._default;
                        expect(cache.segments['!tacky']).to.be.true();
                        expect(cache.client.connection.cache).to.have.length(0);
                        done();
                    });
                }
            ], done);
        });
    });

    describe('generateKey()', function () {

        it('can be used to override the default generateKey function', function (done) {

            var result = { foo: 'bar', baz: 123 };
            Helper.prepareServer({
                hydrate: function (request, callback) {

                    callback(null, result);
                },
                generateKey: function (request) {

                    return 12345 + request.state.foo;
                }
            }, function (err, server) {

                expect(err).to.not.exist();
                Insync.series([
                    function (next) {

                        server.inject({
                            url: '/',
                            headers: {
                                'Cookie': 'foo=bar'
                            }
                        }, function (res) {

                            expect(internals.headerRegex.test(res.headers['cache-control'])).to.be.true();

                            var cache = server._caches._default;
                            expect(cache.segments['!tacky']).to.be.true();
                            expect(cache.client.connection.cache['!tacky']['12345bar']).to.exist();

                            next();
                        });
                    }
                ], done);
            });
        });

        it('will throw an error if the resultant cache key is not a string', function (done) {

            var result = { foo: 'bar', baz: 123 };

            Helper.prepareServer({
                hydrate: function (request, callback) {

                    callback(null, result);
                },
                generateKey: function (request) {

                    return false;
                }
            }, function (err, server) {

                expect(err).to.not.exist();
                Insync.series([
                    function (next) {

                        server.on('request-error', function (request, err) {

                            expect(err).to.be.an.instanceOf(Error);
                            expect(err.message).to.equal('Uncaught error: generateKey must return a string.');
                        });
                        next();
                    },
                    function (next) {

                        server.inject({
                            url: '/'
                        }, next.bind(null, null));
                    }
                ], done);
            });
        });
    });
});
