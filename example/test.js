(function () {
    "use strict";

    const supervisor = require("../supervisor");
    const start = Date.now();

    supervisor.cluster("./fibonacci.js");

    setTimeout(perf, 500);

    setInterval(() => {
        let stats = supervisor.stats();
        supervisor.log.info(`Supervisor :: threads (${stats.workers.length})`);
        stats.workers.forEach((child) => {
            supervisor.log.info(`Supervisor :: ${child.id} - threads active: ${child.threads} done: ${child.done}`);
        });
    }, 250);

    function perf() {
        for (let i = 1; i <= 60; i++) {
            consume(i);
        }
    }

    function consume(i) {
        supervisor.request("fibonacci", i)
            .then((result) => {
                // console.log();
                // console.log(`fibonacci[${i}]: ${result} - ${Date.now() - start}ms`);
                // console.log("==================================");
                // supervisor.stats();
            })
            .catch((err) => console.error(err));
    }

})();