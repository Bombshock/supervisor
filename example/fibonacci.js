(function () {
    "use strict";

    const supervisor = require("../supervisor");

    supervisor.provide("fibonacci", fibonacci);
    supervisor.provide("ping", ping);
    supervisor.log.info("fibonacci " + process.pid + " ready");

    function fibonacci(n) {
        return n < 1 ? 0 :
            n <= 2 ? 1 :
            fibonacci(n - 1) + fibonacci(n - 2);
    }

    function ping(val) {
        return val || "pong";
    }

    // recovery test

    // setTimeout(() => {
    //     x();
    // }, 5000);

})();