(function () {
    "strict mode";

    const supervisor = require("./supervisor");
    const Q = require("q");
    const start = Date.now();

    let amount = 500;
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
                let avg = Math.round(sum / amount);
                console.log(`PARALEL: avarage time over ${amount} requests: ${avg}ms`);
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
                let avg = Math.round(sum / amount);
                console.log(`SYNC:    avarage time over ${amount} requests: ${avg}ms`);
                supervisor.stats();
            });

        function consumeSync() {
            promiseSync = promiseSync.finally(consume);
        }
    }

    function consume(i) {
        let start = Date.now();
        return supervisor.request("ping")
            .then((result) => {
                let end = Date.now() - start;
                sum += end;
            })
            .catch((err) => console.error(err));
    }
})();