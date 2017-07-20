//call "./node_modules/.bin/babel" supervisor.js -o supervisor.es5.js --presets=es2015

(function () {
  "use strict";

  const numCPUs = require('os').cpus().length;
  const child_process = require("child_process");
  const uuid = require("uuid-v4");
  const Q = require("q");
  const _ = require("lodash");

  const HEARTBEAT_TICK = 1000 * 60; //60s
  const HEARTBEAT_DELAY = 1000 * 1; //1s

  let WORKER = [];
  let PROVIDED = {};
  let MESSAGES = {};
  let CONSUMEABLES = {};
  let QUEUE = {};
  let HEARTBEAT_TIMEOUT;

  let supervisor = module.exports = {
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

  // Clustered Worker
  if (process.env.WORKER === "true") {
    recieveHeartbeat();
    supervisor.log = {
      info: logFactory("info"),
      error: logFactory("error"),
      debug: logFactory("debug"),
      verbose: logFactory("verbose"),
      silly: logFactory("silly")
    };
  }

  process.on('exit', () => {
    WORKER.forEach((worker) => {
      worker.kill();
    });
  });

  process.on('message', (m) => {
    //request from master to worker for job
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
            supervisor.log.error(err);
            process.send({
              result: err,
              success: false,
              id: m.id
            });
          });
      }
    }

    //master -> worker heartbeat
    if (m.heartbeat) {
      recieveHeartbeat();
    }
  });

  function recieveHeartbeat() {
    clearTimeout(HEARTBEAT_TIMEOUT);
    HEARTBEAT_TIMEOUT = setTimeout(() => {
      supervisor.log.info(`recieved no heartbeat after ${HEARTBEAT_TICK}ms -> suicide`);
      process.exit(0);
    }, HEARTBEAT_TICK);
  }

  function logFactory(level) {
    return function () {
      let args = Array.prototype.slice.call(arguments);
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

  function request() {
    let args = Array.prototype.slice.call(arguments);
    let name = args.shift().toLowerCase();
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
    let env = _.clone(process.env);
    env.SUPERVISOR_MODE = "child";

    let child = child_process.fork(path, [], {
      env: _.extend(env, {
        "WORKER": true
      }),
      execArgv: []
    });

    child.threads = 0;
    child.threadsdone = 0;
    child.title = `${path} ${pad(child.pid, 6)}`;
    child.titlemin = `[WORKER${pad(child.pid, 7)}]`;

    WORKER.push(child);

    supervisor.log.info(`${child.titlemin} spawned`);

    let interval = setInterval(() => {
      child.send({
        heartbeat: true
      });
    }, HEARTBEAT_DELAY);

    child.on('exit', (worker, signal) => {
      clearInterval(interval);
      setTimeout(() => {
        supervisor.log.error(`${child.titlemin} died - signal: ${signal}`);
        cleanup(child, path);
      }, 500);
    });

    child.on("message", (msg) => {
      if (msg.log) {
        msg.args.unshift(child.titlemin);
        supervisor.log[msg.level].apply(supervisor.log, msg.args);
      }

      if (msg.provide) {
        if (!Array.isArray(msg.provide)) {
          msg.provide = [msg.provide];
        }
        msg.provide.forEach((name) => {
          name = name.toLowerCase();
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
    return {
      workers: WORKER.map(child => {
        return {
          id: child.pid,
          threads: child.threads,
          done: child.threadsdone
        };
      })
    };
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
    supervisor.log.error(`${prevChild.titlemin} -> relocated ${c}/${prevChild.threads} tasks`);
  }

  function pad(value, length) {
    return (value.toString().length < length) ? pad(" " + value, length) : value;
  }

})();
