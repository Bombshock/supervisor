(function () {
    "strict mode";

    const supervisor = require("./supervisor");
    const Q = require("q");

    supervisor.provide("fibonacci", fibonacci);
    supervisor.provide("ping", ping);

    function fibonacci(n) {
        return n < 1 ? 0
            : n <= 2 ? 1
                : fibonacci(n - 1) + fibonacci(n - 2);
    }

    function ping(val) {
        return val || "pong";
    }

    // recovery test

    // setTimeout(() => {
    //     x();
    // }, 5000);

})();