# supervisor
Simple tool for hyperthreading in nodejs. 

# features
* uses child_process.fork()
* auto recovery when process gets killed
* 0ms overhead

# usage

```
//worker.js
const supervisor = require("supervisor");

supervisor.provide("fibonacci", fibonacci);

function fibonacci(n) {
    return n < 1 ? 0
        : n <= 2 ? 1
            : fibonacci(n - 1) + fibonacci(n - 2);
}
```

```
//consumer.js
const supervisor = require("supervisor");
const start = Date.now();

supervisor.cluster("./fibonacci.js");

for(let i = 0; i < 50; i++) {
    consume(i);
}

function consume(i) {
    supervisor.request("fibonacci", i)
        .then((result) => {
            console.log(`fibonacci[${i}]: ${result} - ${Date.now() - start}ms`);
        })
        .catch((err) => console.error(err));
}
```

`node consumer.js`
