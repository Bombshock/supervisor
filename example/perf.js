(function () {
    "use strict";

    const supervisor = require("../supervisor");
    const Q = require("q");

    let amount = 5000;
    let sum = 0;

    supervisor.cluster("./fibonacci.js");

    setTimeout(perf, 500);

    function perf() {
        let promises = [];

        for (let i = 0; i < amount; i++) {
            promises.push(consume(i));
        }
        Q.all(promises)
            .then(() => {
                let avg = Math.round(sum / amount * 100) / 100;
                console.log();
                console.log("===========================");
                console.log(`ASYNC:   avg: ${avg}ms`);
                console.log(`         sum: ${sum}ms`);
                console.log("===========================");
                supervisor.stats();
            })
            .then(perfSyn);
    }

    function perfSyn() {
        let promiseSync = Q.when();
        sum = 0;

        for (let i = 0; i < amount; i++) {
            consumeSync();
        }

        promiseSync
            .then(() => {
                let avg = Math.round(sum / amount * 100) / 100;
                console.log();
                console.log("===========================");
                console.log(`SYNC:    avg: ${avg}ms`);
                console.log(`         sum: ${sum}ms`);
                console.log("===========================");
                supervisor.stats();
                process.exit(0);
            });

        function consumeSync() {
            promiseSync = promiseSync.finally(consume);
        }
    }

    function consume() {
        let start = Date.now();
        return supervisor.request("ping")
            .then(() => {
                let end = Date.now() - start;
                sum += end;
            })
            .catch((err) => console.error(err));
    }
})();