(function () {
    "strict mode";

    const supervisor = require("./supervisor");
    const start = Date.now();

    supervisor.cluster("./fibonacci.js");

    setTimeout(perf, 500);

    function perf() {
        for (let i = 0; i < 50; i++) {
            consume(i);
        }
    }

    function consume(i) {
        supervisor.request("fibonacci", i)
            .then((result) => {
                console.log(`fibonacci[${i}]: ${result} - ${Date.now() - start}ms`);
            })
            .catch((err) => console.error(err));
    }

    setInterval(supervisor.stats, 5000);

})();