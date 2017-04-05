"use strict";

(function () {
    "use strict";

    var numCPUs = require('os').cpus().length;
    var child_process = require("child_process");
    var uuid = require("uuid-v4");
    var Q = require("q");

    var WORKER = [];
    var PROVIDED = {};
    var MESSAGES = {};
    var CONSUMEABLES = {};
    var QUEUE = {};

    var supervisor = module.exports = {
        provide: provide,
        request: request,
        cluster: cluster,
        stats: stats,
        log: {
            info: console.log.bind(console),
            error: console.error.bind(console),
            debug: console.log.bind(console),
            verbose: console.log.bind(console),
            silly: console.log.bind(console)
        }
    };

    if (process.send) {
        supervisor.log = {
            info: logFactory("info"),
            error: logFactory("error"),
            debug: logFactory("debug"),
            verbose: logFactory("verbose"),
            silly: logFactory("silly")
        };
    }

    process.on('message', function (m) {
        if (m.request) {
            if (typeof CONSUMEABLES[m.request] === "function") {
                var res = CONSUMEABLES[m.request].apply(null, m.args || []);
                Q.when(res).then(function (res) {
                    process.send({
                        result: res,
                        success: true,
                        id: m.id
                    });
                }).catch(function (err) {
                    supervisor.log.error(err);
                    process.send({
                        result: err,
                        success: false,
                        id: m.id
                    });
                });
            }
        }
    });

    function logFactory(level) {
        return function () {
            for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
                args[_key] = arguments[_key];
            }

            process.send({
                log: true,
                level: level,
                args: args
            });
        };
    }

    function provide(name, fn) {
        name = name.toLowerCase();
        process.send({
            provide: name
        });
        CONSUMEABLES[name] = fn;
    }

    function request(name) {
        for (var _len2 = arguments.length, args = Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
            args[_key2 - 1] = arguments[_key2];
        }

        name = name.toLowerCase();
        var deferred = Q.defer();

        var id = uuid();
        var msg = {
            request: name,
            args: args,
            id: id,
            deferred: deferred
        };

        MESSAGES[id] = msg;

        if (PROVIDED[name] && PROVIDED[name].length) {
            send(name, msg);
        } else {
            QUEUE[name] = QUEUE[name] || [];
            QUEUE[name].push(msg);
        }

        return deferred.promise;
    }

    function send(name, msg, childOverride) {
        var child = childOverride || PROVIDED[name][0];

        if (!child) {
            QUEUE[name] = QUEUE[name] || [];
            QUEUE[name].push(msg);
            return;
        }

        child.threads++;
        msg.worker = child;
        child.send({
            id: msg.id,
            request: msg.request,
            args: msg.args
        });
        PROVIDED[name].sort(function (a, b) {
            var res = a.threads - b.threads;

            //roundrobin
            if (res === 0) {
                res = a.threadsdone - b.threadsdone;
            }

            return res;
        });
    }

    function cluster(path) {
        for (var i = 0; i < numCPUs; i++) {
            createWorker(path);
        }
    }

    function createWorker(path) {
        var child = child_process.fork(path, [], {
            env: process.env,
            execArgv: []
        });
        child.threads = 0;
        child.threadsdone = 0;
        child.title = "Supervisor :: " + path + " " + pad(child.pid, 6);
        child.titlemin = "[WORKER" + pad(child.pid, 7) + "]";

        WORKER.push(child);

        supervisor.log.info(child.title + " spawned");

        child.on('exit', function (worker, signal) {
            setTimeout(function () {
                supervisor.log.error(child.title + " died - signal: " + signal);
                cleanup(child, path);
            }, 500);
        });

        child.on("message", function (msg) {
            if (msg.log) {
                msg.args.unshift(child.titlemin);
                supervisor.log[msg.level].apply(supervisor.log, msg.args);
            }

            if (msg.provide) {
                if (!Array.isArray(msg.provide)) {
                    msg.provide = [msg.provide];
                }
                msg.provide.forEach(function (name) {
                    name = name.toLowerCase();
                    PROVIDED[name] = PROVIDED[name] || [];
                    PROVIDED[name].push(child);
                    if (QUEUE[name]) {
                        QUEUE[name].forEach(function (msg) {
                            return send(name, msg);
                        });
                        delete QUEUE[name];
                    }
                });
            }

            if (typeof msg.result !== "undefined") {
                child.threads--;
                child.threadsdone++;

                //other worker finished this, might happen after relocate
                if (!MESSAGES[msg.id]) {
                    return;
                }

                var deferred = MESSAGES[msg.id].deferred;

                if (msg.success) {
                    deferred.resolve(msg.result);
                } else {
                    deferred.reject(msg.result);
                }

                delete MESSAGES[msg.id];
            }
        });

        return child;
    }

    function cleanup(child, path) {
        removeChild(child);
        var next = createWorker(path);
        relocateMessages(child, next);
    }

    function removeChild(child) {
        var index = WORKER.indexOf(child);
        if (index !== -1) {
            WORKER.splice(index, 1);
        }

        Object.getOwnPropertyNames(PROVIDED).forEach(function (name) {
            var index = PROVIDED[name].indexOf(child);
            if (index !== -1) {
                PROVIDED[name].splice(index, 1);
            }
        });
    }

    function stats() {
        supervisor.log.info("Supervisor :: threads (" + WORKER.length + ")");
        WORKER.forEach(function (child) {
            supervisor.log.info(child.title + " - threads active: " + child.threads + " done: " + child.threadsdone);
        });
    }

    function relocateMessages(prevChild, nextChild) {
        var c = 0;
        Object.getOwnPropertyNames(MESSAGES).forEach(function (id) {
            var msg = MESSAGES[id];
            if (msg.worker === prevChild) {
                send(msg.request, msg, nextChild);
                c++;
            }
        });
        supervisor.log.error(prevChild.title + " -> relocated " + c + "/" + prevChild.threads + " tasks");
    }

    function pad(value, length) {
        return value.toString().length < length ? pad(" " + value, length) : value;
    }
})();
