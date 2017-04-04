(function () {
    "strict mode";

    const supervisor = require("../supervisor");
    const start = Date.now();

    supervisor.cluster("./fibonacci.js");

    setTimeout(perf, 500);

    function perf() {
        for (let i = 1; i <= 50; i++) {
            consume(i);
        }
    }

    function consume(i) {
        supervisor.request("fibonacci", i)
            .then((result) => {
                console.log();
                console.log(`fibonacci[${i}]: ${result} - ${Date.now() - start}ms`);
                console.log("==================================");
                supervisor.stats();
            })
            .catch((err) => console.error(err));
    }

})();