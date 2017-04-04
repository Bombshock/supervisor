(function () {
    "strict mode";

    const numCPUs = require('os').cpus().length;
    const child_process = require("child_process");
    const uuid = require("uuid-v4");
    const Q = require("q");

    let WORKER = [];
    let PROVIDED = {};
    let MESSAGES = {};
    let CONSUMEABLES = {};
    let QUEUE = {};

    supervisor = module.exports = {
        provide: provide,
        request: request,
        cluster: cluster,
        stats: stats,
        log: {
            level: 'info',
            info: console.log.bind(console),
            error: console.error.bind(console),
            debug: console.log.bind(console)
        }
    };

    process.on('message', (m) => {
        if (m.request) {
            if (typeof CONSUMEABLES[m.request] === "function") {
                let res = CONSUMEABLES[m.request].apply(null, m.args || []);
                Q.when(res)
                    .then((res) => {
                        process.send({
                            result: res,
                            success: true,
                            id: m.id
                        });
                    })
                    .catch((err) => {
                        process.send({
                            result: err,
                            success: false,
                            id: m.id
                        });
                    });
            }
        }
    });

    function provide(name, fn) {
        process.send({ provide: name });
        CONSUMEABLES[name] = fn;
    }

    function request(name, ...args) {
        let deferred = Q.defer();

        let id = uuid();
        let msg = {
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
        let child = childOverride || PROVIDED[name][0];

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
        PROVIDED[name].sort((a, b) => {
            let res = a.threads - b.threads;

            //roundrobin
            if (res === 0) {
                res = a.threadsdone - b.threadsdone;
            }

            return res;
        });
    }

    function cluster(path) {
        for (let i = 0; i < numCPUs; i++) {
            createWorker(path);
        }
    }

    function createWorker(path) {
        let child = child_process.fork(path, [], {
            env: process.env
        });
        child.threads = 0;
        child.threadsdone = 0;
        child.title = `${path.replace("./", "").replace(".js", "")} #${pad(child.pid, 6)}`;

        WORKER.push(child);

        console.error(`${child.title} spawned`);
        child.on('exit', (worker, signal) => {
            console.error(`${child.title} died - signal: ${signal}`);
            cleanup(child, path);
        });

        child.on("message", (msg) => {
            if (msg.provide) {
                if (!Array.isArray(msg.provide)) {
                    msg.provide = [msg.provide];
                }
                msg.provide.forEach((name) => {
                    PROVIDED[name] = PROVIDED[name] || [];
                    PROVIDED[name].push(child);
                    if (QUEUE[name]) {
                        QUEUE[name].forEach(msg => send(name, msg));
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

                let deferred = MESSAGES[msg.id].deferred;

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
        let next = createWorker(path);
        relocateMessages(child, next);
    }

    function removeChild(child) {
        let index = WORKER.indexOf(child);
        if (index !== -1) {
            WORKER.splice(index, 1);
        }

        Object.getOwnPropertyNames(PROVIDED)
            .forEach((name) => {
                let index = PROVIDED[name].indexOf(child);
                if (index !== -1) {
                    PROVIDED[name].splice(index, 1);
                }
            });
    }

    function stats() {
        console.log(`supervisor threads (${WORKER.length})`);
        WORKER.forEach((child) => {
            console.log(`${child.title} - threads active: ${child.threads} done: ${child.threadsdone}`);
        });
    }

    function relocateMessages(prevChild, nextChild) {
        let c = 0;
        Object.getOwnPropertyNames(MESSAGES)
            .forEach((id) => {
                let msg = MESSAGES[id];
                if (msg.worker === prevChild) {
                    send(msg.request, msg, nextChild);
                    c++;
                }
            });
        console.error(`${prevChild.title} -> relocated ${c}/${prevChild.threads} tasks`);
    }

    function pad(value, length) {
        return (value.toString().length < length) ? pad(value + " ", length) : value;
    }

})();